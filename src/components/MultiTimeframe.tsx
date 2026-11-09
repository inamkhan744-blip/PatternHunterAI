import { useEffect, useState, useCallback } from "react";
import { Layers, Loader2, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { fetchCandles } from "../lib/binance";
import { detectPattern } from "../lib/patterns";
import { sma, rsi } from "../lib/indicators";
import type { Coin, ConfluenceSignal, ConfluenceResult, Timeframe } from "../types";

interface Props {
  coin: Coin;
}

const TIMEFRAMES_TO_CHECK: Timeframe[] = ["15m", "1h", "4h", "1d"];

function analyzeTimeframe(
  tf: Timeframe,
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[]
): ConfluenceSignal {
  const closes = candles.map((c) => c.close);
  const pattern = detectPattern(candles);
  const rsiData = rsi(closes, 14);
  const lastRsi = rsiData[rsiData.length - 1] ?? 50;

  const ma7 = sma(closes, 7);
  const ma25 = sma(closes, 25);
  const lastMa7 = ma7[ma7.length - 1];
  const lastMa25 = ma25[ma25.length - 1];

  let trend: "uptrend" | "downtrend" | "sideways" = "sideways";
  if (lastMa7 !== null && lastMa25 !== null) {
    const diff = ((lastMa7 - lastMa25) / lastMa25) * 100;
    if (diff > 0.3) trend = "uptrend";
    else if (diff < -0.3) trend = "downtrend";
  }

  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  let confidence = 33;

  if (pattern) {
    direction = pattern.direction;
    confidence = 60;
  }

  if (trend === "uptrend" && (direction === "bullish" || direction === "neutral")) {
    if (direction === "neutral") direction = "bullish";
    confidence = Math.min(confidence + 15, 95);
  }
  if (trend === "downtrend" && (direction === "bearish" || direction === "neutral")) {
    if (direction === "neutral") direction = "bearish";
    confidence = Math.min(confidence + 15, 95);
  }
  if (trend === "uptrend" && direction === "bearish") confidence -= 10;
  if (trend === "downtrend" && direction === "bullish") confidence -= 10;

  if (lastRsi < 30 && direction !== "bearish") {
    direction = "bullish";
    confidence = Math.min(confidence + 8, 95);
  }
  if (lastRsi > 70 && direction !== "bullish") {
    direction = "bearish";
    confidence = Math.min(confidence + 8, 95);
  }

  return {
    timeframe: tf,
    direction,
    patternName: pattern?.name ?? null,
    rsi: lastRsi,
    trend,
    confidence: Math.max(20, Math.min(95, confidence)),
  };
}

export default function MultiTimeframe({ coin }: Props) {
  const [result, setResult] = useState<ConfluenceResult | null>(null);
  const [loading, setLoading] = useState(true);

  const analyze = useCallback(async () => {
    setLoading(true);
    const signals: ConfluenceSignal[] = [];

    for (const tf of TIMEFRAMES_TO_CHECK) {
      try {
        const data = await fetchCandles(coin.binanceSymbol, 200, tf);
        if (data.length >= 25) {
          signals.push(analyzeTimeframe(tf, data));
        }
      } catch {
        // skip failed timeframes
      }
    }

    if (signals.length === 0) {
      setLoading(false);
      return;
    }

    const bullishCount = signals.filter((s) => s.direction === "bullish").length;
    const bearishCount = signals.filter((s) => s.direction === "bearish").length;
    const neutralCount = signals.filter((s) => s.direction === "neutral").length;

    let overallDirection: "bullish" | "bearish" | "neutral" = "neutral";
    if (bullishCount > bearishCount && bullishCount > neutralCount) overallDirection = "bullish";
    else if (bearishCount > bullishCount && bearishCount > neutralCount) overallDirection = "bearish";

    const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
    const agreement = signals.length > 0
      ? (Math.max(bullishCount, bearishCount, neutralCount) / signals.length) * 100
      : 0;

    const score = overallDirection === "bullish"
      ? avgConfidence * (agreement / 100)
      : overallDirection === "bearish"
      ? -(avgConfidence * (agreement / 100))
      : 0;

    setResult({ signals, overallDirection, score, agreement });
    setLoading(false);
  }, [coin]);

  useEffect(() => {
    analyze();
  }, [analyze]);

  const dirConfig = {
    bullish: { label: "Bullish", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", icon: TrendingUp },
    bearish: { label: "Bearish", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: TrendingDown },
    neutral: { label: "Neutral", color: "text-slate-400", bg: "bg-slate-700/20", border: "border-slate-700", icon: Minus },
  };

  const overall = result ? dirConfig[result.overallDirection] : dirConfig.neutral;
  const OverallIcon = overall.icon;

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            Multi-Timeframe Confluence
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{coin.symbol}/USDT — pattern alignment across timeframes</p>
        </div>
        <button
          onClick={analyze}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Analyzing {TIMEFRAMES_TO_CHECK.length} timeframes…</p>
        </div>
      ) : result ? (
        <>
          {/* Overall signal */}
          <div className={`rounded-xl ${overall.bg} border ${overall.border} p-5 mb-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl ${overall.bg} border ${overall.border} flex items-center justify-center`}>
                  <OverallIcon className={`w-6 h-6 ${overall.color}`} />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Overall Signal</p>
                  <p className={`text-2xl font-bold ${overall.color}`}>{overall.label}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Agreement</p>
                <p className="text-2xl font-bold text-white">{result.agreement.toFixed(0)}%</p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden flex">
              {result.signals.map((sig, i) => (
                <div
                  key={i}
                  className="h-full"
                  style={{
                    width: `${100 / result.signals.length}%`,
                    backgroundColor: sig.direction === "bullish" ? "#22c55e" : sig.direction === "bearish" ? "#ef4444" : "#64748b",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Per-timeframe breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {result.signals.map((sig) => {
              const config = dirConfig[sig.direction];
              const Icon = config.icon;
              return (
                <div key={sig.timeframe} className={`rounded-xl bg-slate-900 border border-slate-800 p-4`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-white">{sig.timeframe.toUpperCase()}</span>
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
                      <Icon className="w-3 h-3" />
                      {config.label}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    {sig.patternName ? (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Pattern</span>
                        <span className="text-slate-300 truncate ml-2">{sig.patternName}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Pattern</span>
                        <span className="text-slate-600">None</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Trend</span>
                      <span className={sig.trend === "uptrend" ? "text-green-400" : sig.trend === "downtrend" ? "text-red-400" : "text-slate-400"}>
                        {sig.trend.charAt(0).toUpperCase() + sig.trend.slice(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">RSI</span>
                      <span className={sig.rsi < 30 ? "text-green-400" : sig.rsi > 70 ? "text-red-400" : "text-slate-300"}>
                        {sig.rsi.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Confidence</span>
                      <span className={`font-medium ${sig.confidence >= 70 ? "text-green-400" : sig.confidence >= 50 ? "text-amber-400" : "text-slate-400"}`}>
                        {sig.confidence.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${sig.confidence >= 70 ? "bg-green-400" : sig.confidence >= 50 ? "bg-amber-400" : "bg-slate-600"}`}
                        style={{ width: `${sig.confidence}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400 text-sm">Could not analyze timeframes for this coin.</p>
        </div>
      )}
    </div>
  );
}
