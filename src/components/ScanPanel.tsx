import { Loader2, Radar, TrendingUp, TrendingDown, Lock, Crown, ExternalLink } from "lucide-react";
import type { ScanResult } from "../types";
import { formatPrice } from "../lib/patterns";
import { FREE_LIMIT } from "../lib/scanLimit";

import { GUMROAD_CHECKOUT_URL } from "./ProModal";

const CHECKOUT_URL = GUMROAD_CHECKOUT_URL;

interface Props {
  open: boolean;
  onClose: () => void;
  scanning: boolean;
  results: ScanResult[];
  error: string | null;
  isPro: boolean;
  remainingScans: number;
  onSelectCoin: (binanceSymbol: string) => void;
  onFreeScan: () => void;
}

export default function ScanPanel({
  open,
  onClose,
  scanning,
  results,
  error,
  isPro,
  remainingScans,
  onSelectCoin,
  onFreeScan,
}: Props) {
  if (!open) return null;

  const canFreeScan = remainingScans > 0;
  const usedScans = FREE_LIMIT - remainingScans;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Radar className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Scan Top 50 Coins</h2>
              <p className="text-xs text-slate-400">
                {isPro
                  ? "Finding patterns across the market"
                  : `Free scans: ${remainingScans}/${FREE_LIMIT} remaining today`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-sm">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {scanning && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Scanning 50 coins for patterns…</p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 text-center py-8">{error}</p>
          )}

          {!scanning && !error && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-slate-400 text-sm">No patterns detected right now.</p>
              <p className="text-slate-500 text-xs mt-1">The market may be in a consolidation phase.</p>
            </div>
          )}

          {/* Free-tier limited access */}
          {!isPro && !scanning && results.length === 0 && canFreeScan && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-cyan-500/10 flex items-center justify-center mb-4">
                <Radar className="w-7 h-7 text-cyan-400" />
              </div>
              <p className="text-white font-semibold mb-1">Free Trial Scan</p>
              <p className="text-sm text-slate-400 mb-4 max-w-xs">
                You have {remainingScans} free {remainingScans === 1 ? "scan" : "scans"} left today. Try it out — no payment needed.
              </p>
              <button
                onClick={onFreeScan}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
              >
                <Radar className="w-4 h-4 text-cyan-400" />
                Run Free Scan
              </button>
            </div>
          )}

          {/* Free-tier exhausted */}
          {!isPro && !scanning && !canFreeScan && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                <Lock className="w-7 h-7 text-amber-400" />
              </div>
              <p className="text-white font-semibold mb-1">Daily Free Scans Used Up</p>
              <p className="text-sm text-slate-400 mb-4 max-w-xs">
                You've used all {FREE_LIMIT} free scans today ({usedScans}/{FREE_LIMIT}). Upgrade to Pro for unlimited scans.
              </p>
              <a
                href={CHECKOUT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-sm font-bold transition-all"
              >
                <Crown className="w-4 h-4" />
                Upgrade to Pro
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {results.length > 0 && (
            <>
              {!isPro && (
                <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                  <span className="text-xs text-slate-400">
                    Free scans left today: <span className="text-cyan-400 font-medium">{remainingScans}</span>/{FREE_LIMIT}
                  </span>
                  <a
                    href={CHECKOUT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Crown className="w-3 h-3" />
                    Go Pro
                  </a>
                </div>
              )}
              <div className="space-y-2">
                {results.map((r, idx) => {
                  const isBullish = r.pattern.direction === "bullish";
                  return (
                    <button
                      key={`${r.symbol}-${idx}`}
                      onClick={() => onSelectCoin(r.binanceSymbol || r.symbol)}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 transition-all text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                            isBullish ? "bg-green-500/10" : "bg-red-500/10"
                          }`}
                        >
                          {isBullish ? (
                            <TrendingUp className="w-4 h-4 text-green-400" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{r.label} <span className="text-slate-500 font-normal">/ USDT</span></p>
                          <p className="text-xs text-slate-400">{r.pattern.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-slate-200">{formatPrice(r.price)}</p>
                        <p className={`text-xs font-medium ${isBullish ? "text-green-400" : "text-red-400"}`}>
                          {isBullish ? "Bullish" : "Bearish"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
