import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

interface FearGreedData {
  value: number;
  classification: string;
}

function getClassification(value: number): string {
  if (value <= 25) return "Extreme Fear";
  if (value <= 45) return "Fear";
  if (value <= 55) return "Neutral";
  if (value <= 75) return "Greed";
  return "Extreme Greed";
}

function getColor(value: number): string {
  if (value <= 25) return "#ef4444";
  if (value <= 45) return "#f97316";
  if (value <= 55) return "#eab308";
  if (value <= 75) return "#84cc16";
  return "#22c55e";
}

export default function FearGreedIndex() {
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("https://api.alternative.me/fng/?limit=1");
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        const val = parseInt(json.data[0].value, 10);
        if (!cancelled) {
          setData({ value: val, classification: getClassification(val) });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    }
    load();
    const interval = setInterval(load, 300000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 flex items-center gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-lg bg-slate-800" />
        <div className="space-y-1">
          <div className="h-3 w-20 bg-slate-800 rounded" />
          <div className="h-2 w-16 bg-slate-800 rounded" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const color = getColor(data.value);

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 flex items-center gap-3">
      <div className="relative w-10 h-10 shrink-0">
        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${(data.value / 100) * 94.2} 94.2`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
          {data.value}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Gauge className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Fear & Greed</span>
        </div>
        <p className="text-xs font-semibold truncate" style={{ color }}>
          {data.classification}
        </p>
      </div>
    </div>
  );
}
