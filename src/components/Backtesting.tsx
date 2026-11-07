import { useEffect, useState, useCallback, useMemo } from "react";
import { FlaskConical, Loader2, TrendingUp, TrendingDown, Award, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { fetchCandles } from "../lib/binance";
import { detectPattern, formatPrice } from "../lib/patterns";
import { getFallbackPrices } from "../lib/fallback";
import type { Coin, Timeframe, BacktestResult, BacktestSummary } from "../types";

interface Props {
  coin: Coin;
  timeframe: Timeframe;
}

const CHUNK_SIZE = 200;
const STEP = 50;

async function runBacktest(
  symbol: string,
  timeframe: Timeframe,
  totalCandles: number
): Promise<BacktestSummary | null> {
  const allCandles = await fetchCandles(symbol, totalCandles, timeframe);
  if (allCandles.length < 100) return null;

  const results: BacktestResult[] = [];
  let position: { entry: number; sl: number; tp: number; direction: "bullish" | "bearish"; idx: number; patternName: string } | null = null;

  for (let i = STEP; i < allCandles.length - 1; i++) {
    if (position) {
      const candle = allCandles[i];
      let outcome: "win" | "loss" | null = null;

      if (position.direction === "bullish") {
        if (candle.low <= position.sl) outcome = "loss";
        else if (candle.high >= position.tp) outcome = "win";
      } else {
        if (candle.high >= position.sl) outcome = "loss";
        else if (candle.low <= position.tp) outcome = "win";
      }

      if (outcome) {
        const exitPrice = outcome === "win" ? position.tp : position.sl;
        const pnl = position.direction === "bullish"
          ? exitPrice - position.entry
          : position.entry - exitPrice;
        const pnlPercent = (pnl / position.entry) * 100;
        const candlesHeld = i - position.idx;

        results.push({
          patternName: position.patternName,
          direction: position.direction,
          entryPrice: position.entry,
          exitPrice,
          outcome,
          pnl,
          pnlPercent,
          candlesHeld,
          date: new Date(candle.time * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        });

        position = null;
      }
    }

    if (!position && i < allCandles.length - 20) {
      const window = allCandles.slice(Math.max(0, i - 50), i + 1);
      if (window.length < 25) continue;
      const pattern = detectPattern(window);
      if (pattern) {
        const prices = getFallbackPrices(pattern, allCandles[i].close);
        position = {
          entry: prices.entry,
          sl: prices.sl,
          tp: prices.tp,
          direction: pattern.direction,
          idx: i,
          patternName: pattern.name,
        };
      }
    }
  }

  if (results.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnlPercent: 0,
      bestTrade: 0,
      worstTrade: 0,
      results: [],
    };
  }

  const wins = results.filter((r) => r.outcome === "win").length;
  const losses = results.filter((r) => r.outcome === "loss").length;
  const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
  const avgPnlPercent = results.reduce((sum, r) => sum + r.pnlPercent, 0) / results.length;
  const bestTrade = Math.max(...results.map((r) => r.pnlPercent));
  const worstTrade = Math.min(...results.map((r) => r.pnlPercent));

  return {
    totalTrades: results.length,
    wins,
    losses,
    winRate: (wins / results.length) * 100,
    totalPnl,
    avgPnlPercent,
    bestTrade,
    worstTrade,
    results,
  };
}

export default function Backtesting({ coin, timeframe }: Props) {
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [historySize, setHistorySize] = useState(500);

  const analyze = useCallback(async () => {
    setLoading(true);
    const result = await runBacktest(coin.binanceSymbol, timeframe, historySize);
    setSummary(result);
    setLoading(false);
  }, [coin, timeframe, historySize]);

  useEffect(() => {
    analyze();
  }, [analyze]);

  const patternBreakdown = useMemo(() => {
    if (!summary || summary.results.length === 0) return [];
    const map = new Map<string, { total: number; wins: number; pnl: number }>();
    for (const r of summary.results) {
      const entry = map.get(r.patternName) ?? { total: 0, wins: 0, pnl: 0 };
      entry.total++;
      if (r.outcome === "win") entry.wins++;
      entry.pnl += r.pnl;
      map.set(r.patternName, entry);
    }
    return Array.from(map.entries())
      .map(([name, stats]) => ({
        name,
        ...stats,
        winRate: (stats.wins / stats.total) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate);
  }, [summary]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-cyan-400" />
            Backtesting
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{coin.symbol}/USDT — test pattern accuracy on historical data</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={historySize}
            onChange={(e) => setHistorySize(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
          >
            <option value={300}>300 candles</option>
            <option value={500}>500 candles</option>
            <option value={800}>800 candles</option>
            <option value={1000}>1000 candles</option>
          </select>
          <button
            onClick={analyze}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
            <span className="hidden sm:inline">Run</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Backtesting {historySize} candles…</p>
        </div>
      ) : summary ? (
        <>
          {summary.totalTrades === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FlaskConical className="w-12 h-12 text-slate-700 mb-3" />
              <p className="text-slate-400 font-medium">No tradeable patterns found in this period</p>
              <p className="text-sm text-slate-500 mt-1">Try a different coin, timeframe, or more history.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <p className="text-xs text-slate-500 mb-1">Total Trades</p>
                  <p className="text-2xl font-bold text-white">{summary.totalTrades}</p>
                </div>
                <div className={`rounded-xl border p-4 ${summary.winRate >= 50 ? "bg-green-500/5 border-green-500/20" : "bg-amber-500/5 border-amber-500/20"}`}>
                  <p className="text-xs text-slate-500 mb-1">Win Rate</p>
                  <p className={`text-2xl font-bold ${summary.winRate >= 50 ? "text-green-400" : "text-amber-400"}`}>
                    {summary.winRate.toFixed(1)}%
                  </p>
                </div>
                <div className={`rounded-xl border p-4 ${summary.totalPnl >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                  <p className="text-xs text-slate-500 mb-1">Total P&L</p>
                  <p className={`text-2xl font-bold ${summary.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {summary.totalPnl >= 0 ? "+" : ""}{formatPrice(Math.abs(summary.totalPnl))}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <p className="text-xs text-slate-500 mb-1">Avg P&L</p>
                  <p className={`text-2xl font-bold ${summary.avgPnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {summary.avgPnlPercent >= 0 ? "+" : ""}{summary.avgPnlPercent.toFixed(2)}%
                  </p>
                </div>
              </div>

              {/* Best/Worst */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-4 flex items-center gap-3">
                  <ArrowUpRight className="w-6 h-6 text-green-400" />
                  <div>
                    <p className="text-xs text-slate-500">Best Trade</p>
                    <p className="text-lg font-bold text-green-400">+{summary.bestTrade.toFixed(2)}%</p>
                  </div>
                </div>
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 flex items-center gap-3">
                  <ArrowDownRight className="w-6 h-6 text-red-400" />
                  <div>
                    <p className="text-xs text-slate-500">Worst Trade</p>
                    <p className="text-lg font-bold text-red-400">{summary.worstTrade.toFixed(2)}%</p>
                  </div>
                </div>
              </div>

              {/* Pattern breakdown */}
              {patternBreakdown.length > 0 && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Pattern Accuracy</span>
                  </div>
                  <div className="space-y-2">
                    {patternBreakdown.map((stat) => (
                      <div key={stat.name} className="flex items-center gap-3 text-xs">
                        <span className="text-slate-300 flex-1 truncate">{stat.name}</span>
                        <span className="text-slate-500 shrink-0">{stat.wins}W / {stat.total - stat.wins}L</span>
                        <div className="w-20 h-1.5 rounded-full bg-slate-700 overflow-hidden shrink-0">
                          <div
                            className={`h-full rounded-full ${stat.winRate >= 50 ? "bg-green-400" : "bg-amber-400"}`}
                            style={{ width: `${stat.winRate}%` }}
                          />
                        </div>
                        <span className={`w-10 text-right font-medium shrink-0 ${stat.winRate >= 50 ? "text-green-400" : "text-amber-400"}`}>
                          {stat.winRate.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trade history */}
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-800">
                  <span className="text-sm font-semibold text-white">Trade History</span>
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  {summary.results.slice().reverse().map((r, i) => {
                    const isWin = r.outcome === "win";
                    const isBullish = r.direction === "bullish";
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-6 gap-2 px-4 py-2 text-xs border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                      >
                        <span className="text-slate-500 truncate">{r.date}</span>
                        <span className={`flex items-center gap-1 ${isBullish ? "text-green-400" : "text-red-400"}`}>
                          {isBullish ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span className="truncate">{r.patternName}</span>
                        </span>
                        <span className="text-slate-300">{formatPrice(r.entryPrice)}</span>
                        <span className="text-slate-400">{formatPrice(r.exitPrice)}</span>
                        <span className="text-slate-500 text-center">{r.candlesHeld}c</span>
                        <span className={`text-right font-medium ${isWin ? "text-green-400" : "text-red-400"}`}>
                          {r.pnlPercent >= 0 ? "+" : ""}{r.pnlPercent.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400 text-sm">Could not run backtest for this coin.</p>
        </div>
      )}
    </div>
  );
}
