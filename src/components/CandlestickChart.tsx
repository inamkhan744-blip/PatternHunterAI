import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { TrendingUp, TrendingDown, Minus, Layers, Target, ShieldCheck } from "lucide-react";
import type { Candle, DetectedPattern } from "../types";
import { getPatternColor } from "../lib/patterns";
import { sma, rsi, findSupportResistance } from "../lib/indicators";
import { scanSMC, calculateHTFTrend, type SMCData, type HTFTrendResult } from "../lib/SMCScanner";
import { evaluateConfluence, type ConfluenceResult } from "../lib/ConfluenceEngine";
import SniperChecklistModal from "./SniperChecklistModal";

interface Props {
  candles: Candle[];
  pattern: DetectedPattern | null;
  symbol?: string;
  timeframe?: string;
  showIndicators?: boolean;
  loading?: boolean;
  chartType?: "candles" | "line";
  showSMC?: boolean;
}

export default function CandlestickChart({
  candles,
  pattern,
  symbol,
  timeframe = "1H",
  showIndicators = true,
  loading = false,
  chartType = "candles",
  showSMC = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineChartSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const srSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // HTF Trend state
  const [htfTrend, setHtfTrend] = useState<HTFTrendResult | null>(null);
  const [htfLoading, setHtfLoading] = useState(false);

  // Sniper Confluence Modal state
  const [confluenceModalOpen, setConfluenceModalOpen] = useState(false);

  // Detect SMC data (Order Blocks & Fair Value Gaps)
  const smcData: SMCData = useMemo(() => {
    if (!showSMC || candles.length < 5) return { orderBlocks: [], fvgs: [] };
    return scanSMC(candles);
  }, [candles, showSMC]);

  // Confluence Calculation
  const confluenceResult: ConfluenceResult | null = useMemo(() => {
    if (candles.length < 5) return null;
    return evaluateConfluence(candles, smcData, htfTrend);
  }, [candles, smcData, htfTrend]);

  // Fetch 1H and 4H EMA(50) for Higher Timeframe trend
  const loadHTFTrend = useCallback(async (sym: string) => {
    setHtfLoading(true);
    try {
      const result = await calculateHTFTrend(sym);
      setHtfTrend(result);
    } catch (e) {
      console.error("Failed to fetch HTF trend:", e);
    } finally {
      setHtfLoading(false);
    }
  }, []);

  useEffect(() => {
    if (symbol) {
      loadHTFTrend(symbol);
      const interval = setInterval(() => {
        loadHTFTrend(symbol);
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [symbol, loadHTFTrend]);

  // Draw SMC overlay on canvas
  const drawSMCOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const activeSeries = chartType === "line" ? lineChartSeriesRef.current : candleSeriesRef.current;

    if (!canvas || !chart || !activeSeries) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!showSMC || (!smcData.orderBlocks.length && !smcData.fvgs.length)) {
      ctx.restore();
      return;
    }

    const timeScale = chart.timeScale();
    // Use paneSize() if available to avoid drawing over the right price scale
    let plotWidth = rect.width;
    try {
      const pane = chart.paneSize();
      if (pane && pane.width > 0) {
        plotWidth = pane.width;
      }
    } catch {
      // fallback
    }

    // Helper to draw a box
    const drawBox = (
      startTime: number,
      endTime: number,
      top: number,
      bottom: number,
      isBullish: boolean,
      label: string,
      isMitigated: boolean
    ) => {
      const x1 = timeScale.timeToCoordinate(startTime as unknown as Time);
      const x2 = timeScale.timeToCoordinate(endTime as unknown as Time);

      const y1 = activeSeries.priceToCoordinate(top);
      const y2 = activeSeries.priceToCoordinate(bottom);

      if (y1 === null || y2 === null) return;

      const left = x1 !== null ? Math.max(0, x1) : 0;
      // If x2 is null (off right edge or recent), extend to plot width
      const right = x2 !== null ? Math.min(plotWidth, Math.max(left + 24, x2)) : plotWidth;
      const boxWidth = right - left;

      if (boxWidth <= 0) return;

      const topY = Math.min(y1, y2);
      const boxHeight = Math.max(Math.abs(y2 - y1), 2);

      // Shaded rectangular box: Green for Bullish, Red for Bearish
      const fillColor = isBullish
        ? isMitigated ? "rgba(34, 197, 94, 0.08)" : "rgba(34, 197, 94, 0.22)"
        : isMitigated ? "rgba(239, 68, 68, 0.08)" : "rgba(239, 68, 68, 0.22)";

      const strokeColor = isBullish
        ? isMitigated ? "rgba(34, 197, 94, 0.3)" : "rgba(34, 197, 94, 0.85)"
        : isMitigated ? "rgba(239, 68, 68, 0.3)" : "rgba(239, 68, 68, 0.85)";

      ctx.fillStyle = fillColor;
      ctx.fillRect(left, topY, boxWidth, boxHeight);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isMitigated ? 1 : 1.5;
      if (isMitigated) {
        ctx.setLineDash([3, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeRect(left, topY, boxWidth, boxHeight);
      ctx.setLineDash([]);

      // Label inside the box
      if (boxWidth >= 30 && boxHeight >= 10) {
        ctx.font = "bold 9px 'Inter', sans-serif";
        ctx.fillStyle = isBullish ? "#4ade80" : "#f87171";
        ctx.textBaseline = "middle";
        ctx.fillText(label, left + 4, topY + Math.min(boxHeight / 2, 10));
      }
    };

    // Draw FVGs first
    for (const fvg of smcData.fvgs) {
      drawBox(
        fvg.startTime,
        fvg.endTime,
        fvg.top,
        fvg.bottom,
        fvg.type === "bullish",
        fvg.type === "bullish" ? "+FVG" : "-FVG",
        fvg.mitigated
      );
    }

    // Draw Order Blocks
    for (const ob of smcData.orderBlocks) {
      drawBox(
        ob.startTime,
        ob.endTime,
        ob.top,
        ob.bottom,
        ob.type === "bullish",
        ob.type === "bullish" ? "+OB" : "-OB",
        ob.mitigated
      );
    }

    ctx.restore();
  }, [chartType, showSMC, smcData]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.2)", autoScale: true },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    chartRef.current = chart;
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    candleSeriesRef.current = candleSeries;

    const lineChartSeries = chart.addLineSeries({
      color: "#38bdf8",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    lineChartSeriesRef.current = lineChartSeries;

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const ma7Series = chart.addLineSeries({
      color: "#facc15",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma7SeriesRef.current = ma7Series;

    const ma25Series = chart.addLineSeries({
      color: "#38bdf8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma25SeriesRef.current = ma25Series;

    const ma99Series = chart.addLineSeries({
      color: "#c084fc",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma99SeriesRef.current = ma99Series;

    const lineSeries = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lineSeriesRef.current = lineSeries;

    // RSI subchart
    if (rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#94a3b8",
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: "rgba(148, 163, 184, 0.06)" },
        },
        rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.2)" },
        timeScale: { borderColor: "rgba(148, 163, 184, 0.2)", visible: false },
        autoSize: true,
      });
      rsiChartRef.current = rsiChart;

      const rsiSeries = rsiChart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      rsiSeries.createPriceLine({ price: 70, color: "rgba(239,68,68,0.3)", lineWidth: 1, lineStyle: LineStyle.Dashed });
      rsiSeries.createPriceLine({ price: 30, color: "rgba(34,197,94,0.3)", lineWidth: 1, lineStyle: LineStyle.Dashed });
      rsiSeriesRef.current = rsiSeries;
    }

    const timeScaleHandler = () => {
      requestAnimationFrame(drawSMCOverlay);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(timeScaleHandler);
    chart.timeScale().subscribeVisibleLogicalRangeChange(timeScaleHandler);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(timeScaleHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(timeScaleHandler);
      chart.remove();
      rsiChartRef.current?.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      candleSeriesRef.current = null;
      lineChartSeriesRef.current = null;
      lineSeriesRef.current = null;
      extraLineSeriesRef.current = [];
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      ma99SeriesRef.current = null;
      srSeriesRef.current = [];
      rsiSeriesRef.current = null;
    };
  }, [drawSMCOverlay]);

  const updateChart = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    if (!candles.length) {
      try { candleSeries.setData([]); } catch { /* */ }
      try { lineChartSeriesRef.current?.setData([]); } catch { /* */ }
      try { volumeSeriesRef.current?.setData([]); } catch { /* */ }
      try { ma7SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma25SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma99SeriesRef.current?.setData([]); } catch { /* */ }
      try { lineSeriesRef.current?.setData([]); } catch { /* */ }
      try { candleSeries.setMarkers([]); } catch { /* */ }
      try { rsiSeriesRef.current?.setData([]); } catch { /* */ }
      requestAnimationFrame(drawSMCOverlay);
      return;
    }

    try {
      if (chartType === "line") {
        candleSeries.applyOptions({ visible: false });
        lineChartSeriesRef.current?.applyOptions({ visible: true });
        lineChartSeriesRef.current?.setData(
          candles.map((c) => ({ time: c.time as Time, value: c.close }))
        );
      } else {
        candleSeries.applyOptions({ visible: true });
        lineChartSeriesRef.current?.applyOptions({ visible: false });
        candleSeries.setData(
          candles.map((c) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        );
      }
    } catch (e) {
      console.error("Chart: failed to set candle data", e);
    }

    try {
      volumeSeriesRef.current?.setData(
        candles.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
        }))
      );
    } catch (e) {
      console.error("Chart: failed to set volume data", e);
    }

    try {
      if (showIndicators) {
        const closes = candles.map((c) => c.close);
        const ma7Data = sma(closes, 7);
        const ma25Data = sma(closes, 25);
        const ma99Data = sma(closes, 99);

        if (ma7SeriesRef.current) {
          ma7SeriesRef.current.setData(
            candles
              .map((c, i) => ({ time: c.time as Time, value: ma7Data[i] as number }))
              .filter((d) => d.value !== null && d.value !== undefined)
          );
        }
        if (ma25SeriesRef.current) {
          ma25SeriesRef.current.setData(
            candles
              .map((c, i) => ({ time: c.time as Time, value: ma25Data[i] as number }))
              .filter((d) => d.value !== null && d.value !== undefined)
          );
        }
        if (ma99SeriesRef.current) {
          ma99SeriesRef.current.setData(
            candles
              .map((c, i) => ({ time: c.time as Time, value: ma99Data[i] as number }))
              .filter((d) => d.value !== null && d.value !== undefined)
          );
        }

        // RSI
        const rsiData = rsi(closes, 14);
        if (rsiSeriesRef.current) {
          rsiSeriesRef.current.setData(
            candles
              .map((c, i) => ({ time: c.time as Time, value: rsiData[i] as number }))
              .filter((d) => d.value !== null && d.value !== undefined)
          );
        }
      } else {
        ma7SeriesRef.current?.setData([]);
        ma25SeriesRef.current?.setData([]);
        ma99SeriesRef.current?.setData([]);
        rsiSeriesRef.current?.setData([]);
      }
    } catch (e) {
      console.error("Chart: failed to set indicator data", e);
      try { ma7SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma25SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma99SeriesRef.current?.setData([]); } catch { /* */ }
    }

    try {
      if (chartRef.current) {
        for (const s of srSeriesRef.current) {
          try { chartRef.current.removeSeries(s); } catch { /* */ }
        }
        srSeriesRef.current = [];

        if (showIndicators) {
          const srLevels = findSupportResistance(candles);
          const lastTime = candles[candles.length - 1].time as Time;
          const firstTime = candles[Math.max(0, candles.length - 60)].time as Time;
          for (const level of srLevels) {
            const srLine = chartRef.current.addLineSeries({
              color: level.type === "support" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            srLine.setData([
              { time: firstTime, value: level.price },
              { time: lastTime, value: level.price },
            ]);
            srSeriesRef.current.push(srLine);
          }
        }
      }
    } catch (e) {
      console.error("Chart: failed to set S/R levels", e);
    }

    try {
      if (chartRef.current) {
        for (const s of extraLineSeriesRef.current) {
          try { chartRef.current.removeSeries(s); } catch { /* */ }
        }
        extraLineSeriesRef.current = [];
      }

      if (lineSeriesRef.current) {
        if (pattern && pattern.points.length >= 2) {
          const baseColor = getPatternColor(pattern.type);
          lineSeriesRef.current.applyOptions({ color: baseColor, lineWidth: 2, lineStyle: 0 });
          const lineData: LineData[] = pattern.points.map((p) => ({
            time: p.time as Time,
            value: p.price,
          }));
          lineSeriesRef.current.setData(lineData);

          if (pattern.lines && chartRef.current) {
            for (const line of pattern.lines) {
              if (line.points.length < 2) continue;
              const extra = chartRef.current.addLineSeries({
                color: line.color ?? baseColor,
                lineWidth: 2,
                lineStyle: 2,
                priceLineVisible: false,
                lastValueVisible: false,
              });
              extra.setData(
                line.points.map((p) => ({
                  time: p.time as Time,
                  value: p.price,
                }))
              );
              extraLineSeriesRef.current.push(extra);
            }
          }

          const markers: SeriesMarker<Time>[] = pattern.points.map((p, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === pattern.points.length - 1;
            return {
              time: p.time as Time,
              position: pattern.direction === "bullish" ? "belowBar" : "aboveBar",
              color: baseColor,
              shape: isFirst || isLast ? "arrowUp" : "circle",
              text: isFirst ? pattern.name : "",
            };
          });
          candleSeries.setMarkers(markers);
        } else {
          lineSeriesRef.current.setData([]);
          candleSeries.setMarkers([]);
        }
      }
    } catch (e) {
      console.error("Chart: failed to set pattern overlay", e);
      try { lineSeriesRef.current?.setData([]); } catch { /* */ }
      try { candleSeries.setMarkers([]); } catch { /* */ }
    }

    requestAnimationFrame(() => {
      try { chart.timeScale().fitContent(); } catch { /* */ }
      try { rsiChartRef.current?.timeScale().fitContent(); } catch { /* */ }
      drawSMCOverlay();
    });
  }, [candles, pattern, showIndicators, chartType, drawSMCOverlay]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  // Redraw SMC overlay whenever smcData or chart updates
  useEffect(() => {
    const timer = setTimeout(() => {
      drawSMCOverlay();
    }, 50);
    return () => clearTimeout(timer);
  }, [drawSMCOverlay, smcData]);

  // Window resize listener to re-render overlay
  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(drawSMCOverlay);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawSMCOverlay]);

  const htfTrendLabel = htfTrend?.trend ?? "Neutral";
  const isHtfBull = htfTrendLabel === "Bullish";
  const isHtfBear = htfTrendLabel === "Bearish";

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* HTF Trend Badge above chart */}
      <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between text-xs flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide border shadow-sm transition-all ${
              isHtfBull
                ? "bg-green-500/15 text-green-400 border-green-500/30"
                : isHtfBear
                ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-slate-800 text-slate-300 border-slate-700"
            }`}
          >
            {isHtfBull ? (
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            ) : isHtfBear ? (
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <Minus className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>HTF Trend: {htfTrendLabel}</span>
            {htfLoading && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping ml-0.5" />
            )}
          </div>

          {/* HTF EMA stats tooltip / indicator */}
          {htfTrend?.ema1h && htfTrend?.ema4h && (
            <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400">
              <span className="bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                1H EMA(50): <strong className={htfTrend.price1h && htfTrend.price1h >= htfTrend.ema1h ? "text-green-400" : "text-red-400"}>${htfTrend.ema1h.toFixed(2)}</strong>
              </span>
              <span className="bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                4H EMA(50): <strong className={htfTrend.price4h && htfTrend.price4h >= htfTrend.ema4h ? "text-green-400" : "text-red-400"}>${htfTrend.ema4h.toFixed(2)}</strong>
              </span>
            </div>
          )}
        </div>

        {/* SMC legend & Analyze Setup Button */}
        <div className="flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
          <div className="hidden sm:flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-medium text-slate-300">SMC:</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500/30 border border-green-500/80" />
              <span>Bullish OB/FVG</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500/30 border border-red-500/80" />
              <span>Bearish OB/FVG</span>
            </div>
          </div>

          {/* Analyze Setup Button */}
          <button
            onClick={() => setConfluenceModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold shadow-md shadow-cyan-950/40 border border-cyan-400/30 transition-all active:scale-95 text-xs"
            title="Open Sniper Confluence Setup Analysis"
          >
            <Target className="w-3.5 h-3.5 text-cyan-200" />
            <span>Analyze Setup</span>
            {confluenceResult && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  confluenceResult.canExecute
                    ? "bg-green-500/30 text-green-300"
                    : "bg-slate-900/60 text-slate-300"
                }`}
              >
                {confluenceResult.score}/100
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Chart Canvas Container */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />
      </div>

      {/* RSI Subchart */}
      <div ref={rsiContainerRef} className="h-20 border-t border-slate-800 shrink-0" />
      <div className="px-2 py-0.5 text-[9px] text-slate-600 text-right shrink-0 bg-slate-900/50">
        RSI(14) <span className="text-purple-400 inline-flex items-center gap-1 ml-1">●</span>
        <span className="text-yellow-400 ml-2">MA7</span>
        <span className="text-blue-400 ml-2">MA25</span>
        <span className="text-purple-400 ml-2">MA99</span>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 z-20">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Loading Chart…</span>
          </div>
        </div>
      )}
      {!loading && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <span className="text-sm text-slate-500">No data available</span>
        </div>
      )}

      {/* Sniper Checklist Modal */}
      <SniperChecklistModal
        open={confluenceModalOpen}
        onClose={() => setConfluenceModalOpen(false)}
        result={confluenceResult}
        symbol={symbol}
        timeframe={timeframe}
        onExecuteTrade={() => {
          alert(`Trade executed with High Confluence (${confluenceResult?.score}/100)!`);
        }}
      />
    </div>
  );
}
