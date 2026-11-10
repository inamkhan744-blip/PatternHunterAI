import React from "react";
import { AlertTriangle, Clock, ShieldAlert, X, HeartHandshake } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  priceChange1h: number;
  remainingSeconds: number;
  symbol: string;
}

export default function AntiFOMOModal({
  open,
  onClose,
  priceChange1h,
  remainingSeconds,
  symbol,
}: Props) {
  if (!open) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const isSurge = priceChange1h > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border-2 border-red-500 shadow-2xl shadow-red-950/60 overflow-hidden text-left">
        {/* Glowing Top Banner */}
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-black/25 flex items-center justify-center shrink-0 border border-white/20">
              <ShieldAlert className="w-6 h-6 text-white animate-pulse" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-200 block">
                Risk Management Protocol
              </span>
              <h3 className="text-lg font-black tracking-tight leading-tight">
                Anti-FOMO Execution Lock
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-red-100 hover:text-white hover:bg-white/10 transition-colors"
            title="Acknowledge warning"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Main Warning Alert Box */}
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-300 leading-snug">
                🚨 FOMO Alert: Price moved &gt;8% in the last hour. Take a breath and wait for a pullback.
              </p>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {symbol} has experienced an extreme {isSurge ? "pump" : "dump"} of{" "}
                <span className={`font-bold ${isSurge ? "text-green-400" : "text-red-400"}`}>
                  {priceChange1h > 0 ? "+" : ""}
                  {priceChange1h.toFixed(2)}%
                </span>{" "}
                in the past 60 minutes. Entering positions during high-velocity moves leads to chasing tops and severe drawdown.
              </p>
            </div>
          </div>

          {/* Countdown Timer Display */}
          <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <Clock className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Trading Execution Cooldown</p>
                <p className="text-2xl font-mono font-bold text-white tracking-wider">
                  {timeFormatted}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block px-2.5 py-1 rounded bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/40 uppercase">
                BUY / SELL LOCKED
              </span>
              <p className="text-[10px] text-slate-500 mt-1">10 min discipline timer</p>
            </div>
          </div>

          {/* Psychology Tips */}
          <div className="space-y-2 text-xs text-slate-400 bg-slate-800/40 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold mb-1">
              <HeartHandshake className="w-4 h-4 text-cyan-400" />
              <span>Trader Psychology Rule</span>
            </div>
            <ul className="list-disc list-inside space-y-1 leading-relaxed">
              <li>Never chase candles beyond your planned risk-to-reward ratio.</li>
              <li>Wait for price to form a Fair Value Gap or retest a key Order Block.</li>
              <li>Preserving capital is your #1 job as a trader.</li>
            </ul>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onClose}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm transition-all"
            >
              I Understand — Keep Order Buttons Locked
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
