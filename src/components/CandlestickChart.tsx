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
import type { Candle, DetectedPattern, SRLevel } from "../types";
import { getPatternColor } from "../lib/patterns";
import { sma, findSupportResistance } from "../lib/indicators";

interface Props {
  candles: Candle[];
  pattern: DetectedPattern | null;
  showIndicators?: boolean;
}

export default function CandlestickChart({ candles, pattern, showIndicators = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const srSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

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
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.2)" },
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

  const updateChart = useCallback(() => {
    if (!candleSeriesRef.current || !candles.length) return;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
        }))
      );
    }

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

      // S/R levels
      if (chartRef.current) {
        for (const s of srSeriesRef.current) {
          try { chartRef.current.removeSeries(s); } catch { /* */ }
        }
        srSeriesRef.current = [];

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
    } else {
      if (ma7SeriesRef.current) ma7SeriesRef.current.setData([]);
      if (ma25SeriesRef.current) ma25SeriesRef.current.setData([]);
    }

    // Remove any extra line series from the previous render
    if (chartRef.current) {
      for (const s of extraLineSeriesRef.current) {
        try { chartRef.current.removeSeries(s); } catch { /* */ }
      }
      extraLineSeriesRef.current = [];
    }

    if (!lineSeriesRef.current) return;

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
      candleSeriesRef.current.setMarkers(markers);
    } else {
      lineSeriesRef.current.setData([]);
      candleSeriesRef.current.setMarkers([]);
    }
  }, [candles, pattern, showIndicators]);

  useEffect(() => {
    updateChart();
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [updateChart]);

  return <div ref={containerRef} className="w-full h-full" />;
}
