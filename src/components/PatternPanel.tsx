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
} from "lucide-react";
import { useState } from "react";
import type { Coin, DetectedPattern, Timeframe } from "../types";
import { formatPrice } from "../lib/patterns";
import { openBinanceApp } from "../lib/binanceLink";
import RiskCalculator from "./RiskCalculator";

interface Props {
  pattern: DetectedPattern | null;
  price: number | null;
  explanation: string | null;
  loading: boolean;
  error: string | null;
  onExplain: () => void;
  coin: Coin | null;
  timeframe: Timeframe;
  onSaveSignal: () => void;
  entryPrice: number | null;
}

export default function PatternPanel({
  pattern,
  price,
  explanation,
  loading,
  error,
  onExplain,
  coin,
  timeframe,
  onSaveSignal,
  entryPrice,
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
          <div>
            <h3 className="font-semibold text-white text-base">{pattern.name}</h3>
            <span
              className={`text-xs font-medium ${isBullish ? "text-green-400" : "text-red-400"}`}
            >
              {isBullish ? "Bullish Signal" : "Bearish Signal"}
            </span>
          </div>
        </div>
        <p className="text-sm text-slate-400">{pattern.description}</p>
        {price && (
          <p className="text-xs text-slate-500 mt-2">
            Current price: <span className="text-slate-300 font-medium">{formatPrice(price)}</span>
          </p>
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
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Try again
            </button>
          </div>
        )}

        {explanation && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                AI Analysis
              </span>
              {error && (
                <button
                  onClick={onExplain}
                  disabled={loading}
                  className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  Retry
                </button>
              )}
            </div>
            <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">
                {explanation}
              </pre>
            </div>

            {/* Save to History + Trade on Binance */}
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
                onClick={openBinanceApp}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-sm font-bold transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                Trade on Binance
              </button>
            </div>
          </div>
        )}

        {/* Risk Calculator */}
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
