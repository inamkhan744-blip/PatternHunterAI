/**
 * ai-chat — server-side proxy for the admin-configured AI providers.
 *
 * WHY THIS EXISTS
 * ---------------
 * `global_settings` held the Gemini/DeepSeek/Groq API keys and was readable by
 * every authenticated user, so any account could exfiltrate the platform's keys
 * from the browser. Provider calls now happen here with the service role.
 *
 * The proxy keeps the same behaviour the client had:
 *   - active provider first, then the other configured providers,
 *   - vision is Gemini-only,
 *   - JSON mode and output limits are forwarded,
 *   - per-user rate limits so one account cannot drain the platform's quota.
 */

import {
  adminClient,
  clampString,
  enforceRateLimit,
  json,
  preflight,
  requireUser,
} from "../_shared/security.ts";

type Provider = "gemini" | "deepseek" | "groq";

const PROVIDER_ORDER: Provider[] = ["gemini", "deepseek", "groq"];
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_PROMPT_CHARS = 20_000;
const MAX_IMAGE_BASE64_CHARS = 4_000_000;
const DEFAULT_TIMEOUT_MS = 45_000;

interface AttemptFailure {
  provider: Provider;
  model: string;
  error: string;
}

interface ConfigRow {
  active_provider: string | null;
  gemini_api_key: string | null;
  gemini_model: string | null;
  deepseek_api_key: string | null;
  deepseek_model: string | null;
  groq_api_key: string | null;
  groq_model: string | null;
}

function providerKey(row: ConfigRow, provider: Provider): string {
  if (provider === "gemini") return clampString(row.gemini_api_key ?? "", 400);
  if (provider === "deepseek") return clampString(row.deepseek_api_key ?? "", 400);
  return clampString(row.groq_api_key ?? "", 400);
}

function providerModel(row: ConfigRow, provider: Provider): string {
  if (provider === "gemini") return clampString(row.gemini_model ?? "", 120);
  if (provider === "deepseek") return clampString(row.deepseek_model ?? "", 120);
  return clampString(row.groq_model ?? "", 120);
}

function safeError(err: unknown, status?: number): string {
  const message = err instanceof Error ? err.message : String(err);
  return status ? `HTTP ${status}: ${clampString(message, 200)}` : clampString(message, 240);
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ data: unknown; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1_000), 60_000)),
  });
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const detail =
      (data as { error?: { message?: string } })?.error?.message ??
      (typeof data === "object" && data !== null && "raw" in data
        ? String((data as { raw: unknown }).raw)
        : res.statusText);
    throw new Error(safeError(detail, res.status));
  }
  return { data, status: res.status };
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt: string,
  image: string,
  imageMimeType: string,
  options: { temperature: number; maxOutputTokens: number; json: boolean; timeoutMs: number }
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [];
  if (image) {
    parts.push({ inline_data: { mime_type: imageMimeType, data: image } });
  }
  parts.push({ text: prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      ...(options.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const { data } = await postJson(
    `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    body,
    {},
    options.timeoutMs
  );

  const payload = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (payload?.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt (${clampString(payload.promptFeedback.blockReason, 60)}).`);
  }

  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      `Gemini returned an empty response${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}.`
    );
  }
  return text;
}

async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt: string,
  options: { temperature: number; maxOutputTokens: number; json: boolean; timeoutMs: number }
): Promise<string> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const { data } = await postJson(
    url,
    {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
      stream: false,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    },
    { Authorization: `Bearer ${apiKey}` },
    options.timeoutMs
  );

  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new Error("Provider returned an empty response.");
  return text;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Read + log the raw payload first so the Supabase logs show exactly what the
  // frontend sent, even if auth/rate-limiting rejects the request afterwards.
  let payload: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    payload =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    payload = {};
  }
  console.log("Incoming payload:", payload);

  try {
    const auth = await requireUser(req);
    if (!auth.user) return auth.response!;
    const userId = auth.user.id;

    const perMinute = await enforceRateLimit(userId, "ai-chat:min", 20, 60);
    if (!perMinute) return json({ ok: false, error: "AI rate limit reached. Try again shortly." }, 429);
    const perDay = await enforceRateLimit(userId, "ai-chat:day", 300, 86_400);
    if (!perDay) return json({ ok: false, error: "Daily AI request limit reached." }, 429);

    const body = payload;

    // Accept the canonical keys plus common aliases so a frontend/backend
    // payload mismatch degrades to "empty prompt" instead of a hard 400.
    const promptCandidate =
      body.prompt ?? body.message ?? body.text ?? body.query ??
      (Array.isArray(body.messages)
        ? (body.messages as Array<Record<string, unknown>>)
            .slice()
            .reverse()
            .find((entry) => entry?.role === "user")?.content
        : undefined);
    const prompt = clampString(promptCandidate, MAX_PROMPT_CHARS);
    if (!prompt) return json({ ok: false, error: "AI prompt is empty." }, 400);
    const systemPrompt = clampString(
      body.systemPrompt ?? body.system ?? body.system_prompt,
      MAX_PROMPT_CHARS
    );

    const imageCandidate = body.imageBase64 ?? body.image ?? body.image_base64;
    const image = clampString(imageCandidate, MAX_IMAGE_BASE64_CHARS + 1).replace(/\s/g, "");
    if (image.length > MAX_IMAGE_BASE64_CHARS) {
      return json({ ok: false, error: "Image too large for AI analysis." }, 400);
    }
    if (image && !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return json({ ok: false, error: "Image data is not valid base64." }, 400);
    }

    const mimeCandidate =
      body.imageMimeType ?? body.imageMimeType ?? body.mimeType ?? body.mime_type;
    const rawMime = clampString(mimeCandidate, 64).toLowerCase();
    const imageMimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime || "image/png";
    if (image && !/^image\/(png|jpeg|webp)$/.test(imageMimeType)) {
      return json({ ok: false, error: "Unsupported image type. Use PNG, JPG, or WEBP." }, 400);
    }

    const rawOptions = (body.options ?? body.params ?? {}) as Record<string, unknown>;
    const temperature = Math.min(Math.max(Number(rawOptions.temperature ?? 0.4), 0), 2);
    const maxOutputTokens = Math.min(Math.max(Number(rawOptions.maxOutputTokens ?? 800), 1), 8_000);
    const jsonMode = rawOptions.json === true;
    const timeoutMs = Math.min(Math.max(Number(rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1_000), 60_000);

    const supabase = adminClient();
    const { data, error } = await supabase
      .from("global_settings")
      .select(
        "active_provider, gemini_api_key, gemini_model, deepseek_api_key, deepseek_model, groq_api_key, groq_model"
      )
      .eq("id", "global_config")
      .maybeSingle();

    if (error) {
      console.error("[ai-chat] global_settings read failed:", error.message);
      return json({ ok: false, error: "AI configuration is unavailable." }, 503);
    }
    if (!data) return json({ ok: false, error: "No AI provider is configured." }, 503);

    const row = data as ConfigRow;
    const active = PROVIDER_ORDER.includes(row.active_provider as Provider)
      ? (row.active_provider as Provider)
      : "gemini";

    const chain = image
      ? (["gemini"] as Provider[])
      : [active, ...PROVIDER_ORDER.filter((provider) => provider !== active)];

    const attempts: AttemptFailure[] = [];

    for (const provider of chain) {
      const apiKey = providerKey(row, provider);
      const model = providerModel(row, provider);
      if (!apiKey || !model) continue;

      try {
        const text =
          provider === "gemini"
            ? await callGemini(apiKey, model, prompt, systemPrompt, image, imageMimeType, {
                temperature,
                maxOutputTokens,
                json: jsonMode,
                timeoutMs,
              })
            : await callOpenAICompatible(
                provider === "deepseek" ? DEEPSEEK_URL : GROQ_URL,
                apiKey,
                model,
                prompt,
                systemPrompt,
                { temperature, maxOutputTokens, json: jsonMode, timeoutMs }
              );

        return json({ ok: true, text, provider, model, attempts });
      } catch (err) {
        const failure: AttemptFailure = {
          provider,
          model,
          error: safeError(err),
        };
        attempts.push(failure);
        console.warn(`[ai-chat] ${provider}/${model} failed: ${failure.error}`);
      }
    }

    const summary = attempts.length
      ? attempts.map((attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`).join(" | ")
      : "No AI provider is fully configured (key + model).";
    return json({ ok: false, error: `All configured AI providers failed: ${summary}`, attempts }, 502);
  } catch (err) {
    console.error("[ai-chat] internal error:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "AI proxy internal error" }, 500);
  }
});
