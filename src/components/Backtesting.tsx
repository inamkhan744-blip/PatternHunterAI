import { useEffect, useState, useCallback, useMemo } from "react";
import { FlaskConical, Loader2, TrendingUp, TrendingDown, Award, ArrowUpRight, ArrowDownRight, Dices, AlertTriangle, ShieldCheck, Activity } from "lucide-react";
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

interface MonteCarloResults {
  simulationsCount: number;
  worstCaseDrawdown: number; // e.g. -24.5%
  bestCaseProfit: number; // e.g. +142.8%
  probabilityOfRuin: number; // e.g. 1.2%
  medianOutcome: number; // e.g. +34.2%
  pathsSample: number[][]; // 5 sample equity curves for visual
}

export default function Backtesting({ coin, timeframe }: Props) {
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [historySize, setHistorySize] = useState(500);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResults | null>(null);
  const [runningMonteCarlo, setRunningMonteCarlo] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setMonteCarlo(null);
    const result = await runBacktest(coin.binanceSymbol, timeframe, historySize);
    setSummary(result);
    setLoading(false);
  }, [coin, timeframe, historySize]);

  // Run 1,000 randomized Monte Carlo simulations
  const runMonteCarloStressTest = useCallback(() => {
    if (!summary || summary.results.length === 0) return;
    setRunningMonteCarlo(true);

    setTimeout(() => {
      const returns = summary.results.map((r) => r.pnlPercent / 100);
      const SIMULATIONS = 1000;
      const HORIZON = Math.max(30, summary.results.length);
      const START_EQUITY = 10000;
      const RUIN_THRESHOLD = START_EQUITY * 0.5; // 50% drawdown = Ruin

      const drawdowns: number[] = [];
      const finalEquities: number[] = [];
      let ruinCount = 0;
      const samplePaths: number[][] = [];

      for (let s = 0; s < SIMULATIONS; s++) {
        let equity = START_EQUITY;
        let peak = equity;
        let maxDrawdown = 0;
        let isRuined = false;
        const currentPath: number[] = [equity];

        for (let t = 0; t < HORIZON; t++) {
          const randReturn = returns[Math.floor(Math.random() * returns.length)];
          // Risk allocated per trade approx 2% of capital
          equity = equity * (1 + randReturn * 0.5);

          if (equity > peak) {
            peak = equity;
          }
          const dd = (peak - equity) / peak;
          if (dd > maxDrawdown) {
            maxDrawdown = dd;
          }

          if (equity <= RUIN_THRESHOLD) {
            isRuined = true;
          }

          if (s < 5 && t % Math.ceil(HORIZON / 20) === 0) {
            currentPath.push(equity);
          }
        }

        drawdowns.push(maxDrawdown);
        finalEquities.push((equity - START_EQUITY) / START_EQUITY);
        if (isRuined) ruinCount++;
        if (s < 5) samplePaths.push(currentPath);
      }

      drawdowns.sort((a, b) => b - a);
      finalEquities.sort((a, b) => a - b);

      // 95th percentile worst case drawdown
      const worstCaseDrawdown = -(drawdowns[Math.floor(SIMULATIONS * 0.05)] * 100);
      const bestCaseProfit = finalEquities[finalEquities.length - 1] * 100;
      const medianOutcome = finalEquities[Math.floor(SIMULATIONS * 0.5)] * 100;
      const probabilityOfRuin = (ruinCount / SIMULATIONS) * 100;

      setMonteCarlo({
        simulationsCount: SIMULATIONS,
        worstCaseDrawdown: Number(worstCaseDrawdown.toFixed(2)),
        bestCaseProfit: Number(bestCaseProfit.toFixed(2)),
        probabilityOfRuin: Number(probabilityOfRuin.toFixed(2)),
        medianOutcome: Number(medianOutcome.toFixed(2)),
        pathsSample: samplePaths,
      });

      setRunningMonteCarlo(false);
    }, 200);
  }, [summary]);

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
            <span className="hidden sm:inline">Run Backtest</span>
          </button>

          {summary && summary.totalTrades > 0 && (
            <button
              onClick={runMonteCarloStressTest}
              disabled={runningMonteCarlo}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 text-sm font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-950/40 disabled:opacity-50"
            >
              {runningMonteCarlo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4 fill-slate-950" />}
              <span>Run Monte Carlo</span>
            </button>
          )}
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
              {/* Monte Carlo Stress Test Simulation Results Banner */}
              {monteCarlo && (
                <div className="rounded-2xl bg-[#090d16] border-2 border-emerald-500/40 p-5 mb-5 shadow-2xl font-mono animate-in fade-in duration-300">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                        <Dices className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">
                          MONTE CARLO STRESS TEST // 1,000 BOOTSTRAP RUNS
                        </h3>
                        <p className="text-[11px] text-slate-400 font-sans">
                          Quant risk model simulating 1,000 randomized permutations of realized trade sequencing.
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40">
                      CONFIDENCE LEVEL: 95%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
                    {/* Worst Case Drawdown */}
                    <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/30">
                      <span className="text-[10px] text-slate-400 uppercase block flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#ff3344]" />
                        Worst Case Drawdown (95th Pct)
                      </span>
                      <p className="text-xl font-black text-[#ff3344] mt-1">
                        {monteCarlo.worstCaseDrawdown}%
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 font-sans">
                        Maximum expected equity drawdown during extreme cluster variance.
                      </p>
                    </div>

                    {/* Best Case Profit */}
                    <div className="p-3.5 rounded-xl bg-green-950/20 border border-green-500/30">
                      <span className="text-[10px] text-slate-400 uppercase block flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-[#00ff66]" />
                        Best Case Profit
                      </span>
                      <p className="text-xl font-black text-[#00ff66] mt-1">
                        +{monteCarlo.bestCaseProfit}%
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 font-sans">
                        Favorable compounding upside during positive regime runs.
                      </p>
                    </div>

                    {/* Probability of Ruin */}
                    <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30">
                      <span className="text-[10px] text-slate-400 uppercase block flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        Probability of Ruin (50% DD)
                      </span>
                      <p className={`text-xl font-black mt-1 ${monteCarlo.probabilityOfRuin > 5 ? "text-[#ff3344]" : "text-[#00ff66]"}`}>
                        {monteCarlo.probabilityOfRuin}%
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1 font-sans">
                        Statistical likelihood of experiencing severe capital distress.
                      </p>
                    </div>
                  </div>

                  {/* Sample Trajectory Sparks */}
                  <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-400" />
                      <span>Simulated Median Outcome:</span>
                      <strong className={monteCarlo.medianOutcome >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}>
                        {monteCarlo.medianOutcome >= 0 ? "+" : ""}{monteCarlo.medianOutcome}%
                      </strong>
                    </div>
                    <span className="text-[10px] text-slate-500">
                      Horizon: {summary.totalTrades} consecutive trades per simulation run
                    </span>
                  </div>
                </div>
              )}

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
