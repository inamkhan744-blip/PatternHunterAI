import { useEffect, useState, useCallback } from "react";
import { Grid3x3, RefreshCw } from "lucide-react";
import { COINS, PRO_COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { formatPrice } from "../lib/patterns";
import type { HeatmapItem } from "../types";

export default function MarketHeatmap() {
  const [items, setItems] = useState<HeatmapItem[]>([]);
  const [loading, setLoading] = useState(true);

  const scan = useCallback(async () => {
    setLoading(true);
    const allCoins = [...COINS, ...PRO_COINS];
    const settled = await Promise.allSettled(
      allCoins.map(async (coin) => {
        const data = await fetchCandles(coin.binanceSymbol, 25, "1h");
        if (data.length < 2) return null;
        const first = data[0].close;
        const last = data[data.length - 1].close;
        const volume = data.reduce((sum, c) => sum + c.volume * c.close, 0);
        return {
          symbol: coin.symbol,
          label: coin.label,
          change: ((last - first) / first) * 100,
          price: last,
          volume,
        };
      })
    );
    const results = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is HeatmapItem => v !== null);
    setItems(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  function getBgColor(change: number): string {
    const abs = Math.min(Math.abs(change), 6);
    const intensity = abs / 6;
    if (change > 0) {
      const alpha = 0.08 + intensity * 0.35;
      return `rgba(34, 197, 94, ${alpha})`;
    }
    if (change < 0) {
      const alpha = 0.08 + intensity * 0.35;
      return `rgba(239, 68, 68, ${alpha})`;
    }
    return "rgba(148, 163, 184, 0.05)";
  }

  function getBorderColor(change: number): string {
    if (change > 1) return "rgba(34, 197, 94, 0.3)";
    if (change < -1) return "rgba(239, 68, 68, 0.3)";
    return "rgba(148, 163, 184, 0.1)";
  }

  const maxVolume = Math.max(...items.map((i) => i.volume), 1);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Grid3x3 className="w-5 h-5 text-cyan-400" />
            Market Heatmap
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Color intensity = price change %, size = volume</p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading market heatmap…</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {items.map((item) => {
            const volRatio = item.volume / maxVolume;
            const minHeight = 70 + volRatio * 50;
            return (
              <div
                key={item.symbol}
                className="rounded-lg p-3 border transition-all hover:scale-105 cursor-default flex flex-col justify-between"
                style={{
                  backgroundColor: getBgColor(item.change),
                  borderColor: getBorderColor(item.change),
                  minHeight: `${minHeight}px`,
                }}
                title={`${item.label} — ${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`}
              >
                <div>
                  <p className="text-xs font-bold text-white truncate">{item.symbol}</p>
                  <p className="text-[10px] text-slate-400 truncate">{item.label}</p>
                </div>
                <div className="mt-1">
                  <p className="text-xs font-medium text-slate-200">{formatPrice(item.price)}</p>
                  <p className={`text-xs font-bold ${item.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
