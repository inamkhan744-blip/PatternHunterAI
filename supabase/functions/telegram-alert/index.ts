/**
 * telegram-alert — server-side Telegram delivery and encrypted bot-token storage.
 *
 * Security controls:
 *  - Requires a valid Supabase JWT; anonymous callers cannot send messages.
 *  - The bot token is encrypted with AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`) and
 *    stored in `user_telegram_config`, which grants nothing to client roles.
 *  - The token is never returned to the browser, logged, or echoed in errors.
 *  - Durable per-user rate limits for save/status and for sends.
 *  - The Telegram Bot API does not send CORS headers, so this server-side call is
 *    also what makes Telegram alerts work at all.
 */

import {
  adminClient,
  clampString,
  decryptSecret,
  encryptSecret,
  enforceRateLimit,
  json,
  preflight,
  requireUser,
} from "../_shared/security.ts";

const BOT_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/;
const MAX_MESSAGE_CHARS = 3500;
const TELEGRAM_TIMEOUT_MS = 10_000;

interface TelegramRow {
  chat_id: string;
  token_ciphertext: string;
  enabled: boolean;
  updated_at: string | null;
}

/** Telegram accepts a limited HTML subset; escape anything that is not a tag we emit. */
function sanitizeTelegramHtml(message: string): string {
  return message
    .replace(/\r/g, "")
    .replace(/<(?!\/?(b|i|u|s|code|pre|a)\b)[^>]*>/gi, "")
    .slice(0, MAX_MESSAGE_CHARS);
}

async function sendTelegramMessage(params: {
  token: string;
  chatId: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(params.token)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: sanitizeTelegramHtml(params.message),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      // Never surface the upstream body: it can echo the bot token in the URL.
      return { ok: false, error: `Telegram rejected the message (HTTP ${res.status}).` };
    }

    const data = await res.json().catch(() => null);
    if (data && data.ok === false) {
      return { ok: false, error: "Telegram rejected the message." };
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "network error";
    return { ok: false, error: `Telegram request ${reason}.` };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = await requireUser(req);
    if (!auth.user) return auth.response!;
    const userId = auth.user.id;

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const action = clampString(payload.action ?? "send", 16) || "send";
    if (!["status", "save", "send", "delete"].includes(action)) {
      return json({ error: "Unsupported action" }, 400);
    }

    const rateKey = action === "send" ? "telegram-alert:send" : "telegram-alert:config";
    const allowed = await enforceRateLimit(userId, rateKey, action === "send" ? 20 : 10, 60);
    if (!allowed) {
      return json({ error: "Rate limit exceeded. Please slow down." }, 429);
    }

    const supabase = adminClient();

    if (action === "status") {
      const { data, error } = await supabase
        .from("user_telegram_config")
        .select("chat_id, enabled, updated_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("[telegram-alert] status lookup failed:", error.message);
        return json({ error: "Could not read Telegram configuration." }, 500);
      }

      const row = data as Pick<TelegramRow, "chat_id" | "enabled" | "updated_at"> | null;
      return json({
        success: true,
        status: {
          configured: Boolean(row),
          chatId: row?.chat_id ?? "",
          enabled: row?.enabled ?? false,
          updatedAt: row?.updated_at ?? null,
        },
      });
    }

    if (action === "save") {
      const botToken = clampString(payload.botToken, 128).trim();
      const chatId = clampString(payload.chatId, 64).trim();
      const enabled = payload.enabled !== false;

      if (!BOT_TOKEN_RE.test(botToken)) {
        return json({ error: "That does not look like a Telegram bot token." }, 400);
      }
      if (!CHAT_ID_RE.test(chatId)) {
        return json({ error: "Chat ID must be a numeric id or an @channel name." }, 400);
      }

      const tokenCiphertext = await encryptSecret(botToken);
      const { error } = await supabase.from("user_telegram_config").upsert(
        {
          user_id: userId,
          chat_id: chatId,
          token_ciphertext: tokenCiphertext,
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) {
        console.error("[telegram-alert] save failed:", error.message);
        return json({ error: "Could not store the Telegram configuration." }, 500);
      }

      return json({
        success: true,
        status: { configured: true, chatId, enabled, updatedAt: new Date().toISOString() },
      });
    }

    if (action === "delete") {
      const { error } = await supabase
        .from("user_telegram_config")
        .delete()
        .eq("user_id", userId);
      if (error) {
        console.error("[telegram-alert] delete failed:", error.message);
        return json({ error: "Could not delete the Telegram configuration." }, 500);
      }
      return json({ success: true, status: { configured: false, chatId: "", enabled: false } });
    }

    // action === "send"
    const message = clampString(payload.message, MAX_MESSAGE_CHARS);
    if (!message.trim()) {
      return json({ error: "Missing required field: message" }, 400);
    }

    const { data, error } = await supabase
      .from("user_telegram_config")
      .select("chat_id, token_ciphertext, enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[telegram-alert] config lookup failed:", error.message);
      return json({ ok: false, error: "Could not read Telegram configuration." }, 500);
    }

    const row = data as TelegramRow | null;
    if (!row || !row.enabled) {
      return json({ ok: false, error: "Telegram alerts are not configured or are disabled." }, 400);
    }

    let botToken = "";
    try {
      botToken = await decryptSecret(row.token_ciphertext);
    } catch {
      console.error("[telegram-alert] token decryption failed");
      return json({ ok: false, error: "Stored Telegram credentials could not be read." }, 500);
    }

    const result = await sendTelegramMessage({
      token: botToken,
      chatId: row.chat_id,
      message,
    });

    return json(result, result.ok ? 200 : 502);
  } catch (err) {
    console.error("[telegram-alert] unexpected error:", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "Telegram service internal error." }, 500);
  }
});
