import { TrendingUp, TrendingDown, Star, Loader2, RefreshCw, Zap } from "lucide-react";
import { COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { detectPattern, formatPrice } from "../lib/patterns";
import type { Coin, DetectedPattern, Timeframe, WatchlistItem } from "../types";
import { useEffect, useState, useCallback } from "react";

interface WatchRow {
  coin: Coin;
  price: number;
  change: number;
  pattern: DetectedPattern | null;
}

interface Props {
  timeframe: Timeframe;
  watchlist: WatchlistItem[];
  onSelectCoin: (coin: Coin) => void;
  onRemove: (item: WatchlistItem) => void;
}

function coinFromSymbol(binanceSymbol: string): Coin | null {
  return [...COINS].find((c) => c.binanceSymbol === binanceSymbol) ?? null;
}

export default function Watchlist({ timeframe, watchlist, onSelectCoin, onRemove }: Props) {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    if (watchlist.length === 0) {
      setRows([]);
      return;
    }
    setScanning(true);
    const settled = await Promise.allSettled(
      watchlist.map(async (item): Promise<WatchRow | null> => {
        const coin = coinFromSymbol(item.binance_symbol);
        if (!coin) return null;
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
    const results: WatchRow[] = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is WatchRow => v !== null);
    setRows(results);
    setScanning(false);
  }, [watchlist, timeframe]);

  useEffect(() => {
    scan();
  }, [scan]);

  if (watchlist.length === 0) {
    return (
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <Star className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">Your watchlist is empty</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            Tap the star icon next to any coin to add it to your watchlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Watchlist</h2>
          <p className="text-xs text-slate-500 mt-0.5">{watchlist.length} coin{watchlist.length !== 1 ? "s" : ""} tracked</p>
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
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Scanning your watchlist…</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const isBullish = row.pattern?.direction === "bullish";
            const hasPattern = row.pattern !== null;
            const item = watchlist.find((w) => w.binance_symbol === row.coin.binanceSymbol);
            return (
              <div
                key={`${row.coin.symbol}-${idx}`}
                className="flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <button
                  onClick={() => item && onRemove(item)}
                  className="shrink-0 transition-colors"
                  title="Remove from watchlist"
                >
                  <Star className="w-5 h-5 text-amber-400 fill-amber-400 hover:text-amber-300" />
                </button>

                <button
                  onClick={() => onSelectCoin(row.coin)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-xs font-bold shrink-0">
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
