import { useState, useMemo } from "react";
import { Calculator, Wallet, Shield, Target } from "lucide-react";
import { formatPrice } from "../lib/patterns";

interface Props {
  entryPrice: number | null;
}

export default function RiskCalculator({ entryPrice }: Props) {
  const [balance, setBalance] = useState("");
  const [riskPct, setRiskPct] = useState("1");

  const parsedBalance = parseFloat(balance) || 0;
  const parsedRisk = Math.min(Math.max(parseFloat(riskPct) || 0, 0), 5);

  const maxLoss = useMemo(() => parsedBalance * (parsedRisk / 100), [parsedBalance, parsedRisk]);
  const positionSize = useMemo(() => {
    if (!entryPrice || entryPrice <= 0 || maxLoss <= 0) return 0;
    return maxLoss / entryPrice;
  }, [entryPrice, maxLoss]);

  const positionValue = positionSize * (entryPrice ?? 0);

  return (
    <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
          Risk Calculator
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Account Balance ($)</label>
          <div className="relative">
            <Wallet className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
            <input
              type="number"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="10000"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Risk % (1–5%)</label>
          <div className="relative">
            <Shield className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="5"
              step="0.5"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              placeholder="1"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {parsedBalance > 0 && parsedRisk > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-red-500/5 border border-red-500/10 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Shield className="w-3 h-3 text-red-400" />
              <p className="text-[10px] text-red-400/70 uppercase tracking-wider">Max Loss</p>
            </div>
            <p className="text-base font-bold text-red-400">{formatPrice(maxLoss)}</p>
          </div>
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/10 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Target className="w-3 h-3 text-cyan-400" />
              <p className="text-[10px] text-cyan-400/70 uppercase tracking-wider">Position Size</p>
            </div>
            <p className="text-base font-bold text-cyan-400">
              {positionSize > 0 ? positionSize.toFixed(4) : "—"}
              <span className="text-xs text-slate-500 font-normal ml-1">
                {positionSize > 0 && `(${formatPrice(positionValue)})`}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">
          Enter your balance and risk % to calculate position size
          {entryPrice ? "" : " — signal entry price will appear here automatically"}
        </p>
      )}
    </div>
  );
}
