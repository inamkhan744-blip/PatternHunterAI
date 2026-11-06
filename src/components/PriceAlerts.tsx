import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Trash2, Loader2, Check, AlertCircle } from "lucide-react";
import { fetchCandles } from "../lib/binance";
import { formatPrice } from "../lib/patterns";
import { COINS, PRO_COINS } from "../constants";
import type { Coin, PriceAlert } from "../types";

const STORAGE_KEY = "ph_price_alerts";
const ALL_COINS = [...COINS, ...PRO_COINS];

function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PriceAlert[];
  } catch {
    // ignore
  }
  return [];
}

function saveAlerts(alerts: PriceAlert[]): void {
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

export default function PriceAlerts({ onSelectCoin }: Props) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [coin, setCoin] = useState<Coin>(COINS[0]);
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setAlerts(loadAlerts());
  }, []);

  const checkAlerts = useCallback(async () => {
    if (alerts.length === 0) return;
    setChecking(true);
    const updated: PriceAlert[] = [];
    for (const alert of alerts) {
      if (alert.triggered) {
        updated.push(alert);
        continue;
      }
      try {
        const data = await fetchCandles(alert.binance_symbol, 1, "1m");
        const price = data[0]?.close ?? alert.current_price;
        const hit = alert.direction === "above" ? price >= alert.target_price : price <= alert.target_price;
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
    const newAlert: PriceAlert = {
      id: uid(),
      coin_symbol: coin.symbol,
      binance_symbol: coin.binanceSymbol,
      target_price: tp,
      direction,
      current_price: 0,
      triggered: false,
      created_at: new Date().toISOString(),
    };
    const updated = [...alerts, newAlert];
    setAlerts(updated);
    saveAlerts(updated);
    setTarget("");
  }, [alerts, coin, target, direction]);

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
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Price Alerts</h2>
          <p className="text-xs text-slate-500 mt-0.5">Get notified when a coin hits your target</p>
        </div>
        <button
          onClick={checkAlerts}
          disabled={checking || alerts.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4 text-cyan-400" />}
          <span className="hidden sm:inline">Check Now</span>
        </button>
      </div>

      {/* Create alert form */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Coin</label>
            <select
              value={coin.binanceSymbol}
              onChange={(e) => {
                const found = ALL_COINS.find((c) => c.binanceSymbol === e.target.value);
                if (found) setCoin(found);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            >
              {ALL_COINS.map((c) => (
                <option key={c.binanceSymbol} value={c.binanceSymbol}>
                  {c.symbol} — {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Target Price ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Condition</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "above" | "below")}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            >
              <option value="above">Price goes above</option>
              <option value="below">Price goes below</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={addAlert}
              disabled={!target || parseFloat(target) <= 0}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 text-sm font-bold transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Alert
            </button>
          </div>
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <Bell className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">No alerts set yet</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            Create a price alert above to get notified when a coin reaches your target.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-center gap-3 p-3 sm:p-4 rounded-xl border transition-colors ${
                alert.triggered
                  ? "bg-cyan-500/5 border-cyan-500/20"
                  : "bg-slate-900 border-slate-800"
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                alert.triggered ? "bg-cyan-500/10" : "bg-slate-800"
              }`}>
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
                <p className="text-sm font-semibold text-white truncate">
                  {alert.coin_symbol}
                  {alert.triggered && <span className="text-cyan-400 ml-2">— Triggered!</span>}
                </p>
                <p className="text-xs text-slate-500">
                  Alert when price goes {alert.direction} <span className="text-slate-300 font-medium">{formatPrice(alert.target_price)}</span>
                </p>
              </button>
              {alert.current_price > 0 && !alert.triggered && (
                <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
                  Now: {formatPrice(alert.current_price)}
                </span>
              )}
              <button
                onClick={() => removeAlert(alert.id)}
                className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
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
