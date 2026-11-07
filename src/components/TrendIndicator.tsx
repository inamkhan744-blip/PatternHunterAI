import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import type { Candle } from "../types";
import { sma } from "../lib/indicators";

interface Props {
  candles: Candle[];
}

type TrendType = "uptrend" | "downtrend" | "sideways";

function analyzeTrend(candles: Candle[]): { type: TrendType; strength: number } {
  if (candles.length < 30) return { type: "sideways", strength: 0 };
  const closes = candles.map((c) => c.close);
  const ma7 = sma(closes, 7);
  const ma25 = sma(closes, 25);

  const lastMa7 = ma7[ma7.length - 1];
  const lastMa25 = ma25[ma25.length - 1];
  if (lastMa7 === null || lastMa25 === null) return { type: "sideways", strength: 0 };

  const diff = ((lastMa7 - lastMa25) / lastMa25) * 100;
  const strength = Math.min(Math.abs(diff) * 20, 100);

  if (diff > 0.3) return { type: "uptrend", strength };
  if (diff < -0.3) return { type: "downtrend", strength };
  return { type: "sideways", strength };
}

const TREND_CONFIG: Record<TrendType, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  uptrend: { label: "Uptrend", color: "text-green-400", bg: "bg-green-500/10", icon: TrendingUp },
  downtrend: { label: "Downtrend", color: "text-red-400", bg: "bg-red-500/10", icon: TrendingDown },
  sideways: { label: "Sideways", color: "text-slate-400", bg: "bg-slate-700/30", icon: Minus },
};

export default function TrendIndicator({ candles }: Props) {
  const trend = useMemo(() => analyzeTrend(candles), [candles]);
  const config = TREND_CONFIG[trend.type];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
      {trend.strength > 0 && (
        <span className="text-slate-500 ml-0.5">
          {Math.round(trend.strength)}%
        </span>
      )}
    </div>
  );
}
