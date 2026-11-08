import { X, ShieldAlert, CheckCircle2, XCircle, Target, Zap, AlertTriangle, ArrowRight } from "lucide-react";
import type { ConfluenceResult } from "../lib/ConfluenceEngine";

interface Props {
  open: boolean;
  onClose: () => void;
  result: ConfluenceResult | null;
  symbol?: string;
  timeframe?: string;
  onExecuteTrade?: () => void;
  fomoLocked?: boolean;
  fomoRemainingSeconds?: number;
}

export default function SniperChecklistModal({
  open,
  onClose,
  result,
  symbol = "BTC/USDT",
  timeframe = "1H",
  onExecuteTrade,
  fomoLocked = false,
  fomoRemainingSeconds = 0,
}: Props) {
  if (!open || !result) return null;

  const { score, canExecute, items, setupBias, currentPrice } = result;

  const scoreColor =
    score >= 85
      ? "text-green-400"
      : score >= 60
      ? "text-yellow-400"
      : "text-red-400";

  const progressBg =
    score >= 85
      ? "bg-green-500"
      : score >= 60
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] z-10">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Sniper Confluence Setup
                </h3>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {symbol} · {timeframe}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-Timeframe & SMC Execution Filter
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Score Card */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Confluence Score
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-3xl font-extrabold ${scoreColor}`}>
                  {score}
                </span>
                <span className="text-sm font-semibold text-slate-500">
                  / 100
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Bias: <strong className={setupBias === "Bullish" ? "text-green-400" : setupBias === "Bearish" ? "text-red-400" : "text-slate-300"}>{setupBias}</strong> | Price: <strong className="text-white">${currentPrice.toFixed(2)}</strong>
              </p>
            </div>

            {/* Score Pill / Status */}
            <div className="text-right flex flex-col items-end">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                  canExecute
                    ? "bg-green-500/15 text-green-400 border-green-500/30"
                    : "bg-red-500/15 text-red-400 border-red-500/30"
                }`}
              >
                {canExecute ? (
                  <>
                    <Zap className="w-3.5 h-3.5" /> High Confluence
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5" /> Low Confluence
                  </>
                )}
              </span>
              <span className="text-[11px] text-slate-500 mt-1.5">
                Min. 85 required for execution
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${progressBg}`}
              style={{ width: `${Math.max(4, score)}%` }}
            />
          </div>

          {/* Checklist Items */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
              Sniper Checklist Verification
            </h4>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border transition-all ${
                    item.passed
                      ? "bg-green-500/5 border-green-500/20 hover:border-green-500/40"
                      : "bg-red-500/5 border-red-500/20 hover:border-red-500/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">
                        {item.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">
                            {item.name}
                          </span>
                        </div>
                        <p className={`text-xs mt-0.5 font-medium ${item.passed ? "text-green-300" : "text-red-300"}`}>
                          {item.passed ? "✅ " : "❌ "}
                          {item.message}
                        </p>
                        {item.detail && (
                          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                            {item.detail}
                          </p>
                        )}
                      </div>
                    </div>

                    <span
                      className={`text-xs font-mono font-bold shrink-0 px-2 py-0.5 rounded ${
                        item.passed
                          ? "bg-green-500/20 text-green-400"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      +{item.score}/{item.maxScore}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FOMO Lock Warning Banner (if FOMO locked) */}
          {fomoLocked && (
            <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/40 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
              <div className="text-xs">
                <p className="font-bold text-red-300">
                  🚨 Anti-FOMO Lock Active: Trading Disabled
                </p>
                <p className="text-red-200/90 mt-0.5 leading-relaxed">
                  Price moved &gt;8% in the last hour. Buy/Sell execution is locked for discipline ({Math.ceil(fomoRemainingSeconds / 60)} minutes remaining).
                </p>
              </div>
            </div>
          )}

          {/* Execution Warning Banner (if score < 85 and not fomo locked) */}
          {!fomoLocked && !canExecute && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-amber-300">
                  Low Confluence. Wait for a better setup.
                </p>
                <p className="text-amber-200/80 mt-0.5 leading-relaxed">
                  The Sniper Confluence score is currently {score}/100. Trade execution is locked until score reaches at least 85 to preserve capital and eliminate low-probability signals.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / Execution Action */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Close
          </button>

          <button
            disabled={!canExecute || fomoLocked}
            onClick={() => {
              if (fomoLocked) {
                alert("🚨 Trade execution disabled: Anti-FOMO Lock active.");
                return;
              }
              if (canExecute) {
                if (onExecuteTrade) onExecuteTrade();
                onClose();
              }
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all ${
              !fomoLocked && canExecute
                ? "bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-slate-950 shadow-green-500/20 active:scale-95 cursor-pointer"
                : "bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-60"
            }`}
            title={
              fomoLocked
                ? `Trade locked: Anti-FOMO active (${Math.ceil(fomoRemainingSeconds / 60)}m left)`
                : !canExecute
                ? "Execution locked: Score must be 85 or higher"
                : "Execute trade"
            }
          >
            <span>{fomoLocked ? "Locked (Anti-FOMO)" : "Execute Trade"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
