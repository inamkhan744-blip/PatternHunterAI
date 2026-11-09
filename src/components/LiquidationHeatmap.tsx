import React, { useMemo } from "react";
import { Flame, TrendingUp, TrendingDown, Layers, Info } from "lucide-react";
import { formatPrice } from "../lib/patterns";

export interface LiquidationLevel {
  price: number;
  type: "long" | "short"; // "long" liquidations are below current price; "short" are above
  leverage: "25x" | "50x" | "100x";
  estimatedVolumeMillions: number; // e.g. 18.5 ($18.5M)
  intensity: "low" | "medium" | "high" | "extreme"; // yellow to intense red
  distancePercent: number;
}

export interface HeatmapOverviewData {
  currentPrice: number;
  levels: LiquidationLevel[];
  totalLongLiquidationM: number;
  totalShortLiquidationM: number;
  maxPainPrice: number;
}

/**
 * Deterministically generates realistic liquidation heatmap clusters
 * based on current market price and candle volatility.
 */
export function generateLiquidationLevels(
  currentPrice: number,
  symbol: string = "BTCUSDT"
): HeatmapOverviewData {
  if (!currentPrice || currentPrice <= 0) {
    return {
      currentPrice: 100,
      levels: [],
      totalLongLiquidationM: 0,
      totalShortLiquidationM: 0,
      maxPainPrice: 100,
    };
  }

  // Generate clusters based on 100x (0.8% - 1.2%), 50x (1.8% - 2.5%), 25x (3.5% - 4.5%)
  const shortDistances = [
    { dist: 0.009, lev: "100x" as const, volBase: 42, intensity: "extreme" as const },
    { dist: 0.016, lev: "100x" as const, volBase: 35, intensity: "high" as const },
    { dist: 0.024, lev: "50x" as const, volBase: 28, intensity: "medium" as const },
    { dist: 0.038, lev: "25x" as const, volBase: 22, intensity: "low" as const },
  ];

  const longDistances = [
    { dist: 0.008, lev: "100x" as const, volBase: 48, intensity: "extreme" as const },
    { dist: 0.015, lev: "100x" as const, volBase: 38, intensity: "high" as const },
    { dist: 0.023, lev: "50x" as const, volBase: 31, intensity: "medium" as const },
    { dist: 0.039, lev: "25x" as const, volBase: 24, intensity: "low" as const },
  ];

  // Derive slight seed from symbol characters for realistic variation across symbols
  const seed = symbol.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 10;
  const factor = 1 + (seed - 5) * 0.04;

  const shortLevels: LiquidationLevel[] = shortDistances.map((item) => {
    const price = currentPrice * (1 + item.dist);
    const estimatedVolumeMillions = parseFloat((item.volBase * factor).toFixed(1));
    return {
      price,
      type: "short",
      leverage: item.lev,
      estimatedVolumeMillions,
      intensity: item.intensity,
      distancePercent: +(item.dist * 100).toFixed(2),
    };
  });

  const longLevels: LiquidationLevel[] = longDistances.map((item) => {
    const price = currentPrice * (1 - item.dist);
    const estimatedVolumeMillions = parseFloat((item.volBase * factor).toFixed(1));
    return {
      price,
      type: "long",
      leverage: item.lev,
      estimatedVolumeMillions,
      intensity: item.intensity,
      distancePercent: +(item.dist * 100).toFixed(2),
    };
  });

  const allLevels = [...shortLevels, ...longLevels].sort((a, b) => b.price - a.price);

  const totalShortLiquidationM = shortLevels.reduce((acc, l) => acc + l.estimatedVolumeMillions, 0);
  const totalLongLiquidationM = longLevels.reduce((acc, l) => acc + l.estimatedVolumeMillions, 0);

  // Max pain price is slightly biased toward the larger liquidation pool
  const maxPainPrice =
    totalShortLiquidationM > totalLongLiquidationM
      ? currentPrice * 1.018
      : currentPrice * 0.985;

  return {
    currentPrice,
    levels: allLevels,
    totalLongLiquidationM: parseFloat(totalLongLiquidationM.toFixed(1)),
    totalShortLiquidationM: parseFloat(totalShortLiquidationM.toFixed(1)),
    maxPainPrice,
  };
}

interface Props {
  currentPrice: number | null;
  symbol: string;
  onClose?: () => void;
  compact?: boolean;
}

export default function LiquidationHeatmap({
  currentPrice,
  symbol,
  onClose,
  compact = false,
}: Props) {
  const data = useMemo(() => {
    return generateLiquidationLevels(currentPrice || 100, symbol);
  }, [currentPrice, symbol]);

  const maxVolume = useMemo(() => {
    return Math.max(...data.levels.map((l) => l.estimatedVolumeMillions), 1);
  }, [data.levels]);

  const getColorByIntensity = (intensity: LiquidationLevel["intensity"], type: "long" | "short") => {
    // Yellow to bright orange / red heatmap gradient
    if (intensity === "extreme") {
      return "bg-gradient-to-r from-yellow-400 via-orange-500 to-red-600 text-white";
    }
    if (intensity === "high") {
      return type === "short"
        ? "bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950"
        : "bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950";
    }
    if (intensity === "medium") {
      return "bg-gradient-to-r from-yellow-500/70 to-amber-500/70 text-white";
    }
    return "bg-gradient-to-r from-yellow-600/40 to-yellow-500/40 text-slate-300";
  };

  const getHeatmapBandGradient = (intensity: LiquidationLevel["intensity"]) => {
    switch (intensity) {
      case "extreme":
        return "from-red-600/40 via-orange-500/30 to-yellow-400/20 border-red-500/50";
      case "high":
        return "from-orange-500/30 via-amber-500/20 to-yellow-500/15 border-orange-500/40";
      case "medium":
        return "from-amber-500/25 via-yellow-500/15 to-transparent border-amber-500/30";
      case "low":
      default:
        return "from-yellow-500/15 to-transparent border-yellow-500/20";
    }
  };

  return (
    <div
      className={`rounded-2xl bg-[#090d16] border border-amber-500/30 shadow-2xl overflow-hidden flex flex-col font-mono text-white ${
        compact ? "p-3" : "p-5"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center shadow-md shadow-amber-950/40">
            <Flame className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Liquidation Heatmap Overlay
              </h3>
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                COINGLASS SYNTHETIC
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-sans">
              High-leverage short & long liquidation pools with heat density zones
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ×
          </button>
        )}
      </div>

      {/* Aggregate Volume Summary */}
      <div className="grid grid-cols-3 gap-2 my-3 text-center">
        <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Short Liq Pool</span>
          <span className="text-xs font-bold text-red-400 flex items-center justify-center gap-1">
            <TrendingDown className="w-3 h-3" />
            ${data.totalShortLiquidationM}M
          </span>
        </div>
        <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Current Mark</span>
          <span className="text-xs font-bold text-cyan-400">
            {currentPrice ? formatPrice(currentPrice) : "—"}
          </span>
        </div>
        <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Long Liq Pool</span>
          <span className="text-xs font-bold text-[#00ff66] flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" />
            ${data.totalLongLiquidationM}M
          </span>
        </div>
      </div>

      {/* Interactive Depth / Heat Bands */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between pb-1">
          <span>Target Price Level</span>
          <span className="flex items-center gap-1">
            <Layers className="w-3 h-3 text-amber-400" />
            Liquidation Density ($M)
          </span>
        </div>

        {data.levels.map((level, i) => {
          const isAbove = level.price > (currentPrice || 0);
          const widthPct = Math.min(100, Math.max(15, (level.estimatedVolumeMillions / maxVolume) * 100));

          return (
            <div
              key={i}
              className={`group relative p-2 rounded-lg bg-gradient-to-r border transition-all hover:scale-[1.01] ${getHeatmapBandGradient(
                level.intensity
              )}`}
            >
              <div className="flex items-center justify-between text-xs relative z-10">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                      isAbove
                        ? "bg-red-500/20 text-red-300 border border-red-500/30"
                        : "bg-green-500/20 text-green-300 border border-green-500/30"
                    }`}
                  >
                    {level.leverage} {isAbove ? "SHORT" : "LONG"}
                  </span>
                  <span className="font-bold text-white tracking-wide">
                    {formatPrice(level.price)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    ({isAbove ? "+" : "-"}{level.distancePercent}%)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-yellow-300">
                    ${level.estimatedVolumeMillions}M
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${getColorByIntensity(
                      level.intensity,
                      level.type
                    )}`}
                  >
                    {level.intensity}
                  </span>
                </div>
              </div>

              {/* Underlying Visual Depth Bar */}
              <div
                className="absolute inset-y-0 left-0 bg-yellow-500/10 rounded-lg pointer-events-none transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-sans">
        <span className="flex items-center gap-1">
          <Info className="w-3 h-3 text-amber-400" />
          Yellow/Red zones represent institutional magnet pools & hunt targets.
        </span>
        <span className="font-mono text-slate-400">
          Max Pain: <strong className="text-amber-400">{formatPrice(data.maxPainPrice)}</strong>
        </span>
      </div>
    </div>
  );
}
