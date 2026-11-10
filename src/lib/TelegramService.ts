/**
 * Telegram Bot Alert Service for Real-Time Hedge Fund Notifications.
 * Dispatches trade execution, stop-loss hits, profit vault triggers, and liquidation alerts.
 */

const STORAGE_KEY_TG_CONFIG = "fortress_telegram_bot_config";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: "",
  chatId: "",
  enabled: false,
};

export function loadTelegramConfig(): TelegramConfig {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TG_CONFIG);
    if (raw) {
      return { ...DEFAULT_TELEGRAM_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_TELEGRAM_CONFIG };
}

export function saveTelegramConfig(config: Partial<TelegramConfig>): TelegramConfig {
  const current = loadTelegramConfig();
  const updated = { ...current, ...config };
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_TG_CONFIG, JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save Telegram config:", e);
    }
  }
  return updated;
}

/**
 * Dispatches a formatted alert message via Telegram Bot API.
 */
export async function sendTelegramAlert(
  message: string,
  parseMode: "Markdown" | "HTML" = "HTML"
): Promise<{ success: boolean; error?: string }> {
  const config = loadTelegramConfig();
  if (!config.enabled || !config.botToken.trim() || !config.chatId.trim()) {
    return { success: false, error: "Telegram bot not configured or disabled" };
  }

  const endpoint = `https://api.telegram.org/bot${encodeURIComponent(config.botToken.trim())}/sendMessage`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: config.chatId.trim(),
        text: message,
        parse_mode: parseMode,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      return {
        success: false,
        error: data.description || "Failed to send Telegram message",
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error contacting Telegram API",
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
        avatar_url: "https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=128",
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
      // Generic JSON Webhook format
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
    `<b>Realized PnL:</b> <b style="color:${isWin ? '#00ff66' : '#ff3344'}">${isWin ? '+' : ''}$${pnl.toFixed(2)}</b>`,
    trade.profitVaultAmount ? `<b>Profit Vault Swept (50%):</b> $${trade.profitVaultAmount.toFixed(2)}` : "",
    `<b>Timestamp:</b> ${new Date().toISOString()}`,
  ].filter(Boolean).join("\n");

  await sendTelegramAlert(msg, "HTML");
}
