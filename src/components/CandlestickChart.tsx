import { useEffect, useRef, useCallback } from "react";
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
import type { Candle, DetectedPattern } from "../types";
import { getPatternColor } from "../lib/patterns";
import { sma, findSupportResistance } from "../lib/indicators";

interface Props {
  candles: Candle[];
  pattern: DetectedPattern | null;
  showIndicators?: boolean;
  loading?: boolean;
}

export default function CandlestickChart({ candles, pattern, showIndicators = true, loading = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const srSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  // Chart creation — runs once
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

    const lineSeries = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lineSeriesRef.current = lineSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      extraLineSeriesRef.current = [];
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      srSeriesRef.current = [];
    };
  }, []);

  // Chart data update — runs whenever candles/pattern/indicators change
  const updateChart = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    // If no data, clear everything
    if (!candles.length) {
      try { candleSeries.setData([]); } catch { /* */ }
      try { volumeSeriesRef.current?.setData([]); } catch { /* */ }
      try { ma7SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma25SeriesRef.current?.setData([]); } catch { /* */ }
      try { lineSeriesRef.current?.setData([]); } catch { /* */ }
      try { candleSeries.setMarkers([]); } catch { /* */ }
      return;
    }

    // 1. Set candlestick data (most important — do this first and independently)
    try {
      candleSeries.setData(
        candles.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    } catch (e) {
      console.error("Chart: failed to set candle data", e);
    }

    // 2. Set volume data
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

    // 3. Set moving averages
    try {
      if (showIndicators) {
        const closes = candles.map((c) => c.close);
        const ma7Data = sma(closes, 7);
        const ma25Data = sma(closes, 25);

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
      } else {
        ma7SeriesRef.current?.setData([]);
        ma25SeriesRef.current?.setData([]);
      }
    } catch (e) {
      console.error("Chart: failed to set MA data", e);
      try { ma7SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma25SeriesRef.current?.setData([]); } catch { /* */ }
    }

    // 4. Update S/R levels (remove old, add new)
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

    // 5. Update pattern overlay lines
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

    // 6. Fit content — use requestAnimationFrame so the chart processes data first
    requestAnimationFrame(() => {
      try {
        chart.timeScale().fitContent();
      } catch { /* */ }
    });
  }, [candles, pattern, showIndicators]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Loading Chart…</span>
          </div>
        </div>
      )}
      {!loading && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="text-sm text-slate-500">No data available</span>
        </div>
      )}
    </div>
  );
}
