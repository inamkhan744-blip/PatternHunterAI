import { useState, useMemo } from "react";
import { Calculator, Gauge, AlertTriangle } from "lucide-react";

interface Props {
  entryPrice: number | null;
}

export default function RiskCalculator({ entryPrice: defaultEntry }: Props) {
  const [balance, setBalance] = useState("10000");
  const [riskPct, setRiskPct] = useState("1.5");
  const [entryPriceInput, setEntryPriceInput] = useState(defaultEntry ? String(defaultEntry) : "65000");
  const [stopLossInput, setStopLossInput] = useState(defaultEntry ? String(defaultEntry * 0.98) : "63700");
  const [takeProfitInput, setTakeProfitInput] = useState(defaultEntry ? String(defaultEntry * 1.04) : "67600");
  const [leverage, setLeverage] = useState("5");
  const [direction, setDirection] = useState<"long" | "short">("long");

  const parsedBalance = parseFloat(balance) || 10000;
  const parsedRisk = Math.min(Math.max(parseFloat(riskPct) || 1, 0.1), 10);
  const entry = parseFloat(entryPriceInput) || 1;
  const sl = parseFloat(stopLossInput) || (entry * 0.98);
  const tp = parseFloat(takeProfitInput) || (entry * 1.04);
  const lev = Math.min(Math.max(parseInt(leverage, 10) || 1, 1), 50);

  const maxLoss = useMemo(() => parsedBalance * (parsedRisk / 100), [parsedBalance, parsedRisk]);

  const slDistancePct = useMemo(() => {
    if (entry <= 0) return 0.02;
    return Math.abs(entry - sl) / entry;
  }, [entry, sl]);

  const positionNotional = useMemo(() => {
    if (slDistancePct <= 0) return 0;
    return maxLoss / slDistancePct;
  }, [maxLoss, slDistancePct]);

  const tokenQuantity = useMemo(() => {
    if (entry <= 0) return 0;
    return positionNotional / entry;
  }, [positionNotional, entry]);

  const marginRequired = useMemo(() => {
    return positionNotional / lev;
  }, [positionNotional, lev]);

  const liquidationPrice = useMemo(() => {
    if (direction === "long") {
      return entry * (1 - (1 / lev) * 0.9);
    } else {
      return entry * (1 + (1 / lev) * 0.9);
    }
  }, [entry, lev, direction]);

  const riskReward = useMemo(() => {
    const slDist = Math.abs(entry - sl);
    const tpDist = Math.abs(tp - entry);
    if (slDist <= 0) return 0;
    return Number((tpDist / slDist).toFixed(2));
  }, [entry, sl, tp]);

  const isLiqNearStopLoss = useMemo(() => {
    if (direction === "long") {
      return sl <= liquidationPrice * 1.02;
    } else {
      return sl >= liquidationPrice * 0.98;
    }
  }, [direction, sl, liquidationPrice]);

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 font-mono shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Institutional Risk & Position Size Engine
          </h3>
        </div>
        <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
          KELLY CRITERION READY
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs">
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Account Equity ($)</label>
          <input
            type="number"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Risk % (0.5% - 5%)</label>
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={(e) => setRiskPct(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Leverage</label>
          <select
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
          >
            <option value="1">1x (Spot / No Leverage)</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="5">5x (Institutional Safe)</option>
            <option value="10">10x</option>
            <option value="20">20x (High Risk)</option>
          </select>
        </div>
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "long" | "short")}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
          >
            <option value="long">LONG</option>
            <option value="short">SHORT</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs">
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Entry Price ($)</label>
          <input
            type="number"
            step="any"
            value={entryPriceInput}
            onChange={(e) => setEntryPriceInput(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Stop Loss ($)</label>
          <input
            type="number"
            step="any"
            value={stopLossInput}
            onChange={(e) => setStopLossInput(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-[#ff3344] outline-none focus:border-cyan-500 font-bold"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1 font-sans">Take Profit ($)</label>
          <input
            type="number"
            step="any"
            value={takeProfitInput}
            onChange={(e) => setTakeProfitInput(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-[#00ff66] outline-none focus:border-cyan-500 font-bold"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-sans">Max Dollar Risk</span>
          <p className="text-lg font-black text-[#ff3344] mt-0.5">${maxLoss.toFixed(2)}</p>
          <span className="text-[10px] text-slate-500 font-sans">{riskPct}% of balance</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-sans">Position Size</span>
          <p className="text-lg font-black text-cyan-400 mt-0.5">
            ${positionNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <span className="text-[10px] text-slate-500 font-sans">{tokenQuantity.toFixed(4)} Coins</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-sans">Margin Needed</span>
          <p className="text-lg font-black text-amber-400 mt-0.5">${marginRequired.toFixed(2)}</p>
          <span className="text-[10px] text-slate-500 font-sans">at {lev}x leverage</span>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
          <span className="text-[10px] text-slate-500 uppercase block font-sans">Risk / Reward</span>
          <p className={`text-lg font-black mt-0.5 ${riskReward >= 2 ? "text-[#00ff66]" : "text-amber-400"}`}>
            1 : {riskReward}
          </p>
          <span className="text-[10px] text-slate-500 font-sans">{riskReward >= 2 ? "Favorable" : "Sub-optimal"}</span>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <span className="text-slate-400 font-sans">Estimated Liquidation Price:</span>
          <strong className="text-amber-400">${liquidationPrice.toFixed(2)}</strong>
        </div>

        {isLiqNearStopLoss && (
          <div className="flex items-center gap-1.5 text-[#ff3344] font-bold">
            <AlertTriangle className="w-4 h-4" />
            <span>WARNING: Liquidation price is within 2% of Stop Loss! Reduce leverage.</span>
          </div>
        )}
      </div>
    </div>
  );
}
