/**
 * AIService — direct-from-browser multi-provider AI router.
 *
 * The app no longer proxies AI traffic through a Supabase Edge Function. Global
 * provider credentials + models live in `global_settings` (id = 'global_config')
 * and are managed from the admin-only "Global AI Config" section of Settings.
 *
 * Routing rules:
 *  - `active_provider` is tried first.
 *  - On failure (429, 5xx, timeout, empty body, ...) the next configured provider
 *    with a usable key is tried, so one exhausted quota never takes AI offline.
 *  - Images are Gemini-only: DeepSeek and Groq are text-only, so any request with
 *    `imageBase64` is always routed to Gemini even when another provider is active.
 *  - Models are never hardcoded. Gemini, DeepSeek and Groq retire/rename models at
 *    will, so the exact `*_model` value from `global_settings` is used as-is and the
 *    admin picks it from a live provider model list in Settings.
 */

import { supabase } from "./supabase";

export type AIProvider = "gemini" | "deepseek" | "groq";

export const AI_PROVIDER_IDS: readonly AIProvider[] = ["gemini", "deepseek", "groq"];

export const AI_PROVIDER_META: Record<
  AIProvider,
  { label: string; supportsVision: boolean }
> = {
  gemini: { label: "Gemini (Google)", supportsVision: true },
  deepseek: { label: "DeepSeek", supportsVision: false },
  groq: { label: "Groq", supportsVision: false },
};

export interface GlobalAIConfig {
  activeProvider: AIProvider;
  geminiApiKey: string;
  geminiModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
  groqApiKey: string;
  groqModel: string;
}

export const DEFAULT_GLOBAL_AI_CONFIG: GlobalAIConfig = {
  activeProvider: "gemini",
  geminiApiKey: "",
  geminiModel: "",
  deepseekApiKey: "",
  deepseekModel: "",
  groqApiKey: "",
  groqModel: "",
};

export interface AIModelOption {
  /** Exact model id to store in `global_settings` (e.g. `gemini-2.5-flash`). */
  id: string;
  label: string;
  supportsVision: boolean;
}

export interface AIRequestOptions {
  /** 0 - 2. Defaults to 0.4. */
  temperature?: number;
  /** Defaults to 800. */
  maxOutputTokens?: number;
  /** Ask the provider for a JSON object (`response_format` / `responseMimeType`). */
  json?: boolean;
  /** MIME type of `imageBase64` (default `image/png`). */
  imageMimeType?: string;
  /** Per-request network timeout in ms. Defaults to 45s. */
  timeoutMs?: number;
}

export interface AIAttemptFailure {
  provider: AIProvider;
  model: string;
  error: string;
}

export interface AIResponseResult {
  text: string;
  provider: AIProvider;
  model: string;
  attempts: AIAttemptFailure[];
}

export class AIServiceError extends Error {
  readonly attempts: AIAttemptFailure[];

  constructor(message: string, attempts: AIAttemptFailure[] = []) {
    super(message);
    this.name = "AIServiceError";
    this.attempts = attempts;
  }
}

export const GLOBAL_CONFIG_ID = "global_config";

const CONFIG_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 45_000;
/** Gemini inline_data payload cap (≈3 MB binary). */
const MAX_IMAGE_BASE64_CHARS = 4_000_000;
const MAX_ERROR_CHARS = 300;

const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GEMINI_BASE_URL = GEMINI_MODELS_URL;
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MODEL_LIST_TIMEOUT_MS = 20_000;

/** Gemini ids that are not chat/vision models (embeddings, media generation, TTS...). */
const NON_VISION_GEMINI_PATTERN = /(embedding|aqa|imagen|veo|tts|audio|live|native-audio|image-generation)/i;
/** Groq/DeepSeek ids that are not text-generation models. */
const NON_TEXT_MODEL_PATTERN = /(whisper|tts|speech|audio|embed|moderation|guard)/i;
/** Upstream wording used when a model id no longer exists. */
const MODEL_NOT_FOUND_PATTERN = /model[^|]{0,80}(not found|not exist|does not exist|decommission|deprecat|unsupported|invalid)/i;

interface GlobalSettingsRow {
  id?: string;
  active_provider?: string | null;
  gemini_api_key?: string | null;
  gemini_model?: string | null;
  deepseek_api_key?: string | null;
  deepseek_model?: string | null;
  groq_api_key?: string | null;
  groq_model?: string | null;
}

let cachedConfig: GlobalAIConfig | null = null;
let cachedAt = 0;

function clean(value: unknown, maxChars = 400): string {
  if (typeof value !== "string") return "";
  // Keep tabs/newlines (system prompts are multi-line), drop other control chars.
  const printable = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
  return printable.trim().slice(0, maxChars);
}

function normalizeProvider(value: unknown): AIProvider {
  const candidate = clean(value, 16).toLowerCase();
  return (AI_PROVIDER_IDS as readonly string[]).includes(candidate)
    ? (candidate as AIProvider)
    : DEFAULT_GLOBAL_AI_CONFIG.activeProvider;
}

function rowToConfig(row: GlobalSettingsRow | null): GlobalAIConfig {
  if (!row) return { ...DEFAULT_GLOBAL_AI_CONFIG };
  return {
    activeProvider: normalizeProvider(row.active_provider),
    geminiApiKey: clean(row.gemini_api_key, 400),
    geminiModel: clean(row.gemini_model, 120),
    deepseekApiKey: clean(row.deepseek_api_key, 400),
    deepseekModel: clean(row.deepseek_model, 120),
    groqApiKey: clean(row.groq_api_key, 400),
    groqModel: clean(row.groq_model, 120),
  };
}

function providerKey(config: GlobalAIConfig, provider: AIProvider): string {
  if (provider === "gemini") return config.geminiApiKey;
  if (provider === "deepseek") return config.deepseekApiKey;
  return config.groqApiKey;
}

function providerModel(config: GlobalAIConfig, provider: AIProvider): string {
  if (provider === "gemini") return config.geminiModel;
  if (provider === "deepseek") return config.deepseekModel;
  return config.groqModel;
}

/** A provider is usable only with BOTH a key and an admin-selected model. */
function isProviderReady(config: GlobalAIConfig, provider: AIProvider): boolean {
  return Boolean(providerKey(config, provider) && providerModel(config, provider));
}

/**
 * Gemini model ids that can accept images. Gemini's model list does not expose an
 * explicit modality flag, so media/embedding families are excluded by name.
 */
export function geminiModelSupportsVision(modelId: string): boolean {
  const id = clean(modelId, 200).toLowerCase().replace(/^models\//, "");
  if (!id || !id.startsWith("gemini")) return false;
  return !NON_VISION_GEMINI_PATTERN.test(id);
}

export function listConfiguredProviders(config: GlobalAIConfig): AIProvider[] {
  return AI_PROVIDER_IDS.filter((provider) => Boolean(providerKey(config, provider)));
}

function stripDataUrlPrefix(imageBase64: string): string {
  const commaIndex = imageBase64.indexOf(",");
  if (imageBase64.startsWith("data:") && commaIndex !== -1) {
    return imageBase64.slice(commaIndex + 1);
  }
  return imageBase64;
}

function truncateError(value: unknown): string {
  const message =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : "Unknown provider error";
  return clean(message, MAX_ERROR_CHARS) || "Unknown provider error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Global config persistence
// ---------------------------------------------------------------------------

/**
 * Reads the admin-managed AI configuration from `global_settings`.
 * Cached for 60s so a chat session does not re-query Supabase on every message.
 */
export async function fetchGlobalAIConfig(force = false): Promise<GlobalAIConfig> {
  if (!force && cachedConfig && Date.now() - cachedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }

  const { data, error } = await supabase
    .from("global_settings")
    .select(
      "id, active_provider, gemini_api_key, gemini_model, deepseek_api_key, deepseek_model, groq_api_key, groq_model"
    )
    .eq("id", GLOBAL_CONFIG_ID)
    .maybeSingle();

  if (error) {
    throw new AIServiceError(`Could not load global AI configuration: ${truncateError(error.message)}`);
  }

  const config = rowToConfig((data ?? null) as GlobalSettingsRow | null);
  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}

/**
 * Writes the global AI configuration. The RLS policies on `global_settings` only
 * allow admins to INSERT/UPDATE, so a non-admin write fails server-side even if
 * the UI gate is bypassed.
 */
export async function saveGlobalAIConfig(config: GlobalAIConfig): Promise<GlobalAIConfig> {
  const next: GlobalAIConfig = {
    activeProvider: normalizeProvider(config.activeProvider),
    geminiApiKey: clean(config.geminiApiKey, 400),
    geminiModel: clean(config.geminiModel, 120),
    deepseekApiKey: clean(config.deepseekApiKey, 400),
    deepseekModel: clean(config.deepseekModel, 120),
    groqApiKey: clean(config.groqApiKey, 400),
    groqModel: clean(config.groqModel, 120),
  };

  const { error } = await supabase.from("global_settings").upsert(
    {
      id: GLOBAL_CONFIG_ID,
      active_provider: next.activeProvider,
      gemini_api_key: next.geminiApiKey,
      gemini_model: next.geminiModel,
      deepseek_api_key: next.deepseekApiKey,
      deepseek_model: next.deepseekModel,
      groq_api_key: next.groqApiKey,
      groq_model: next.groqModel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new AIServiceError(
      `Could not save global AI configuration: ${truncateError(error.message)}. ` +
        "Only administrators can modify global settings."
    );
  }

  cachedConfig = next;
  cachedAt = Date.now();
  return next;
}

export function invalidateAIConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

interface ProviderCallArgs {
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  imageBase64?: string;
  imageMimeType: string;
  options: Required<Pick<AIRequestOptions, "temperature" | "maxOutputTokens" | "json">> & {
    timeoutMs: number;
  };
}

interface ProviderCallResult {
  text: string;
  model: string;
}

async function requestJson(
  url: string,
  init: {
    method: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs: number;
  }
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), init.timeoutMs);
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const detail =
        parsed && typeof parsed === "object"
          ? truncateError(
              (parsed as { error?: { message?: unknown } }).error?.message ??
                (parsed as { message?: unknown }).message ??
                raw
            )
          : truncateError(raw);
      throw new AIServiceError(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }

    if (parsed === null) {
      throw new AIServiceError("Provider returned a non-JSON response.");
    }
    return parsed;
  } catch (err) {
    if (err instanceof AIServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AIServiceError(`Provider timed out after ${Math.round(init.timeoutMs / 1000)}s.`);
    }
    throw new AIServiceError(truncateError(err));
  } finally {
    clearTimeout(timeoutId);
  }
}

function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  return requestJson(url, { method: "POST", body, headers, timeoutMs });
}

function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  return requestJson(url, { method: "GET", headers, timeoutMs });
}

/** Google Gemini `generateContent` REST call (text + optional inline image). */
async function callGemini(args: ProviderCallArgs): Promise<ProviderCallResult> {
  const parts: Array<Record<string, unknown>> = [];
  if (args.imageBase64) {
    parts.push({ inline_data: { mime_type: args.imageMimeType, data: args.imageBase64 } });
  }
  // Prompt first is irrelevant to the model; image-first matches the previous
  // working edge-function payload ordering.
  parts.push({ text: args.prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: args.options.temperature,
      maxOutputTokens: args.options.maxOutputTokens,
      ...(args.options.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (args.systemPrompt) {
    body.systemInstruction = { parts: [{ text: args.systemPrompt }] };
  }

  const data = (await postJson(
    `${GEMINI_BASE_URL}/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`,
    body,
    {},
    args.options.timeoutMs
  )) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new AIServiceError(`Gemini blocked the prompt (${clean(blockReason, 60)}).`);
  }

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    const finish = candidate?.finishReason ? ` (finishReason: ${clean(candidate.finishReason, 40)})` : "";
    throw new AIServiceError(`Gemini returned an empty response${finish}.`);
  }

  return { text, model: args.model };
}

/** OpenAI-compatible chat completions (DeepSeek + Groq). */
async function callOpenAICompatible(
  url: string,
  args: ProviderCallArgs
): Promise<ProviderCallResult> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (args.systemPrompt) {
    messages.push({ role: "system", content: args.systemPrompt });
  }
  messages.push({ role: "user", content: args.prompt });

  const data = (await postJson(
    url,
    {
      model: args.model,
      messages,
      temperature: args.options.temperature,
      max_tokens: args.options.maxOutputTokens,
      stream: false,
      ...(args.options.json ? { response_format: { type: "json_object" } } : {}),
    },
    { Authorization: `Bearer ${args.apiKey}` },
    args.options.timeoutMs
  )) as { choices?: Array<{ message?: { content?: unknown } }> };

  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw new AIServiceError("Provider returned an empty response.");
  }

  return { text, model: args.model };
}

function sortAndDedupeModels(options: AIModelOption[]): AIModelOption[] {
  const seen = new Set<string>();
  return options
    .filter((option) => {
      const key = option.id.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.supportsVision) - Number(a.supportsVision) || a.id.localeCompare(b.id)
    );
}

/**
 * Lists the models a provider currently exposes for this API key. Nothing is
 * hardcoded: providers retire ids (404s) and the admin picks from this live list.
 */
export async function fetchAvailableModels(
  provider: AIProvider,
  apiKey: string
): Promise<AIModelOption[]> {
  const key = clean(apiKey, 400);
  const meta = AI_PROVIDER_META[provider];
  if (!key) {
    throw new AIServiceError(
      `Enter the ${meta.label} API key first, then fetch the model list.`
    );
  }

  try {
    if (provider === "gemini") {
      const data = (await getJson(
        `${GEMINI_MODELS_URL}?key=${encodeURIComponent(key)}&pageSize=1000`,
        {},
        MODEL_LIST_TIMEOUT_MS
      )) as { models?: Array<Record<string, unknown>> };

      const models = Array.isArray(data?.models) ? data.models : [];
      return sortAndDedupeModels(
        models
          .filter((model) => typeof model?.name === "string")
          .filter((model) => {
            const methods = model.supportedGenerationMethods;
            return !Array.isArray(methods) || methods.includes("generateContent");
          })
          .map((model) => {
            const id = clean(model.name, 200).replace(/^models\//, "");
            const display = clean(model.displayName, 120);
            return {
              id,
              label: display && display !== id ? `${display} (${id})` : id,
              supportsVision: geminiModelSupportsVision(id),
            };
          })
          .filter((option) => Boolean(option.id))
      );
    }

    const data = (await getJson(
      provider === "deepseek" ? DEEPSEEK_MODELS_URL : GROQ_MODELS_URL,
      { Authorization: `Bearer ${key}` },
      MODEL_LIST_TIMEOUT_MS
    )) as { data?: Array<Record<string, unknown>> };

    const models = Array.isArray(data?.data) ? data.data : [];
    return sortAndDedupeModels(
      models
        // Groq marks retired/disabled models with `active: false`.
        .filter((model) => model?.active !== false)
        .filter((model) => typeof model?.id === "string")
        .map((model) => clean(model.id, 200))
        .filter((id) => Boolean(id) && !NON_TEXT_MODEL_PATTERN.test(id))
        // DeepSeek and Groq chat models are text-only; vision always goes to Gemini.
        .map((id) => ({ id, label: id, supportsVision: false }))
    );
  } catch (err) {
    throw new AIServiceError(
      `Could not fetch ${meta.label} models: ${truncateError(err)}`
    );
  }
}

/**
 * Minimal live probe used by the admin vault's "Test Key" button. One tiny
 * generation request with no retries and no fallback: any failure (bad key,
 * retired model, quota, network) returns false.
 */
export async function testApiKey(
  provider: AIProvider,
  apiKey: string,
  modelName: string
): Promise<boolean> {
  const key = clean(apiKey, 400);
  const model = clean(modelName, 200);
  if (!key || !model) return false;

  try {
    if (provider === "gemini") {
      await postJson(
        `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        },
        {},
        15_000
      );
    } else {
      await postJson(
        provider === "deepseek" ? DEEPSEEK_URL : GROQ_URL,
        {
          model,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 1,
          temperature: 0,
          stream: false,
        },
        { Authorization: `Bearer ${key}` },
        15_000
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Ordered provider chain for this request: the active provider first (when it has a
 * key), then the remaining providers that have keys configured.
 */
function buildProviderChain(config: GlobalAIConfig, requiresVision: boolean): AIProvider[] {
  const ready = AI_PROVIDER_IDS.filter((provider) => isProviderReady(config, provider));

  if (requiresVision) {
    // DeepSeek/Groq are text-only — an uploaded image must go to Gemini.
    return ready.includes("gemini") ? ["gemini"] : [];
  }

  const chain: AIProvider[] = [];
  if (ready.includes(config.activeProvider)) chain.push(config.activeProvider);
  for (const provider of ready) {
    if (!chain.includes(provider)) chain.push(provider);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Raised only when `ai-chat` is not deployed / unreachable, so callers can fall back. */
class AIProxyUnavailableError extends Error {}

/**
 * Server-side generation. Provider keys stay in the database and are only read
 * by the `ai-chat` edge function with the service role.
 */
async function generateViaProxy(
  prompt: string,
  systemPrompt: string,
  imageBase64: string | undefined,
  imageMimeType: string,
  options: AIRequestOptions
): Promise<AIResponseResult> {
  const { data, error } = await supabase.functions.invoke("ai-chat", {
    body: {
      prompt,
      systemPrompt,
      imageBase64: imageBase64 ?? null,
      imageMimeType,
      options: {
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        json: options.json,
        timeoutMs: options.timeoutMs,
      },
    },
  });

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    // 404 = function not deployed yet; no status = transport failure.
    if (!status || status === 404) {
      throw new AIProxyUnavailableError("ai-chat is unavailable");
    }
    throw new AIServiceError(`AI proxy rejected the request (HTTP ${status}).`);
  }

  const result = data as {
    ok?: boolean;
    text?: string;
    provider?: AIProvider;
    model?: string;
    attempts?: AIAttemptFailure[];
    error?: string;
  } | null;

  if (!result?.ok || !result.text) {
    throw new AIServiceError(result?.error ?? "AI proxy returned no response.", result?.attempts ?? []);
  }

  return {
    text: result.text,
    provider: result.provider ?? "gemini",
    model: result.model ?? "",
    attempts: result.attempts ?? [],
  };
}

/**
 * Generates an AI response using the admin-configured provider, with automatic
 * fallback to the next configured provider when the active one fails.
 *
 * @param prompt       User/task prompt.
 * @param systemPrompt Behaviour + market-context instructions.
 * @param imageBase64  Optional image (raw base64 or data URL). Forces Gemini.
 */
export async function generateAIResponse(
  prompt: string,
  systemPrompt: string,
  imageBase64?: string,
  options: AIRequestOptions = {}
): Promise<AIResponseResult> {
  const safePrompt = clean(prompt, 20_000);
  if (!safePrompt) {
    throw new AIServiceError("AI prompt is empty.");
  }
  const safeSystemPrompt = clean(systemPrompt, 20_000);

  const image = imageBase64 ? stripDataUrlPrefix(imageBase64).replace(/\s/g, "") : "";
  if (image.length > MAX_IMAGE_BASE64_CHARS) {
    throw new AIServiceError("Image too large for AI analysis. Please upload a chart under ~3 MB.");
  }
  if (image && !/^[A-Za-z0-9+/=]+$/.test(image)) {
    throw new AIServiceError("Image data is not valid base64.");
  }

  const normalizedMime = clean(options.imageMimeType, 64).toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : clean(options.imageMimeType, 64).toLowerCase() || "image/png";
  if (image && !/^image\/(png|jpeg|webp)$/.test(normalizedMime)) {
    throw new AIServiceError("Unsupported image type. Use PNG, JPG, or WEBP.");
  }

  try {
    return await generateViaProxy(
      safePrompt,
      safeSystemPrompt,
      image || undefined,
      normalizedMime,
      options
    );
  } catch (err) {
    if (!(err instanceof AIProxyUnavailableError)) throw err;
    // Self-hosted deployments that have not deployed `ai-chat` yet keep working
    // for admins (the only role that can still read global_settings).
    console.warn("[AIService] ai-chat unavailable; using direct provider fallback.");
  }

  const config = await fetchGlobalAIConfig();
  const requiresVision = Boolean(image);

  if (requiresVision) {
    // Vision is Gemini-only, and the admin-selected Gemini model has to actually
    // accept images — a text-only Gemini/DeepSeek/Groq model would fail upstream.
    if (!config.geminiApiKey || !config.geminiModel) {
      throw new AIServiceError(
        "Vision AI requires a Gemini API key and a Gemini model. Ask an administrator to configure both in Settings → Global AI Config."
      );
    }
    if (!geminiModelSupportsVision(config.geminiModel)) {
      throw new AIServiceError(
        `The selected Gemini model "${config.geminiModel}" does not support image input. Ask an administrator to pick a Gemini multimodal model (one labelled VISION in "Fetch Available Models") in Settings → Global AI Config.`
      );
    }
  }

  const chain = buildProviderChain(config, requiresVision);

  if (chain.length === 0) {
    throw new AIServiceError(
      requiresVision
        ? "Vision analysis requires a Gemini API key and model. Ask an administrator to configure them in Settings → Global AI Config."
        : "No AI provider is fully configured. Ask an administrator to add an API key and select a model in Settings → Global AI Config."
    );
  }

  const resolved = {
    temperature: options.temperature ?? 0.4,
    maxOutputTokens: options.maxOutputTokens ?? 800,
    json: options.json ?? false,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  const attempts: AIAttemptFailure[] = [];

  for (const provider of chain) {
    const apiKey = providerKey(config, provider);
    const model = providerModel(config, provider);
    if (!apiKey || !model) continue;

    try {
      const result =
        provider === "gemini"
          ? await callGemini({
              apiKey,
              model,
              prompt: safePrompt,
              systemPrompt: safeSystemPrompt,
              imageBase64: image || undefined,
              imageMimeType: normalizedMime,
              options: resolved,
            })
          : await callOpenAICompatible(provider === "deepseek" ? DEEPSEEK_URL : GROQ_URL, {
              apiKey,
              model,
              prompt: safePrompt,
              systemPrompt: safeSystemPrompt,
              imageMimeType: normalizedMime,
              options: resolved,
            });

      return {
        text: result.text,
        provider,
        model: result.model,
        attempts,
      };
    } catch (err) {
      const failure: AIAttemptFailure = {
        provider,
        model,
        error: truncateError(err),
      };
      attempts.push(failure);
      console.warn(`[AIService] ${provider}/${model} failed: ${failure.error}`);

      // A retired/renamed model is a configuration problem, not a transient
      // outage: surface it to the admin instead of silently retrying providers.
      const status = /^HTTP (\d{3})/.exec(failure.error)?.[1];
      if (status === "404" || MODEL_NOT_FOUND_PATTERN.test(failure.error)) {
        throw new AIServiceError(
          `${AI_PROVIDER_META[provider].label} model "${model}" was not found upstream (${failure.error}). ` +
            'Ask an administrator to select a current model in Settings → Global AI Config using "Fetch Available Models".',
          attempts
        );
      }

      // Rejected/forbidden key on this provider: try the next configured provider.
      if (status && ["400", "401", "403"].includes(status)) continue;

      // Tiny pause before the next provider to smooth over 429 bursts.
      await delay(150);
    }
  }

  const summary =
    attempts.length > 0
      ? attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(" | ")
      : "No attempts were made.";

  throw new AIServiceError(
    requiresVision
      ? `Gemini Vision is unavailable: ${summary}`
      : `All configured AI providers failed: ${summary}`,
    attempts
  );
}

/**
 * Providers occasionally wrap JSON in markdown fences despite `response_format` /
 * `responseMimeType`. Strip them before parsing instead of discarding the analysis.
 */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .replace(/```json\n?|```/g, "")
    .trim();
}

export function parseAIJson<T = unknown>(raw: string): T {
  return JSON.parse(stripJsonFences(raw)) as T;
}

/** True when at least one provider (or specifically Gemini, for vision) is usable. */
export function isAIProviderConfigured(
  config: GlobalAIConfig,
  provider?: AIProvider
): boolean {
  if (provider) return Boolean(providerKey(config, provider));
  return listConfiguredProviders(config).length > 0;
}
