import { useEffect, useState, useCallback, useMemo } from "react";
import { TrendingUp, TrendingDown, Loader2, RefreshCw, Zap, ArrowUpDown, Crown } from "lucide-react";
import { COINS, PRO_COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { detectPattern, formatPrice } from "../lib/patterns";
import type { Coin, DetectedPattern, Timeframe } from "../types";

interface MarketRow {
  coin: Coin;
  price: number;
  change: number;
  pattern: DetectedPattern | null;
  isPro: boolean;
}

type SortKey = "price" | "change" | "symbol";
type SortDir = "asc" | "desc";

interface Props {
  timeframe: Timeframe;
  onSelectCoin: (coin: Coin) => void;
  watchlistSymbols: Set<string>;
  onToggleWatch: (coin: Coin) => void;
}

export default function MarketScanner({ timeframe, onSelectCoin, watchlistSymbols, onToggleWatch }: Props) {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [scanning, setScanning] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("change");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterPattern, setFilterPattern] = useState<"all" | "bullish" | "bearish" | "none">("all");
  const [showAll, setShowAll] = useState(false);

  const allCoins = useMemo(() => {
    return [
      ...COINS.map((c) => ({ coin: c, isPro: false })),
      ...PRO_COINS.map((c) => ({ coin: c, isPro: true })),
    ];
  }, []);

  const coinsToScan = showAll ? allCoins : allCoins.slice(0, 10);

  const scan = useCallback(async () => {
    setScanning(true);
    const settled = await Promise.allSettled(
      coinsToScan.map(async ({ coin, isPro }): Promise<MarketRow | null> => {
        const data = await fetchCandles(coin.binanceSymbol, 200, timeframe);
        if (data.length < 2) return null;
        const first = data[data.length - 25]?.close ?? data[0].close;
        const last = data[data.length - 1].close;
        return {
          coin,
          price: last,
          change: ((last - first) / first) * 100,
          pattern: detectPattern(data),
          isPro,
        };
      })
    );
    const results: MarketRow[] = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is MarketRow => v !== null);
    setRows(results);
    setScanning(false);
  }, [timeframe, coinsToScan]);

  useEffect(() => {
    scan();
  }, [scan]);

  const sortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filterPattern === "all") return true;
      if (filterPattern === "none") return row.pattern === null;
      if (filterPattern === "bullish") return row.pattern?.direction === "bullish";
      if (filterPattern === "bearish") return row.pattern?.direction === "bearish";
      return true;
    });

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "price") cmp = a.price - b.price;
      else if (sortKey === "change") cmp = a.change - b.change;
      else if (sortKey === "symbol") cmp = a.coin.symbol.localeCompare(b.coin.symbol);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [rows, sortKey, sortDir, filterPattern]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const bullishCount = rows.filter((r) => r.pattern?.direction === "bullish").length;
  const bearishCount = rows.filter((r) => r.pattern?.direction === "bearish").length;
  const noPatternCount = rows.filter((r) => r.pattern === null).length;

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Market Scanner</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {showAll ? "All 58 coins" : "Top 10 coins"} — live pattern detection
            {!showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="text-cyan-400 hover:text-cyan-300 ml-1 font-medium"
              >
                Show all →
              </button>
            )}
            {showAll && (
              <button
                onClick={() => setShowAll(false)}
                className="text-cyan-400 hover:text-cyan-300 ml-1 font-medium"
              >
                Show top 10 →
              </button>
            )}
          </p>
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

      {/* Summary stats */}
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-center">
            <p className="text-lg font-bold text-white">{rows.length}</p>
            <p className="text-[10px] text-slate-500 uppercase">Scanned</p>
          </div>
          <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2 text-center">
            <p className="text-lg font-bold text-green-400">{bullishCount}</p>
            <p className="text-[10px] text-slate-500 uppercase">Bullish</p>
          </div>
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-center">
            <p className="text-lg font-bold text-red-400">{bearishCount}</p>
            <p className="text-[10px] text-slate-500 uppercase">Bearish</p>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-center">
            <p className="text-lg font-bold text-slate-400">{noPatternCount}</p>
            <p className="text-[10px] text-slate-500 uppercase">No Signal</p>
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto">
        {([
          { key: "all", label: "All" },
          { key: "bullish", label: "Bullish" },
          { key: "bearish", label: "Bearish" },
          { key: "none", label: "No Pattern" },
        ] as { key: typeof filterPattern; label: string }[]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterPattern(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterPattern === f.key
                ? "bg-slate-700 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700/50"
            }`}
          >
            {f.label}
          </button>
        ))}
        {/* Sort buttons */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <span className="text-xs text-slate-500">Sort:</span>
          {(["change", "price", "symbol"] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                sortKey === key
                  ? "text-cyan-400 bg-slate-800"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {key === "change" ? "% Change" : key === "price" ? "Price" : "Name"}
              {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
      </div>

      {scanning && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Scanning {coinsToScan.length} coins…</p>
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Zap className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-slate-400 text-sm">No coins match this filter</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRows.map((row, idx) => {
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
                    <p className="text-sm font-semibold text-white truncate flex items-center gap-1">
                      {row.coin.symbol}<span className="text-slate-500 font-normal">/USDT</span>
                      {row.isPro && <Crown className="w-3 h-3 text-amber-400/50" />}
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
