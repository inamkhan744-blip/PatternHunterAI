import React, { useState } from "react";
import { AlertTriangle, ShieldAlert, Lock, CheckCircle2, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onAgree: () => void;
}

export default function RiskDisclaimerModal({ open, onClose, onAgree }: Props) {
  const [agreedLeverageRisk, setAgreedLeverageRisk] = useState(false);
  const [agreedLiquidationRisk, setAgreedLiquidationRisk] = useState(false);
  const [agreedApiRisk, setAgreedApiRisk] = useState(false);

  if (!open) return null;

  const canProceed = agreedLeverageRisk && agreedLiquidationRisk && agreedApiRisk;

  const handleAccept = () => {
    if (!canProceed) return;
    onAgree();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border-2 border-red-500/50 rounded-2xl shadow-2xl shadow-red-950/50 overflow-hidden text-white">
        {/* Header Banner */}
        <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-xl text-red-400">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-red-400 uppercase tracking-wide">
                High-Risk Trading Disclaimer
              </h2>
              <p className="text-xs text-slate-400">
                Binance Spot & Futures Automated Execution
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-red-300">
                CRITICAL WARNING: Futures & Leverage Trading can lead to 100% Capital Loss.
              </p>
              <p>
                Trading cryptocurrency derivatives with leverage (1x to 10x) involves substantial risk of rapid financial loss exceeding standard market volatility. Margin calls and forced liquidations may occur in seconds.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            {/* Checkbox 1 */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 cursor-pointer transition select-none">
              <input
                type="checkbox"
                checked={agreedLeverageRisk}
                onChange={(e) => setAgreedLeverageRisk(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 text-red-500 focus:ring-red-500 focus:ring-offset-slate-900 cursor-pointer"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white">Extreme Leverage Risk: </strong>
                I understand that using up to 10x leverage magnifies both gains and losses. I accept full personal responsibility for margin management and position sizing.
              </span>
            </label>

            {/* Checkbox 2 */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 cursor-pointer transition select-none">
              <input
                type="checkbox"
                checked={agreedLiquidationRisk}
                onChange={(e) => setAgreedLiquidationRisk(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 text-red-500 focus:ring-red-500 focus:ring-offset-slate-900 cursor-pointer"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white">Liquidation & Execution: </strong>
                I acknowledge that high market volatility, network latency, or exchange rate limits can cause slippage or liquidation before automated stop orders fill.
              </span>
            </label>

            {/* Checkbox 3 */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 cursor-pointer transition select-none">
              <input
                type="checkbox"
                checked={agreedApiRisk}
                onChange={(e) => setAgreedApiRisk(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 text-red-500 focus:ring-red-500 focus:ring-offset-slate-900 cursor-pointer"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                <strong className="text-white">API Keys & No Financial Advice: </strong>
                I verify that this software does not offer financial or investment advice. I store my Binance API credentials at my own discretion with IP access restrictions.
              </span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-950 px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!canProceed}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition ${
              canProceed
                ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50 cursor-pointer"
                : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
            }`}
          >
            {canProceed ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                I Agree & Accept All Risks
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Acknowledge All Statements
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
