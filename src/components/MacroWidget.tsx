import { useEffect, useState, useCallback } from "react";
import { DollarSign, BarChart2, TrendingUp, TrendingDown, RefreshCw, Globe, ChevronRight } from "lucide-react";

export interface MacroItem {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  trend: "up" | "down" | "flat";
  history: number[]; // 10-15 datapoints for mini-sparkline chart
}

interface MacroData {
  dxy: MacroItem;
  spx: MacroItem;
  updatedAt: string;
}

// Realistic baseline macro data
const INITIAL_MACRO_DATA: MacroData = {
  dxy: {
    symbol: "DXY",
    name: "US Dollar Index",
    price: 104.28,
    changePercent: -0.34,
    trend: "down",
    history: [104.9, 104.82, 104.75, 104.6, 104.52, 104.4, 104.31, 104.28],
  },
  spx: {
    symbol: "SPX",
    name: "S&P 500 Index",
    price: 5864.67,
    changePercent: +0.62,
    trend: "up",
    history: [5810.2, 5822.4, 5835.1, 5840.0, 5851.5, 5858.9, 5864.67],
  },
  updatedAt: "Just now",
};

interface Props {
  className?: string;
  compact?: boolean;
}

/**
 * Mini SVG sparkline chart component
 */
function Sparkline({ data, isPositive, width = 70, height = 24 }: { data: number[]; isPositive: boolean; width?: number; height?: number }) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const strokeColor = isPositive ? "#4ade80" : "#f87171";
  const fillColor = isPositive ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)";

  const firstPoint = `0,${height}`;
  const lastPoint = `${width},${height}`;
  const areaPoints = `${firstPoint} ${points} ${lastPoint}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${isPositive ? "up" : "down"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={fillColor} />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function MacroWidget({ className = "", compact = false }: Props) {
  const [macro, setMacro] = useState<MacroData>(INITIAL_MACRO_DATA);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchMacroData = useCallback(async () => {
    setLoading(true);
    try {
      // Simulate live jitter or API pull
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMacro((prev) => {
        const dxyJitter = (Math.random() - 0.5) * 0.08;
        const spxJitter = (Math.random() - 0.48) * 4.2;

        const newDxyPrice = Number((prev.dxy.price + dxyJitter).toFixed(2));
        const newSpxPrice = Number((prev.spx.price + spxJitter).toFixed(2));

        const newDxyHistory = [...prev.dxy.history.slice(-14), newDxyPrice];
        const newSpxHistory = [...prev.spx.history.slice(-14), newSpxPrice];

        return {
          dxy: {
            ...prev.dxy,
            price: newDxyPrice,
            changePercent: Number((prev.dxy.changePercent + dxyJitter * 0.2).toFixed(2)),
            trend: prev.dxy.changePercent >= 0 ? "up" : "down",
            history: newDxyHistory,
          },
          spx: {
            ...prev.spx,
            price: newSpxPrice,
            changePercent: Number((prev.spx.changePercent + (spxJitter / prev.spx.price) * 100).toFixed(2)),
            trend: prev.spx.changePercent >= 0 ? "up" : "down",
            history: newSpxHistory,
          },
          updatedAt: now,
        };
      });
    } catch (e) {
      console.error("Failed to update macro data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchMacroData, 60000);
    return () => clearInterval(interval);
  }, [fetchMacroData]);

  if (compact) {
    return (
      <div className={`relative inline-flex items-center gap-2 ${className}`}>
        {/* Compact Bar Display */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs transition-colors"
          title="Macro Indicators: DXY & SPX (Click to open details)"
        >
          <div className="flex items-center gap-1.5 text-slate-300">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-400">Macro:</span>
          </div>

          {/* DXY */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-white">DXY</span>
            <span className="text-slate-300 font-mono">{macro.dxy.price.toFixed(2)}</span>
            <span
              className={`text-[10px] font-semibold ${
                macro.dxy.changePercent >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {macro.dxy.changePercent >= 0 ? "+" : ""}
              {macro.dxy.changePercent.toFixed(2)}%
            </span>
          </div>

          <div className="w-px h-3 bg-slate-800" />

          {/* SPX */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-white">SPX</span>
            <span className="text-slate-300 font-mono">{macro.spx.price.toFixed(1)}</span>
            <span
              className={`text-[10px] font-semibold ${
                macro.spx.changePercent >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {macro.spx.changePercent >= 0 ? "+" : ""}
              {macro.spx.changePercent.toFixed(2)}%
            </span>
          </div>
        </button>

        {expanded && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-left">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">Global Macro Radar</span>
                </div>
                <button
                  onClick={fetchMacroData}
                  disabled={loading}
                  className="p-1 rounded-md text-slate-400 hover:text-white transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* DXY Card */}
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 mb-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-sm">DXY</span>
                      <span className="text-[10px] text-slate-500">US Dollar Index</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-lg font-mono font-bold text-white">
                        {macro.dxy.price.toFixed(2)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          macro.dxy.changePercent >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {macro.dxy.changePercent >= 0 ? "+" : ""}
                        {macro.dxy.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <Sparkline
                    data={macro.dxy.history}
                    isPositive={macro.dxy.changePercent >= 0}
                    width={80}
                    height={30}
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  {macro.dxy.changePercent < 0
                    ? "🟢 Dollar weakening — typically bullish for BTC & risk assets."
                    : "🔴 Dollar strengthening — typically tightens risk liquidity."}
                </p>
              </div>

              {/* SPX Card */}
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-sm">S&P 500 (SPX)</span>
                      <span className="text-[10px] text-slate-500">US Equities</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-lg font-mono font-bold text-white">
                        {macro.spx.price.toFixed(2)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          macro.spx.changePercent >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {macro.spx.changePercent >= 0 ? "+" : ""}
                        {macro.spx.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <Sparkline
                    data={macro.spx.history}
                    isPositive={macro.spx.changePercent >= 0}
                    width={80}
                    height={30}
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  {macro.spx.changePercent >= 0
                    ? "🟢 TradFi risk-on sentiment — aligns with crypto market expansion."
                    : "🔴 TradFi risk-off pullback — indicates broader market caution."}
                </p>
              </div>

              <div className="mt-3 text-right text-[10px] text-slate-500">
                Updated {macro.updatedAt}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-900 border border-slate-800 p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Globe className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Macro Market Radar</h4>
            <span className="text-[10px] text-slate-500">DXY & S&P 500 Correlation</span>
          </div>
        </div>

        <button
          onClick={fetchMacroData}
          disabled={loading}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title="Refresh Macro Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Grid of DXY and SPX */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* DXY */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold text-slate-400">DXY (Dollar Index)</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-xl font-bold font-mono text-white">
                  {macro.dxy.price.toFixed(2)}
                </span>
                <span
                  className={`text-xs font-bold flex items-center ${
                    macro.dxy.changePercent >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {macro.dxy.changePercent >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
                  )}
                  {macro.dxy.changePercent >= 0 ? "+" : ""}
                  {macro.dxy.changePercent.toFixed(2)}%
                </span>
              </div>
            </div>
            <Sparkline
              data={macro.dxy.history}
              isPositive={macro.dxy.changePercent >= 0}
              width={80}
              height={32}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            {macro.dxy.changePercent < 0
              ? "📉 Weakening dollar typically provides macro liquidity tailwinds for Bitcoin & alts."
              : "📈 Rising dollar creates macro headwinds and tighter risk asset liquidity."}
          </p>
        </div>

        {/* SPX */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold text-slate-400">S&P 500 (SPX)</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-xl font-bold font-mono text-white">
                  {macro.spx.price.toFixed(2)}
                </span>
                <span
                  className={`text-xs font-bold flex items-center ${
                    macro.spx.changePercent >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {macro.spx.changePercent >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
                  )}
                  {macro.spx.changePercent >= 0 ? "+" : ""}
                  {macro.spx.changePercent.toFixed(2)}%
                </span>
              </div>
            </div>
            <Sparkline
              data={macro.spx.history}
              isPositive={macro.spx.changePercent >= 0}
              width={80}
              height={32}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
            {macro.spx.changePercent >= 0
              ? "📈 Positive TradFi risk appetite confirms macro expansion across global financial markets."
              : "📉 TradFi risk pullbacks often spill over into short-term crypto corrections."}
          </p>
        </div>
      </div>
    </div>
  );
}
