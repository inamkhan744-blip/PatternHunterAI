import React, { useState, useEffect } from "react";
import {
  Cpu,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Zap,
  Terminal,
  Activity,
  X,
} from "lucide-react";
import {
  simulateSwarmDebate,
  runRealSwarmDebate,
  SwarmDebateResult,
  SwarmAgentMessage,
} from "../lib/AgentSwarm";
import { formatPrice } from "../lib/patterns";

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  price: number | null;
  rsi?: number | null;
  trend?: string | null;
  patternName?: string | null;
  patternDirection?: "bullish" | "bearish" | null;
  fearGreed?: number | null;
  onExecuteTrade?: (direction: "LONG" | "SHORT", leverage: number) => void;
}

export default function SwarmTerminal({
  open,
  onClose,
  symbol,
  price,
  rsi,
  trend,
  patternName,
  patternDirection,
  fearGreed,
  onExecuteTrade,
}: Props) {
  const [result, setResult] = useState<SwarmDebateResult | null>(null);
  const [visibleMessages, setVisibleMessages] = useState<SwarmAgentMessage[]>([]);
  const [debating, setDebating] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(0);

  const startDebate = async () => {
    const effectivePrice = price || 65000;
    setDebating(true);
    setVisibleMessages([]);
    setActiveStep(0);

    const debate = await runRealSwarmDebate({
      symbol,
      price: effectivePrice,
      rsi: rsi || 52,
      trend: trend || "UPTREND",
      patternName: patternName || "Consolidation Breakout",
      patternDirection: patternDirection || "bullish",
      fearGreed: fearGreed || 60,
    });
    setResult(debate);

    // Stream the 3 agents in sequence like a live Bloomberg terminal debate
    setTimeout(() => {
      setVisibleMessages([debate.messages[0]]);
      setActiveStep(1);
    }, 500);

    setTimeout(() => {
      setVisibleMessages([debate.messages[0], debate.messages[1]]);
      setActiveStep(2);
    }, 1200);

    setTimeout(() => {
      setVisibleMessages([debate.messages[0], debate.messages[1], debate.messages[2]]);
      setActiveStep(3);
      setDebating(false);
    }, 1900);
  };

  useEffect(() => {
    if (open) {
      startDebate();
    }
  }, [open, symbol]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-[#05070d] border-2 border-emerald-500/40 rounded-2xl shadow-2xl shadow-emerald-950/70 overflow-hidden flex flex-col max-h-[92vh] text-white font-mono">
        {/* Terminal Header */}
        <div className="px-5 py-3.5 border-b border-emerald-900/60 bg-[#030509] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-md">
              <Cpu className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-widest text-emerald-400 uppercase">
                  BLOOMBERG AI SWARM // HEDGE FUND DEBATE
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  {result?.isRealAI ? "⚡ GEMINI LIVE NEURAL TRIAGE" : "3-AGENT TRIAGE"}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Target: <span className="text-white font-bold">{symbol}</span> @ ${price ? formatPrice(price) : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={startDebate}
              disabled={debating}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs border border-slate-700 flex items-center gap-1 transition disabled:opacity-50"
              title="Rerun debate"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${debating ? "animate-spin text-emerald-400" : ""}`} />
              <span className="text-[10px] hidden sm:inline">Rerun</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition border border-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Bloomberg Status Bar */}
        <div className="px-5 py-2 bg-[#020408] border-b border-emerald-900/40 flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
          <div className="flex items-center gap-4">
            <span>RSI(14): <strong className="text-white font-bold">{rsi ? rsi.toFixed(1) : "52.0"}</strong></span>
            <span>Trend: <strong className="text-emerald-400 font-bold uppercase">{trend || "UPTREND"}</strong></span>
            <span>Pattern: <strong className="text-amber-400 font-bold">{patternName || "Accumulation Base"}</strong></span>
          </div>

          {result && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Confluence Score:</span>
              <span className={`font-black text-xs px-2 py-0.5 rounded border ${
                result.confluenceScore >= 62
                  ? "bg-emerald-500/20 text-[#00ff66] border-emerald-500/50"
                  : "bg-red-500/20 text-[#ff3344] border-red-500/50"
              }`}>
                {result.confluenceScore} / 100
              </span>
            </div>
          )}
        </div>

        {/* Debate Transcript Log */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-[#03060c]">
          {visibleMessages.length === 0 && debating && (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-3">
              <Activity className="w-8 h-8 text-emerald-400 animate-spin" />
              <span className="text-xs text-emerald-400 font-bold tracking-widest uppercase">
                Synchronizing Agent Neural Consensus...
              </span>
            </div>
          )}

          {visibleMessages.map((msg, idx) => {
            const isBull = msg.role === "BULL";
            const isBear = msg.role === "BEAR";
            const isRisk = msg.role === "RISK";

            const cardBorder = isBull
              ? "border-green-500/40 bg-green-950/15"
              : isBear
              ? "border-red-500/40 bg-red-950/15"
              : msg.sentiment === "GO"
              ? "border-emerald-400 bg-emerald-950/30"
              : "border-amber-500/40 bg-amber-950/20";

            return (
              <div
                key={idx}
                className={`p-4 rounded-xl border ${cardBorder} shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isBull && <TrendingUp className="w-4 h-4 text-[#00ff66]" />}
                    {isBear && <TrendingDown className="w-4 h-4 text-[#ff3344]" />}
                    {isRisk && <ShieldAlert className="w-4 h-4 text-cyan-400" />}

                    <span className="text-xs font-black uppercase tracking-wider text-white">
                      {msg.agent}
                    </span>

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        isBull
                          ? "bg-green-500/20 text-[#00ff66]"
                          : isBear
                          ? "bg-red-500/20 text-[#ff3344]"
                          : msg.sentiment === "GO"
                          ? "bg-emerald-500/30 text-emerald-300 font-black"
                          : "bg-red-500/30 text-red-300 font-black"
                      }`}
                    >
                      {msg.sentiment}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                    <span>Confidence: <strong className="text-white">{msg.confidence}%</strong></span>
                    <span className="text-slate-600 font-mono">[{msg.timestamp}]</span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed font-mono">
                  {msg.message}
                </p>
              </div>
            );
          })}

          {debating && visibleMessages.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Agent Swarm synthesizing next cross-examination thesis...</span>
            </div>
          )}

          {/* Final Verdict Banner */}
          {result && activeStep === 3 && (
            <div className={`p-5 rounded-xl border-2 ${
              result.verdict === "GO"
                ? "bg-emerald-950/40 border-emerald-400 text-emerald-200"
                : "bg-red-950/40 border-red-500 text-red-200"
            } mt-4`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  {result.verdict === "GO" ? (
                    <CheckCircle2 className="w-8 h-8 text-[#00ff66] shrink-0" />
                  ) : (
                    <XCircle className="w-8 h-8 text-[#ff3344] shrink-0" />
                  )}
                  <div>
                    <h3 className="text-base font-black tracking-widest uppercase">
                      HEDGE FUND VERDICT: [{result.verdict}]
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Recommendation: <strong className="text-white">{result.recommendedDirection}</strong> ({result.recommendedLeverage}x Lev) · Max Risk Allocation: <strong className="text-white">{result.recommendedPositionPct}%</strong>
                    </p>
                  </div>
                </div>

                {result.verdict === "GO" && onExecuteTrade && (
                  <button
                    onClick={() => {
                      onExecuteTrade(
                        result.recommendedDirection === "SHORT" ? "SHORT" : "LONG",
                        result.recommendedLeverage
                      );
                      onClose();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-950/50 flex items-center gap-2 transition"
                  >
                    <Zap className="w-4 h-4 fill-slate-950" />
                    Execute Swarm Consensus Trade
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-2.5 bg-[#020408] border-t border-emerald-900/40 flex items-center justify-between text-[10px] text-slate-500">
          <span>Swarm Protocol v4.8 · Confluence Threshold: &gt;= 62/100 · Kelly Criterion Sizing</span>
          <span className="text-emerald-500 font-bold">TERMINAL STATUS: READY</span>
        </div>
      </div>
    </div>
  );
}
