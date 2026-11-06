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
import { sma, rsi, findSupportResistance } from "../lib/indicators";

interface Props {
  candles: Candle[];
  pattern: DetectedPattern | null;
  showIndicators?: boolean;
  loading?: boolean;
}

export default function CandlestickChart({ candles, pattern, showIndicators = true, loading = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma99SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const srSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

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

    return () => {
      chart.remove();
      rsiChartRef.current?.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      extraLineSeriesRef.current = [];
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      ma99SeriesRef.current = null;
      srSeriesRef.current = [];
      rsiSeriesRef.current = null;
    };
  }, []);

  const updateChart = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    if (!candles.length) {
      try { candleSeries.setData([]); } catch { /* */ }
      try { volumeSeriesRef.current?.setData([]); } catch { /* */ }
      try { ma7SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma25SeriesRef.current?.setData([]); } catch { /* */ }
      try { ma99SeriesRef.current?.setData([]); } catch { /* */ }
      try { lineSeriesRef.current?.setData([]); } catch { /* */ }
      try { candleSeries.setMarkers([]); } catch { /* */ }
      try { rsiSeriesRef.current?.setData([]); } catch { /* */ }
      return;
    }

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
    });
  }, [candles, pattern, showIndicators]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div className="relative w-full h-full flex flex-col">
      <div ref={containerRef} className="flex-1 min-h-0" />
      <div ref={rsiContainerRef} className="h-20 border-t border-slate-800 shrink-0" />
      <div className="px-2 py-0.5 text-[9px] text-slate-600 text-right shrink-0 bg-slate-900/50">
        RSI(14) <span className="text-purple-400 inline-flex items-center gap-1 ml-1">●</span>
        <span className="text-yellow-400 ml-2">MA7</span>
        <span className="text-blue-400 ml-2">MA25</span>
        <span className="text-purple-400 ml-2">MA99</span>
      </div>
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
