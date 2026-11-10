import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Plus,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  Volume2,
  Globe,
  Radio,
  Send,
  Zap,
} from "lucide-react";
import { fetchCandles } from "../lib/binance";
import { formatPrice } from "../lib/patterns";
import { COINS, PRO_COINS } from "../constants";
import { playAudioAlert, type AudioSoundType } from "../lib/AudioAlerts";
import { sendTelegramAlert, sendDiscordWebhook } from "../lib/TelegramService";
import type { Coin, PriceAlert } from "../types";

const STORAGE_KEY = "ph_price_alerts";
const ALL_COINS = [...COINS, ...PRO_COINS];

export type AlertTriggerType = "PRICE" | "PATTERN";

interface ExtendedPriceAlert extends PriceAlert {
  alertType?: AlertTriggerType;
  patternTarget?: string;
  soundType?: AudioSoundType;
  webhookUrl?: string;
  discordWebhookUrl?: string;
}

function loadAlerts(): ExtendedPriceAlert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ExtendedPriceAlert[];
  } catch {
    // ignore
  }
  return [];
}

function saveAlerts(alerts: ExtendedPriceAlert[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // ignore
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

interface Props {
  onSelectCoin: (coin: Coin) => void;
}

const COMMON_PATTERNS = [
  "Double Bottom",
  "Double Top",
  "Bull Flag",
  "Bear Flag",
  "Head & Shoulders",
  "Inverse Head & Shoulders",
  "Ascending Triangle",
  "Cup and Handle",
];

export default function PriceAlerts({ onSelectCoin }: Props) {
  const [alerts, setAlerts] = useState<ExtendedPriceAlert[]>([]);
  const [coin, setCoin] = useState<Coin>(COINS[0]);
  const [alertType, setAlertType] = useState<AlertTriggerType>("PRICE");
  const [target, setTarget] = useState("");
  const [patternTarget, setPatternTarget] = useState(COMMON_PATTERNS[0]);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [soundType, setSoundType] = useState<AudioSoundType>("RADAR_PING");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    setAlerts(loadAlerts());
  }, []);

  const handleTestSound = (st: AudioSoundType) => {
    playAudioAlert(st);
  };

  const handleTestDiscord = async () => {
    if (!discordWebhookUrl.trim()) {
      setTestStatus("Enter a Discord webhook URL first!");
      setTimeout(() => setTestStatus(null), 3000);
      return;
    }
    setTestStatus("Sending test message to Discord...");
    const res = await sendDiscordWebhook(discordWebhookUrl.trim(), {
      title: "⚡ Test Institutional Alert",
      description: "PatternHunter Fortress Terminal webhook integration is verified and operational!",
      colorHex: 0x00ff66,
      fields: [
        { name: "Trigger", value: "Acoustic & Webhook Engine", inline: true },
        { name: "Latency", value: "< 25ms", inline: true },
      ],
    });
    if (res.success) {
      setTestStatus("✓ Discord test message delivered!");
    } else {
      setTestStatus(`✗ Failed: ${res.error}`);
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const checkAlerts = useCallback(async () => {
    if (alerts.length === 0) return;
    setChecking(true);
    const updated: ExtendedPriceAlert[] = [];

    for (const alert of alerts) {
      if (alert.triggered) {
        updated.push(alert);
        continue;
      }
      try {
        const data = await fetchCandles(alert.binance_symbol, 1, "1m");
        const price = data[0]?.close ?? alert.current_price;
        const hit = alert.direction === "above" ? price >= alert.target_price : price <= alert.target_price;

        if (hit) {
          playAudioAlert(alert.soundType || "RADAR_PING");

          // Dispatch Discord Webhook if configured
          if (alert.discordWebhookUrl && alert.discordWebhookUrl.startsWith("http")) {
            sendDiscordWebhook(alert.discordWebhookUrl, {
              title: `🚨 ${alert.coin_symbol} Target Triggered!`,
              description: `Price reached **$${formatPrice(price)}** (Target: $${formatPrice(alert.target_price)})`,
              colorHex: alert.direction === "above" ? 0x00ff66 : 0xff3344,
              fields: [
                { name: "Direction", value: alert.direction.toUpperCase(), inline: true },
                { name: "Current Price", value: `$${formatPrice(price)}`, inline: true },
              ],
            }).catch(() => {});
          }

          // Dispatch generic Webhook
          if (alert.webhookUrl && alert.webhookUrl.startsWith("http")) {
            fetch(alert.webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: "PRICE_ALERT_TRIGGERED",
                symbol: alert.coin_symbol,
                targetPrice: alert.target_price,
                currentPrice: price,
                direction: alert.direction,
                timestamp: new Date().toISOString(),
              }),
            }).catch(() => {});
          }
        }
        updated.push({ ...alert, current_price: price, triggered: hit });
      } catch {
        updated.push(alert);
      }
    }
    setAlerts(updated);
    saveAlerts(updated);
    setChecking(false);
  }, [alerts]);

  const addAlert = useCallback(() => {
    const tp = parseFloat(target);
    if (isNaN(tp) || tp <= 0) return;

    const newAlert: ExtendedPriceAlert = {
      id: uid(),
      coin_symbol: coin.symbol,
      binance_symbol: coin.binanceSymbol,
      alertType,
      patternTarget: alertType === "PATTERN" ? patternTarget : undefined,
      target_price: tp,
      direction,
      current_price: 0,
      triggered: false,
      created_at: new Date().toISOString(),
      soundType,
      webhookUrl: webhookUrl.trim() || undefined,
      discordWebhookUrl: discordWebhookUrl.trim() || undefined,
    };

    const updated = [...alerts, newAlert];
    setAlerts(updated);
    saveAlerts(updated);
    setTarget("");
    setWebhookUrl("");
    setDiscordWebhookUrl("");
  }, [alerts, coin, alertType, patternTarget, target, direction, soundType, webhookUrl, discordWebhookUrl]);

  const removeAlert = useCallback((id: string) => {
    const updated = alerts.filter((a) => a.id !== id);
    setAlerts(updated);
    saveAlerts(updated);
  }, [alerts]);

  useEffect(() => {
    const interval = setInterval(() => {
      checkAlerts();
    }, 30000);
    return () => clearInterval(interval);
  }, [checkAlerts]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Radio className="w-5 h-5 text-cyan-400" />
            Institutional Alerts & Acoustic Webhook Router
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Real-time audio alarms, Discord rich embeds, Telegram broadcasts & Webhook triggers
          </p>
        </div>
        <button
          onClick={checkAlerts}
          disabled={checking || alerts.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4 text-cyan-400" />}
          <span className="hidden sm:inline">Check Real-Time</span>
        </button>
      </div>

      {/* Create alert form */}
      <div className="rounded-2xl bg-[#090d16] border border-cyan-500/30 p-5 shadow-2xl space-y-4">
        {/* Row 1: Alert Type, Coin, Target Price, Condition */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Trigger Type</label>
            <select
              value={alertType}
              onChange={(e) => setAlertType(e.target.value as AlertTriggerType)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500"
            >
              <option value="PRICE">Price Level Hit</option>
              <option value="PATTERN">Chart Pattern Detected</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Coin Pair</label>
            <select
              value={coin.binanceSymbol}
              onChange={(e) => {
                const found = ALL_COINS.find((c) => c.binanceSymbol === e.target.value);
                if (found) setCoin(found);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500"
            >
              {ALL_COINS.map((c) => (
                <option key={c.binanceSymbol} value={c.binanceSymbol}>
                  {c.symbol} — {c.label}
                </option>
              ))}
            </select>
          </div>

          {alertType === "PRICE" ? (
            <div>
              <label className="text-[10px] text-slate-400 uppercase mb-1 block">Target Price ($)</label>
              <input
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono placeholder:text-slate-600 outline-none focus:border-cyan-500"
              />
            </div>
          ) : (
            <div>
              <label className="text-[10px] text-slate-400 uppercase mb-1 block">Pattern Target</label>
              <select
                value={patternTarget}
                onChange={(e) => setPatternTarget(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500"
              >
                {COMMON_PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Condition</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "above" | "below")}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500"
            >
              <option value="above">Price crosses ABOVE</option>
              <option value="below">Price crosses BELOW</option>
            </select>
          </div>
        </div>

        {/* Row 2: Audio Alert Sound, Discord Webhook, Generic Webhook */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-slate-400 uppercase block">Audio Acoustic Tone</label>
              <button
                type="button"
                onClick={() => handleTestSound(soundType)}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <Volume2 className="w-3 h-3" /> Test Sound
              </button>
            </div>
            <select
              value={soundType}
              onChange={(e) => setSoundType(e.target.value as AudioSoundType)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500"
            >
              <option value="RADAR_PING">Radar Ping (High Confluence)</option>
              <option value="CHIME">Classic Harmonic Chime</option>
              <option value="URGENT_SIREN">Urgent Siren (Breakout)</option>
              <option value="WHALE_HORN">Whale Horn (Deep Liquidity)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-slate-400 uppercase block">Discord Webhook (Optional)</label>
              <button
                type="button"
                onClick={handleTestDiscord}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Send className="w-3 h-3" /> Test
              </button>
            </div>
            <input
              type="url"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Custom HTTP Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://api.yourbot.com/webhook"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 font-mono text-[11px]"
            />
          </div>
        </div>

        {testStatus && (
          <p className="text-xs font-mono text-cyan-300 animate-in fade-in duration-150">
            {testStatus}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={addAlert}
            disabled={!target || parseFloat(target) <= 0}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 shadow-md shadow-cyan-950/40"
          >
            <Plus className="w-4 h-4" />
            CREATE INSTITUTIONAL ALERT
          </button>
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-[#090d16] rounded-2xl border border-slate-800">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
            <Bell className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-white font-bold text-sm uppercase">No Active Alerts Configured</p>
          <p className="text-xs text-slate-400 font-sans mt-1 max-w-xs">
            Set up an acoustic tone, Discord embed webhook, or price condition above.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${
                alert.triggered
                  ? "bg-cyan-500/10 border-cyan-500/30"
                  : "bg-[#090d16] border-slate-800"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  alert.triggered ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-900 text-slate-400"
                }`}
              >
                {alert.triggered ? (
                  <AlertCircle className="w-4 h-4 text-cyan-400" />
                ) : (
                  <Bell className="w-4 h-4 text-slate-400" />
                )}
              </div>

              <button
                onClick={() => {
                  const found = ALL_COINS.find((c) => c.binanceSymbol === alert.binance_symbol);
                  if (found) onSelectCoin(found);
                }}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{alert.coin_symbol}</span>
                  {alert.soundType && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                      🔊 {alert.soundType}
                    </span>
                  )}
                  {alert.discordWebhookUrl && (
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-indigo-950/60 text-indigo-300 border border-indigo-500/40 font-mono">
                      Discord
                    </span>
                  )}
                  {alert.triggered && (
                    <span className="text-[#00ff66] text-xs font-bold font-mono">✓ TRIGGERED</span>
                  )}
                </div>

                <p className="text-xs text-slate-400 font-sans mt-0.5">
                  When price goes {alert.direction}{" "}
                  <b className="text-white font-mono">{formatPrice(alert.target_price)}</b>
                </p>
              </button>

              {alert.current_price > 0 && !alert.triggered && (
                <span className="text-xs text-slate-400 shrink-0 hidden sm:inline font-mono">
                  Now: ${formatPrice(alert.current_price)}
                </span>
              )}

              <button
                onClick={() => playAudioAlert(alert.soundType || "RADAR_PING")}
                className="p-1.5 text-slate-500 hover:text-cyan-400 transition"
                title="Play Alert Tone"
              >
                <Volume2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => removeAlert(alert.id)}
                className="p-1.5 text-slate-600 hover:text-red-400 transition"
                title="Delete Alert"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
