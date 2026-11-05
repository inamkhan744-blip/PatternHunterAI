import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Loader2, RefreshCw, Zap } from "lucide-react";
import { COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { detectPattern, formatPrice } from "../lib/patterns";
import type { Coin, DetectedPattern, Timeframe } from "../types";

interface MarketRow {
  coin: Coin;
  price: number;
  change: number;
  pattern: DetectedPattern | null;
}

interface Props {
  timeframe: Timeframe;
  onSelectCoin: (coin: Coin) => void;
  watchlistSymbols: Set<string>;
  onToggleWatch: (coin: Coin) => void;
}

export default function MarketScanner({ timeframe, onSelectCoin, watchlistSymbols, onToggleWatch }: Props) {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [scanning, setScanning] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    const top10 = COINS.slice(0, 10);
    const settled = await Promise.allSettled(
      top10.map(async (coin): Promise<MarketRow | null> => {
        const data = await fetchCandles(coin.binanceSymbol, 200, timeframe);
        if (data.length < 2) return null;
        const first = data[data.length - 25]?.close ?? data[0].close;
        const last = data[data.length - 1].close;
        return {
          coin,
          price: last,
          change: ((last - first) / first) * 100,
          pattern: detectPattern(data),
        };
      })
    );
    const results: MarketRow[] = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is MarketRow => v !== null);
    setRows(results);
    setScanning(false);
  }, [timeframe]);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Market Scanner</h2>
          <p className="text-xs text-slate-500 mt-0.5">Top 10 coins — live pattern detection</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {scanning && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Scanning top 10 coins…</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const isBullish = row.pattern?.direction === "bullish";
            const hasPattern = row.pattern !== null;
            const inWatch = watchlistSymbols.has(row.coin.binanceSymbol);
            return (
              <div
                key={`${row.coin.symbol}-${idx}`}
                className="flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <button
                  onClick={() => onToggleWatch(row.coin)}
                  className="shrink-0 transition-colors"
                  title={inWatch ? "Remove from watchlist" : "Add to watchlist"}
                >
                  <svg
                    className={`w-5 h-5 ${inWatch ? "text-amber-400 fill-amber-400" : "text-slate-600 hover:text-slate-400"}`}
                    fill={inWatch ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>

                <button
                  onClick={() => onSelectCoin(row.coin)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                    {row.coin.symbol.slice(0, 3)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">
                      {row.coin.symbol}<span className="text-slate-500 font-normal">/USDT</span>
                    </p>
                    <p className="text-xs text-slate-500 truncate">{row.coin.label}</p>
                  </div>
                </button>

                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-slate-200">{formatPrice(row.price)}</p>
                  <p className={`text-xs font-medium ${row.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {row.change >= 0 ? "+" : ""}{row.change.toFixed(2)}%
                  </p>
                </div>

                <div className="shrink-0 w-28 sm:w-36 text-right">
                  {hasPattern ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: isBullish ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: isBullish ? "#4ade80" : "#f87171",
                      }}
                    >
                      {isBullish ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      <span className="hidden sm:inline">{row.pattern!.name}</span>
                      <span className="sm:hidden">{isBullish ? "Bull" : "Bear"}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600 px-2 py-1">
                      <Zap className="w-3 h-3" />
                      No pattern
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
