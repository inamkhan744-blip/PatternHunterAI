/**
 * Telegram Bot Alert Service for Real-Time Hedge Fund Notifications.
 *
 * The bot token is NOT stored in the browser. It is sent once over TLS to the
 * `telegram-alert` edge function, encrypted with AES-256-GCM and kept in a
 * service-role-only table. Delivery also happens server-side, because the Telegram
 * Bot API sends no CORS headers and a direct browser call can never succeed.
 *
 * Only non-sensitive UI state (chat id, enabled flag, configured flag) is cached
 * locally so the settings screens can render instantly.
 */

import { supabase } from "./supabase";

const STORAGE_KEY_TG_CONFIG = "fortress_telegram_bot_config";

export interface TelegramConfig {
  /** Never populated from storage — only from what the user just typed. */
  botToken: string;
  chatId: string;
  enabled: boolean;
  /** True when a token is stored server-side. */
  configured?: boolean;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: "",
  chatId: "",
  enabled: false,
  configured: false,
};

export function loadTelegramConfig(): TelegramConfig {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TG_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TelegramConfig>;
      return {
        botToken: "",
        chatId: typeof parsed.chatId === "string" ? parsed.chatId : "",
        enabled: parsed.enabled === true,
        configured: parsed.configured === true,
      };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_TELEGRAM_CONFIG };
}

function persistLocalNonSecrets(config: TelegramConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY_TG_CONFIG,
      JSON.stringify({
        chatId: config.chatId,
        enabled: config.enabled,
        configured: config.configured === true,
      })
    );
  } catch {
    // private mode — server remains the source of truth
  }
}

/**
 * Local, synchronous update for non-secret fields. A typed bot token is forwarded to
 * the vault asynchronously; it is never written to localStorage.
 */
export function saveTelegramConfig(config: Partial<TelegramConfig>): TelegramConfig {
  const current = loadTelegramConfig();
  const updated: TelegramConfig = { ...current, ...config, botToken: "" };
  if (typeof config.chatId === "string") updated.chatId = config.chatId.trim();
  persistLocalNonSecrets(updated);

  const typedToken = config.botToken?.trim();
  if (typedToken) {
    void saveTelegramCredentials({
      botToken: typedToken,
      chatId: updated.chatId,
      enabled: updated.enabled,
    });
  }

  return updated;
}

async function invokeTelegram<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("telegram-alert", { body });
  if (error) throw new Error(error.message || "Telegram service request failed");
  if (!data || typeof data !== "object") throw new Error("Telegram service returned an empty response");
  return data as T;
}

/** Reads the server-side status (configured / chat id / enabled). */
export async function refreshTelegramStatus(): Promise<TelegramConfig> {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return { ...DEFAULT_TELEGRAM_CONFIG };

  try {
    const payload = await invokeTelegram<{
      status?: { configured?: boolean; chatId?: string; enabled?: boolean };
    }>({ action: "status" });
    const status = payload.status;
    const config: TelegramConfig = {
      botToken: "",
      chatId: status?.chatId ?? "",
      enabled: status?.enabled === true,
      configured: status?.configured === true,
    };
    persistLocalNonSecrets(config);
    return config;
  } catch {
    return loadTelegramConfig();
  }
}

/** Stores (or rotates) the bot token server-side. */
export async function saveTelegramCredentials(params: {
  botToken: string;
  chatId: string;
  enabled: boolean;
}): Promise<{ success: boolean; error?: string; config: TelegramConfig }> {
  const config: TelegramConfig = {
    botToken: "",
    chatId: params.chatId.trim(),
    enabled: params.enabled,
    configured: false,
  };

  try {
    if (!params.botToken.trim()) {
      throw new Error("A Telegram bot token is required.");
    }
    const payload = await invokeTelegram<{
      status?: { configured?: boolean; chatId?: string; enabled?: boolean };
    }>({
      action: "save",
      botToken: params.botToken.trim(),
      chatId: params.chatId.trim(),
      enabled: params.enabled,
    });

    config.configured = payload.status?.configured === true;
    config.chatId = payload.status?.chatId ?? config.chatId;
    config.enabled = payload.status?.enabled ?? config.enabled;
    persistLocalNonSecrets(config);
    return { success: true, config };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to store Telegram credentials.",
      config: loadTelegramConfig(),
    };
  }
}

/** Removes the stored Telegram configuration. */
export async function deleteTelegramConfig(): Promise<boolean> {
  try {
    await invokeTelegram({ action: "delete" });
    persistLocalNonSecrets({ ...DEFAULT_TELEGRAM_CONFIG });
    return true;
  } catch {
    return false;
  }
}

/**
 * Dispatches a formatted alert message through the server-side edge function.
 */
export async function sendTelegramAlert(
  message: string,
  parseMode: "Markdown" | "HTML" = "HTML"
): Promise<{ success: boolean; error?: string }> {
  // Messages are always delivered as HTML by the edge function.
  void parseMode;
  const local = loadTelegramConfig();
  if (!local.enabled || !local.configured) {
    return { success: false, error: "Telegram bot not configured or disabled" };
  }

  try {
    const payload = await invokeTelegram<{ ok?: boolean; error?: string }>({
      action: "send",
      message,
    });
    if (payload.ok) return { success: true };
    return { success: false, error: payload.error || "Telegram rejected the message" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error contacting the Telegram service",
    };
  }
}

/**
 * Helper to dispatch trade executed alert.
 */
export async function notifyTradeOpened(trade: {
  symbol: string;
  direction: string;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marketType: string;
  stopLossPrice: number;
  takeProfitPrice: number;
}): Promise<void> {
  const emoji = trade.direction === "LONG" ? "🟢" : "🔴";
  const msg = [
    `<b>🚨 [FORTRESS HEDGE FUND] TRADE EXECUTED</b>`,
    `<b>Direction:</b> ${emoji} ${trade.direction} (${trade.leverage}x)`,
    `<b>Symbol:</b> <code>${trade.symbol}</code> (${trade.marketType})`,
    `<b>Entry Price:</b> $${trade.entryPrice.toLocaleString()}`,
    `<b>Quantity:</b> ${trade.quantity}`,
    `<b>Stop Loss:</b> $${trade.stopLossPrice.toLocaleString()}`,
    `<b>Take Profit:</b> $${trade.takeProfitPrice.toLocaleString()}`,
    `<b>Time:</b> ${new Date().toISOString()}`,
  ].join("\n");

  await sendTelegramAlert(msg, "HTML");
}

/**
 * Helper to dispatch pattern alert to Telegram.
 */
export async function notifyPatternDetected(alert: {
  symbol: string;
  patternName: string;
  direction: "bullish" | "bearish";
  price: number;
  timeframe: string;
}): Promise<void> {
  const emoji = alert.direction === "bullish" ? "🚀 BULLISH" : "📉 BEARISH";
  const msg = [
    `<b>⚡ [FORTRESS AI] PATTERN DETECTED</b>`,
    `<b>Symbol:</b> <code>${alert.symbol}</code> (${alert.timeframe})`,
    `<b>Pattern:</b> ${alert.patternName} [${emoji}]`,
    `<b>Current Price:</b> $${alert.price.toLocaleString()}`,
    `<b>Confidence:</b> High Confluence Trigger`,
    `<b>Timestamp:</b> ${new Date().toISOString()}`,
  ].join("\n");

  await sendTelegramAlert(msg, "HTML");
}

/**
 * Dispatches a rich Discord Webhook alert (supports Discord Embeds)
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: {
    title: string;
    description: string;
    colorHex?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
  }
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.startsWith("http")) {
    return { success: false, error: "Invalid Discord Webhook URL" };
  }

  try {
    const isDiscord = webhookUrl.includes("discord.com") || webhookUrl.includes("discordapp.com");
    let bodyData: unknown;

    if (isDiscord) {
      bodyData = {
        username: "Fortress Hedge Fund AI",
        embeds: [
          {
            title: payload.title,
            description: payload.description,
            color: payload.colorHex ?? 0x00ff66,
            fields: payload.fields || [],
            footer: { text: "PatternHunter Fortress Terminal • Institutional Alerts" },
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } else {
      bodyData = {
        event: "FORTRESS_ALERT",
        title: payload.title,
        description: payload.description,
        fields: payload.fields,
        timestamp: new Date().toISOString(),
      };
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
    });

    if (res.ok || res.status === 204) {
      return { success: true };
    }
    return { success: false, error: `Webhook returned status ${res.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Helper to dispatch trade closed alert.
 */
export async function notifyTradeClosed(trade: {
  symbol: string;
  direction: string;
  entryPrice: number;
  closePrice?: number;
  realizedPnl?: number;
  profitVaultAmount?: number;
  exitReason?: string;
}): Promise<void> {
  const pnl = trade.realizedPnl ?? 0;
  const isWin = pnl >= 0;
  const emoji = isWin ? "💰" : "🔻";
  const msg = [
    `<b>${emoji} [FORTRESS HEDGE FUND] TRADE CLOSED</b>`,
    `<b>Symbol:</b> <code>${trade.symbol}</code> (${trade.direction})`,
    `<b>Entry:</b> $${trade.entryPrice.toLocaleString()}`,
    `<b>Exit:</b> $${(trade.closePrice ?? 0).toLocaleString()}`,
    `<b>Reason:</b> ${trade.exitReason ?? "MANUAL"}`,
    `<b>Realized PnL:</b> <b>${isWin ? "+" : ""}$${pnl.toFixed(2)}</b>`,
    trade.profitVaultAmount ? `<b>Profit Vault Swept (50%):</b> $${trade.profitVaultAmount.toFixed(2)}` : "",
    `<b>Timestamp:</b> ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendTelegramAlert(msg, "HTML");
}
