import { useState, useCallback } from "react";
import { Cpu, Play, Activity, Plus, Trash2, Sliders } from "lucide-react";
import { fetchCandles } from "../lib/binance";
import { rsi, sma, ema } from "../lib/indicators";
import { formatPrice } from "../lib/patterns";
import type { Coin, Timeframe } from "../types";

interface Props {
  selectedCoin: Coin;
  timeframe: Timeframe;
}

export type IndicatorType = "RSI" | "EMA_50" | "EMA_200" | "SMA_20" | "PRICE_CLOSE";
export type OperatorType = "<" | ">" | "<=" | ">=" | "CROSSES_ABOVE" | "CROSSES_BELOW";
export type TargetType = "VALUE" | "INDICATOR";
export type ActionType = "BUY" | "SELL";

export interface StrategyRule {
  id: string;
  indicator: IndicatorType;
  operator: OperatorType;
  targetType: TargetType;
  targetValue: number;
  targetIndicator?: IndicatorType;
}

export interface StrategyConfig {
  name: string;
  action: ActionType;
  logicalOperator: "AND" | "OR";
  rules: StrategyRule[];
  stopLossPct: number;
  takeProfitPct: number;
}

export interface StrategyBacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfitPct: number;
  maxDrawdown: number;
  profitFactor: number;
  trades: {
    entryDate: string;
    exitDate: string;
    side: ActionType;
    entryPrice: number;
    exitPrice: number;
    pnlPct: number;
    outcome: "WIN" | "LOSS";
  }[];
}

const PRESETS: { name: string; config: StrategyConfig }[] = [
  {
    name: "Golden Cross + Oversold RSI",
    config: {
      name: "Golden Cross + Oversold RSI",
      action: "BUY",
      logicalOperator: "AND",
      rules: [
        {
          id: "rule-1",
          indicator: "RSI",
          operator: "<",
          targetType: "VALUE",
          targetValue: 35,
        },
        {
          id: "rule-2",
          indicator: "EMA_50",
          operator: ">",
          targetType: "INDICATOR",
          targetValue: 0,
          targetIndicator: "EMA_200",
        },
      ],
      stopLossPct: 2.5,
      takeProfitPct: 5.0,
    },
  },
  {
    name: "Mean Reversion Pullback",
    config: {
      name: "Mean Reversion Pullback",
      action: "BUY",
      logicalOperator: "AND",
      rules: [
        {
          id: "rule-1",
          indicator: "PRICE_CLOSE",
          operator: "<",
          targetType: "INDICATOR",
          targetValue: 0,
          targetIndicator: "SMA_20",
        },
        {
          id: "rule-2",
          indicator: "RSI",
          operator: "<",
          targetType: "VALUE",
          targetValue: 30,
        },
      ],
      stopLossPct: 2.0,
      takeProfitPct: 4.0,
    },
  },
  {
    name: "Overbought Short Exhaustion",
    config: {
      name: "Overbought Short Exhaustion",
      action: "SELL",
      logicalOperator: "AND",
      rules: [
        {
          id: "rule-1",
          indicator: "RSI",
          operator: ">",
          targetType: "VALUE",
          targetValue: 70,
        },
        {
          id: "rule-2",
          indicator: "EMA_50",
          operator: "<",
          targetType: "INDICATOR",
          targetValue: 0,
          targetIndicator: "EMA_200",
        },
      ],
      stopLossPct: 2.0,
      takeProfitPct: 4.5,
    },
  },
];

export default function StrategyBuilder({ selectedCoin, timeframe }: Props) {
  const [strategy, setStrategy] = useState<StrategyConfig>(PRESETS[0].config);
  const [loading, setLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<StrategyBacktestSummary | null>(null);

  const addRule = () => {
    const newRule: StrategyRule = {
      id: `rule-${Date.now()}`,
      indicator: "RSI",
      operator: "<",
      targetType: "VALUE",
      targetValue: 30,
    };
    setStrategy((prev) => ({
      ...prev,
      rules: [...prev.rules, newRule],
    }));
  };

  const removeRule = (id: string) => {
    if (strategy.rules.length <= 1) return;
    setStrategy((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== id),
    }));
  };

  const updateRule = (id: string, updates: Partial<StrategyRule>) => {
    setStrategy((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
  };

  const runBacktest = useCallback(async () => {
    setLoading(true);
    try {
      const candles = await fetchCandles(selectedCoin.binanceSymbol, 500, timeframe);
      if (candles.length < 210) {
        alert("Not enough historical candle data to simulate this strategy (need at least 210 candles).");
        setLoading(false);
        return;
      }

      const closes = candles.map((c) => c.close);
      const rsiArr = rsi(closes, 14);
      const ema50Arr = ema(closes, 50);
      const ema200Arr = ema(closes, 200);
      const sma20Arr = sma(closes, 20);

      const trades: StrategyBacktestSummary["trades"] = [];
      let inPosition = false;
      let entryPrice = 0;
      let entryDate = "";
      let entrySide: ActionType = strategy.action;
      const _peakPnl = 0;
      void _peakPnl;
      let maxDd = 0;

      const evaluateCondition = (
        indType: IndicatorType,
        op: OperatorType,
        targetType: TargetType,
        targetVal: number,
        targetInd: IndicatorType | undefined,
        idx: number
      ): boolean => {
        const getIndVal = (type: IndicatorType, index: number): number | null => {
          if (type === "RSI") return rsiArr[index];
          if (type === "EMA_50") return ema50Arr[index];
          if (type === "EMA_200") return ema200Arr[index];
          if (type === "SMA_20") return sma20Arr[index];
          if (type === "PRICE_CLOSE") return closes[index];
          return null;
        };

        const leftVal = getIndVal(indType, idx);
        if (leftVal === null || isNaN(leftVal)) return false;

        let rightVal = targetVal;
        if (targetType === "INDICATOR" && targetInd) {
          const fetchedRight = getIndVal(targetInd, idx);
          if (fetchedRight === null || isNaN(fetchedRight)) return false;
          rightVal = fetchedRight;
        }

        if (op === "<") return leftVal < rightVal;
        if (op === ">") return leftVal > rightVal;
        if (op === "<=") return leftVal <= rightVal;
        if (op === ">=") return leftVal >= rightVal;

        if (op === "CROSSES_ABOVE" && idx > 0) {
          const prevLeft = getIndVal(indType, idx - 1);
          let prevRight = targetVal;
          if (targetType === "INDICATOR" && targetInd) {
            const fetched = getIndVal(targetInd, idx - 1);
            if (fetched !== null) prevRight = fetched;
          }
          if (prevLeft === null) return false;
          return prevLeft <= prevRight && leftVal > rightVal;
        }

        if (op === "CROSSES_BELOW" && idx > 0) {
          const prevLeft = getIndVal(indType, idx - 1);
          let prevRight = targetVal;
          if (targetType === "INDICATOR" && targetInd) {
            const fetched = getIndVal(targetInd, idx - 1);
            if (fetched !== null) prevRight = fetched;
          }
          if (prevLeft === null) return false;
          return prevLeft >= prevRight && leftVal < rightVal;
        }

        return false;
      };

      // Walk forward through candles (starting at index 200 where EMA 200 is warm)
      for (let i = 200; i < candles.length - 1; i++) {
        const currentCandle = candles[i];

        if (inPosition) {
          const tpPrice = entrySide === "BUY"
            ? entryPrice * (1 + strategy.takeProfitPct / 100)
            : entryPrice * (1 - strategy.takeProfitPct / 100);

          const slPrice = entrySide === "BUY"
            ? entryPrice * (1 - strategy.stopLossPct / 100)
            : entryPrice * (1 + strategy.stopLossPct / 100);

          let exitPrice: number | null = null;
          let outcome: "WIN" | "LOSS" | null = null;

          if (entrySide === "BUY") {
            if (currentCandle.high >= tpPrice) {
              exitPrice = tpPrice;
              outcome = "WIN";
            } else if (currentCandle.low <= slPrice) {
              exitPrice = slPrice;
              outcome = "LOSS";
            }
          } else {
            // SELL (SHORT)
            if (currentCandle.low <= tpPrice) {
              exitPrice = tpPrice;
              outcome = "WIN";
            } else if (currentCandle.high >= slPrice) {
              exitPrice = slPrice;
              outcome = "LOSS";
            }
          }

          if (outcome && exitPrice !== null) {
            const diffPct = entrySide === "BUY"
              ? ((exitPrice - entryPrice) / entryPrice) * 100
              : ((entryPrice - exitPrice) / entryPrice) * 100;

            trades.push({
              entryDate,
              exitDate: new Date(currentCandle.time * 1000).toLocaleDateString(),
              side: entrySide,
              entryPrice,
              exitPrice,
              pnlPct: Number(diffPct.toFixed(2)),
              outcome,
            });

            inPosition = false;
          }
        }

        // Check entry conditions
        if (!inPosition && i < candles.length - 5) {
          const ruleResults = strategy.rules.map((r) =>
            evaluateCondition(r.indicator, r.operator, r.targetType, r.targetValue, r.targetIndicator, i)
          );

          const signalTriggered = strategy.logicalOperator === "AND"
            ? ruleResults.every(Boolean)
            : ruleResults.some(Boolean);

          if (signalTriggered) {
            inPosition = true;
            entryPrice = currentCandle.close;
            entryDate = new Date(currentCandle.time * 1000).toLocaleDateString();
            entrySide = strategy.action;
          }
        }
      }

      // Compute statistics
      const wins = trades.filter((t) => t.outcome === "WIN").length;
      const losses = trades.filter((t) => t.outcome === "LOSS").length;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      const totalProfitPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);

      // Compute Max Drawdown from cumulative equity curve
      let equity = 100;
      let peak = 100;
      for (const t of trades) {
        equity = equity * (1 + t.pnlPct / 100);
        if (equity > peak) peak = equity;
        const dd = ((peak - equity) / peak) * 100;
        if (dd > maxDd) maxDd = dd;
      }

      const grossWins = trades.filter((t) => t.pnlPct > 0).reduce((acc, t) => acc + t.pnlPct, 0);
      const grossLosses = Math.abs(trades.filter((t) => t.pnlPct < 0).reduce((acc, t) => acc + t.pnlPct, 0));
      const profitFactor = grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 99 : 0;

      setBacktestResult({
        totalTrades: trades.length,
        wins,
        losses,
        winRate: Number(winRate.toFixed(1)),
        totalProfitPct: Number(totalProfitPct.toFixed(2)),
        maxDrawdown: Number(maxDd.toFixed(2)),
        profitFactor,
        trades,
      });
    } catch (e) {
      console.error("Backtest simulation failed:", e);
      alert("Error occurred during strategy backtest execution.");
    } finally {
      setLoading(false);
    }
  }, [selectedCoin.binanceSymbol, timeframe, strategy]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-[#090d16] border border-cyan-500/30 p-5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-white uppercase tracking-wider">
                VISUAL STRATEGY BUILDER // NO-CODE QUANT ENGINE
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 uppercase">
                HISTORICAL SIMULATOR
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Construct automated trading algorithms with natural visual logic blocks. Instantly backtest against the last 500 candles on {selectedCoin.symbol}/USDT ({timeframe}).
            </p>
          </div>
        </div>

        {/* Preset Strategies Quick Select */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-400 font-sans">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setStrategy(p.config);
                setBacktestResult(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                strategy.name === p.name
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                  : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Visual Rule Builder Matrix */}
      <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-black text-white uppercase tracking-wider">
              STRATEGY LOGIC SPECIFICATION
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 uppercase">RULE OPERATOR:</span>
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
              <button
                onClick={() => setStrategy((s) => ({ ...s, logicalOperator: "AND" }))}
                className={`px-3 py-1 rounded text-xs font-bold transition ${
                  strategy.logicalOperator === "AND"
                    ? "bg-cyan-500 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                AND (All Must Match)
              </button>
              <button
                onClick={() => setStrategy((s) => ({ ...s, logicalOperator: "OR" }))}
                className={`px-3 py-1 rounded text-xs font-bold transition ${
                  strategy.logicalOperator === "OR"
                    ? "bg-cyan-500 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                OR (Any May Match)
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Condition Rows */}
        <div className="space-y-3">
          {strategy.rules.map((rule, index) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex-wrap"
            >
              <span className="text-xs font-black text-cyan-400 w-12">
                {index === 0 ? "IF" : strategy.logicalOperator}
              </span>

              {/* Left Indicator */}
              <select
                value={rule.indicator}
                onChange={(e) => updateRule(rule.id, { indicator: e.target.value as IndicatorType })}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-bold outline-none focus:border-cyan-500"
              >
                <option value="RSI">RSI (14)</option>
                <option value="EMA_50">EMA (50)</option>
                <option value="EMA_200">EMA (200)</option>
                <option value="SMA_20">SMA (20)</option>
                <option value="PRICE_CLOSE">Price Close</option>
              </select>

              {/* Operator */}
              <select
                value={rule.operator}
                onChange={(e) => updateRule(rule.id, { operator: e.target.value as OperatorType })}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-amber-400 font-bold outline-none focus:border-cyan-500"
              >
                <option value="<">is less than (&lt;)</option>
                <option value=">">is greater than (&gt;)</option>
                <option value="<=">is &le;</option>
                <option value=">=">is &ge;</option>
                <option value="CROSSES_ABOVE">Crosses Above</option>
                <option value="CROSSES_BELOW">Crosses Below</option>
              </select>

              {/* Target Type Selector */}
              <select
                value={rule.targetType}
                onChange={(e) => updateRule(rule.id, { targetType: e.target.value as TargetType })}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-cyan-500"
              >
                <option value="VALUE">Fixed Value</option>
                <option value="INDICATOR">Another Indicator</option>
              </select>

              {/* Target Value or Indicator */}
              {rule.targetType === "VALUE" ? (
                <input
                  type="number"
                  step="any"
                  value={rule.targetValue}
                  onChange={(e) => updateRule(rule.id, { targetValue: parseFloat(e.target.value) || 0 })}
                  className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-[#00ff66] font-bold outline-none focus:border-cyan-500"
                />
              ) : (
                <select
                  value={rule.targetIndicator || "EMA_200"}
                  onChange={(e) => updateRule(rule.id, { targetIndicator: e.target.value as IndicatorType })}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-cyan-300 font-bold outline-none focus:border-cyan-500"
                >
                  <option value="EMA_200">EMA (200)</option>
                  <option value="EMA_50">EMA (50)</option>
                  <option value="SMA_20">SMA (20)</option>
                  <option value="RSI">RSI (14)</option>
                  <option value="PRICE_CLOSE">Price Close</option>
                </select>
              )}

              {/* Delete button */}
              {strategy.rules.length > 1 && (
                <button
                  onClick={() => removeRule(rule.id)}
                  className="p-2 text-slate-500 hover:text-red-400 transition ml-auto"
                  title="Remove condition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add Condition & Execution Action */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3 flex-wrap gap-3">
          <button
            onClick={addRule}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300 transition"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            <span>ADD CONDITION</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs font-black text-amber-400">THEN EXECUTE:</span>
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
              <button
                onClick={() => setStrategy((s) => ({ ...s, action: "BUY" }))}
                className={`px-4 py-1.5 rounded text-xs font-black uppercase transition ${
                  strategy.action === "BUY"
                    ? "bg-[#00ff66] text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                BUY (LONG)
              </button>
              <button
                onClick={() => setStrategy((s) => ({ ...s, action: "SELL" }))}
                className={`px-4 py-1.5 rounded text-xs font-black uppercase transition ${
                  strategy.action === "SELL"
                    ? "bg-[#ff3344] text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                SELL (SHORT)
              </button>
            </div>
          </div>
        </div>

        {/* Risk Management SL / TP */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-850 flex items-center justify-between">
            <span className="text-xs text-slate-400">STOP LOSS SAFEGUARD:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="20"
                value={strategy.stopLossPct}
                onChange={(e) => setStrategy((s) => ({ ...s, stopLossPct: parseFloat(e.target.value) || 1 }))}
                className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-[#ff3344] font-bold outline-none text-right"
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-850 flex items-center justify-between">
            <span className="text-xs text-slate-400">TAKE PROFIT TARGET:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="50"
                value={strategy.takeProfitPct}
                onChange={(e) => setStrategy((s) => ({ ...s, takeProfitPct: parseFloat(e.target.value) || 1 }))}
                className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-[#00ff66] font-bold outline-none text-right"
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>
        </div>

        {/* Backtest Button */}
        <div className="pt-2">
          <button
            onClick={runBacktest}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-cyan-950/40 disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>SIMULATING OVER LAST 500 CANDLES...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-slate-950" />
                <span>BACKTEST STRATEGY ON LAST 500 CANDLES ({selectedCoin.symbol} · {timeframe})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Backtest Output Dashboard */}
      {backtestResult && (
        <div className="space-y-5 animate-in fade-in duration-300">
          {/* Key Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl bg-[#090d16] border border-slate-800 p-4">
              <span className="text-[10px] text-slate-500 uppercase block mb-1">TOTAL TRADES</span>
              <span className="text-2xl font-black text-white">{backtestResult.totalTrades}</span>
              <span className="text-[10px] text-slate-500 block mt-1">
                {backtestResult.wins}W / {backtestResult.losses}L
              </span>
            </div>

            <div className={`rounded-xl border p-4 ${backtestResult.winRate >= 50 ? "bg-green-950/20 border-green-500/30" : "bg-amber-950/20 border-amber-500/30"}`}>
              <span className="text-[10px] text-slate-500 uppercase block mb-1">WIN RATE</span>
              <span className={`text-2xl font-black ${backtestResult.winRate >= 50 ? "text-[#00ff66]" : "text-amber-400"}`}>
                {backtestResult.winRate}%
              </span>
              <span className="text-[10px] text-slate-500 block mt-1">
                {backtestResult.winRate >= 50 ? "Statistically Profitable" : "Underperforming"}
              </span>
            </div>

            <div className={`rounded-xl border p-4 ${backtestResult.totalProfitPct >= 0 ? "bg-green-950/20 border-green-500/30" : "bg-red-950/20 border-red-500/30"}`}>
              <span className="text-[10px] text-slate-500 uppercase block mb-1">TOTAL PROFIT</span>
              <span className={`text-2xl font-black ${backtestResult.totalProfitPct >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                {backtestResult.totalProfitPct >= 0 ? "+" : ""}{backtestResult.totalProfitPct}%
              </span>
              <span className="text-[10px] text-slate-500 block mt-1">Cumulative return</span>
            </div>

            <div className="rounded-xl bg-red-950/20 border border-red-500/30 p-4">
              <span className="text-[10px] text-slate-500 uppercase block mb-1">MAX DRAWDOWN</span>
              <span className="text-2xl font-black text-[#ff3344]">
                -{backtestResult.maxDrawdown}%
              </span>
              <span className="text-[10px] text-slate-500 block mt-1">Peak-to-trough drop</span>
            </div>
          </div>

          {/* Trade Execution Audit Log */}
          <div className="rounded-2xl bg-[#090d16] border border-slate-800 overflow-hidden shadow-xl">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-black text-white uppercase tracking-wider">
                  STRATEGY TRADE AUDIT LOG ({backtestResult.trades.length} EXECUTIONS)
                </h3>
              </div>
              <span className="text-[10px] text-slate-500">Last 500 candles</span>
            </div>

            {backtestResult.trades.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No trades triggered by this rule combination on the selected timeframe.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-500 border-b border-slate-800 text-[10px] uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Side</th>
                      <th className="py-2.5 px-4">Entry Date</th>
                      <th className="py-2.5 px-4">Entry Price</th>
                      <th className="py-2.5 px-4">Exit Price</th>
                      <th className="py-2.5 px-4">P&L (%)</th>
                      <th className="py-2.5 px-4 text-right">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {backtestResult.trades.slice().reverse().map((trade, i) => (
                      <tr key={i} className="hover:bg-slate-900/40 transition">
                        <td className="py-2.5 px-4 font-bold">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${trade.side === "BUY" ? "bg-green-500/20 text-[#00ff66]" : "bg-red-500/20 text-[#ff3344]"}`}>
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">{trade.entryDate}</td>
                        <td className="py-2.5 px-4 text-white font-bold">${formatPrice(trade.entryPrice)}</td>
                        <td className="py-2.5 px-4 text-slate-300">${formatPrice(trade.exitPrice)}</td>
                        <td className={`py-2.5 px-4 font-black ${trade.pnlPct >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                          {trade.pnlPct >= 0 ? "+" : ""}{trade.pnlPct}%
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${trade.outcome === "WIN" ? "bg-green-500/20 text-[#00ff66]" : "bg-red-500/20 text-[#ff3344]"}`}>
                            {trade.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
