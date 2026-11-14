import { useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";

interface Props {
  className?: string;
  compact?: boolean;
}

const WIDGET_SCRIPT =
  "https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js";

const MACRO_SYMBOLS = [
  { s: "INDEX:DXY", d: "U.S. Dollar Index" },
  { s: "FOREXCOM:SPXUSD", d: "S&P 500" },
];

const WIDGET_CONFIG = {
  colorTheme: "dark",
  dateRange: "1D",
  showChart: true,
  locale: "en",
  largeChartUrl: "",
  isTransparent: true,
  showSymbolLogo: true,
  showFloatingTooltip: true,
  width: "100%",
  height: "100%",
  plotLineColorGrowing: "rgba(34, 197, 94, 1)",
  plotLineColorFalling: "rgba(239, 68, 68, 1)",
  gridLineColor: "rgba(42, 46, 57, 0)",
  scaleFontColor: "rgba(148, 163, 184, 1)",
  belowLineFillColorGrowing: "rgba(34, 197, 94, 0.12)",
  belowLineFillColorFalling: "rgba(239, 68, 68, 0.12)",
  belowLineFillColorGrowingBottom: "rgba(34, 197, 94, 0)",
  belowLineFillColorFallingBottom: "rgba(239, 68, 68, 0)",
  symbolActiveColor: "rgba(6, 182, 212, 0.12)",
  tabs: [
    {
      title: "Macro",
      originalTitle: "Macro",
      symbols: MACRO_SYMBOLS,
    },
  ],
};

/**
 * TradingView "Market Quotes" widget for DXY and the S&P 500.
 *
 * The widget is keyless: it renders inside its own iframe, so nothing here needs
 * an API key, a proxy, or a Supabase function. The embed script is injected once
 * per container on mount and the container is cleared on unmount so React
 * StrictMode's double-mount cannot leave a duplicated script behind.
 */
function TradingViewMacroWidget({ height = 300 }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setFailed(false);
    container.innerHTML = "";

    const widgetHost = document.createElement("div");
    widgetHost.className = "tradingview-widget-container__widget";
    widgetHost.style.height = "100%";
    widgetHost.style.width = "100%";
    container.appendChild(widgetHost);

    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({ ...WIDGET_CONFIG, height });
    container.appendChild(script);

    // Blockers silently prevent the iframe from mounting; show a placeholder instead
    // of an empty dark box when that happens.
    const fallbackTimer = window.setTimeout(() => {
      if (!container.querySelector("iframe")) setFailed(true);
    }, 8000);

    return () => {
      window.clearTimeout(fallbackTimer);
      if (container) container.innerHTML = "";
    };
  }, [height]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div
        ref={containerRef}
        className="tradingview-widget-container h-full w-full"
        aria-label="TradingView macro market quotes"
      />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          Macro data loading...
        </div>
      )}
    </div>
  );
}

export default function MacroWidget({ className = "", compact = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (compact) {
    return (
      <div className={`relative inline-flex items-center gap-2 ${className}`}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs transition-colors"
          title="DXY and S&P 500 live quotes"
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-slate-400">Macro:</span>
          <span className="text-cyan-300 font-medium">DXY · S&P 500</span>
        </button>

        {expanded && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-3 z-50 text-left">
              <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-800">
                <Globe className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-white">Global Macro Radar</span>
              </div>
              <TradingViewMacroWidget height={220} />
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
            <Globe className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Macro Market Radar</h4>
            <span className="text-[10px] text-slate-500">
              U.S. Dollar Index &amp; S&amp;P 500 · live via TradingView
            </span>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
          LIVE
        </span>
      </div>

      <TradingViewMacroWidget height={300} />
    </div>
  );
}
