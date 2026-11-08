import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Loader2,
  AlertCircle,
  Info,
  RotateCcw,
  ExternalLink,
  Save,
  Check,
  Target,
  Shield,
} from "lucide-react";
import { useState } from "react";
import type { Coin, DetectedPattern, Timeframe, PatternWithConfidence } from "../types";
import { formatPrice } from "../lib/patterns";
import { getPatternColor } from "../lib/patterns";
import { openBinanceApp } from "../lib/binanceLink";
import RiskCalculator from "./RiskCalculator";

interface Props {
  pattern: DetectedPattern | null;
  allPatterns: PatternWithConfidence[];
  price: number | null;
  explanation: string | null;
  loading: boolean;
  error: string | null;
  onExplain: () => void;
  coin: Coin | null;
  timeframe: Timeframe;
  onSaveSignal: () => void;
  entryPrice: number | null;
  slPrice: number | null;
  tpPrice: number | null;
  fomoLocked?: boolean;
  fomoRemainingSeconds?: number;
}

function confidenceColor(conf: number): string {
  if (conf >= 75) return "text-green-400";
  if (conf >= 55) return "text-amber-400";
  return "text-slate-400";
}

function confidenceBarColor(conf: number): string {
  if (conf >= 75) return "bg-green-400";
  if (conf >= 55) return "bg-amber-400";
  return "bg-slate-500";
}

export default function PatternPanel({
  pattern,
  allPatterns,
  price,
  explanation,
  loading,
  error,
  onExplain,
  coin,
  timeframe,
  onSaveSignal,
  entryPrice,
  slPrice,
  tpPrice,
  fomoLocked = false,
  fomoRemainingSeconds = 0,
}: Props) {
  const [saved, setSaved] = useState(false);

  if (!pattern) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
        <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <Sparkles className="w-7 h-7 text-slate-500" />
        </div>
        <p className="text-slate-400 font-medium">Scanning for patterns…</p>
        <p className="text-sm text-slate-500 mt-1">
          Analyzing the last 50 candles for classic chart patterns including Head & Shoulders, Flags, Triangles, Wedges, and more.
        </p>
      </div>
    );
  }

  const isBullish = pattern.direction === "bullish";
  const topConfidence = allPatterns.length > 0 ? allPatterns[0].confidence : 0;

  const handleSave = () => {
    onSaveSignal();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isBullish ? "bg-green-500/10" : "bg-red-500/10"
            }`}
          >
            {isBullish ? (
              <TrendingUp className="w-5 h-5 text-green-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white text-base">{pattern.name}</h3>
            <span
              className={`text-xs font-medium ${isBullish ? "text-green-400" : "text-red-400"}`}
            >
              {isBullish ? "Bullish Signal" : "Bearish Signal"}
            </span>
          </div>
          {topConfidence > 0 && (
            <div className="text-right">
              <p className={`text-2xl font-bold ${confidenceColor(topConfidence)}`}>{topConfidence}%</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Confidence</p>
            </div>
          )}
        </div>
        <p className="text-sm text-slate-400">{pattern.description}</p>
        {price && (
          <p className="text-xs text-slate-500 mt-2">
            Current price: <span className="text-slate-300 font-medium">{formatPrice(price)}</span>
          </p>
        )}

        {/* Multi-pattern list */}
        {allPatterns.length > 1 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">All Detected Patterns</p>
            {allPatterns.slice(0, 5).map((p, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getPatternColor(p.pattern.type) }}
                />
                <span className="text-slate-300 flex-1 truncate">{p.pattern.name}</span>
                <div className="w-16 h-1 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${confidenceBarColor(p.confidence)}`}
                    style={{ width: `${p.confidence}%` }}
                  />
                </div>
                <span className={`w-8 text-right ${confidenceColor(p.confidence)}`}>{p.confidence}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 p-5 overflow-y-auto">
        {error && explanation && (
          <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-300/90">{error}</p>
          </div>
        )}

        {error && !explanation && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-slate-400 font-medium mb-1">AI analysis is currently unavailable</p>
            <p className="text-sm text-slate-500 mb-4">Please try again in a moment.</p>
            <button
              onClick={onExplain}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Try again
            </button>
          </div>
        )}

        {explanation && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">AI Analysis</span>
              {error && (
                <button
                  onClick={onExplain}
                  disabled={loading}
                  className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Retry
                </button>
              )}
            </div>

            {/* Entry/SL/TP grid */}
            {entryPrice && slPrice && tpPrice && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-lg bg-slate-800/50 border border-slate-700 px-3 py-2.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Target className="w-3 h-3 text-cyan-400" />
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Entry</p>
                  </div>
                  <p className="text-sm font-bold text-slate-200">{formatPrice(entryPrice)}</p>
                </div>
                <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-3 py-2.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <TrendingUp className="w-3 h-3 text-green-400" />
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Take Profit</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">{formatPrice(tpPrice)}</p>
                </div>
                <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Shield className="w-3 h-3 text-red-400" />
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Stop Loss</p>
                  </div>
                  <p className="text-sm font-bold text-red-400">{formatPrice(slPrice)}</p>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">
                {explanation}
              </pre>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleSave}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4 text-green-400" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save to History
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  if (fomoLocked) {
                    alert("🚨 Trade execution disabled: Anti-FOMO Lock active. Please wait for cooldown.");
                    return;
                  }
                  openBinanceApp();
                }}
                disabled={fomoLocked}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-bold transition-all ${
                  fomoLocked
                    ? "bg-red-500/20 text-red-400 border border-red-500/40 cursor-not-allowed opacity-60"
                    : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900"
                }`}
                title={fomoLocked ? `Trade locked: Anti-FOMO active (${Math.ceil(fomoRemainingSeconds / 60)}m left)` : "Trade on Binance"}
              >
                <ExternalLink className="w-4 h-4" />
                {fomoLocked ? `Locked (${Math.ceil(fomoRemainingSeconds / 60)}m)` : "Trade on Binance"}
              </button>
            </div>
          </div>
        )}

        <RiskCalculator entryPrice={entryPrice ?? price} />

        {!error && !explanation && (
          <button
            onClick={onExplain}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing pattern…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Get AI Trade Analysis
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
