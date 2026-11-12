import { useState } from "react";
import { Globe, AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  className?: string;
  compact?: boolean;
}

/**
 * Macro Radar (DXY / S&P 500).
 *
 * This widget previously displayed hardcoded index levels with a random walk
 * applied every minute, which made synthetic numbers look like live macro data.
 * The app has no configured macro-data provider, so the honest state is
 * "Unavailable" until a real feed is wired in.
 */
export default function MacroWidget({ className = "", compact = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  const message =
    "Macro data unavailable — no DXY/S&P 500 market data provider is configured for this app.";

  if (compact) {
    return (
      <div className={`relative inline-flex items-center gap-2 ${className}`}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs transition-colors"
          title={message}
        >
          <Globe className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-semibold text-slate-400">Macro:</span>
          <span className="text-amber-400 font-medium">Unavailable</span>
        </button>

        {expanded && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-left">
              <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-800">
                <Globe className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-bold text-white">Global Macro Radar</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-900 border border-slate-800 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
            <Globe className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Macro Market Radar</h4>
            <span className="text-[10px] text-slate-500">DXY & S&P 500 correlation</span>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
          UNAVAILABLE
        </span>
      </div>

      <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          {message} No index values are shown rather than estimated, because synthetic macro numbers
          would be indistinguishable from a live feed.
        </span>
      </div>

      <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
        <RefreshCw className="w-3 h-3" />
        Connect a macro data provider to enable this panel.
      </p>
    </div>
  );
}
