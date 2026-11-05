import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle, DetectedPattern } from "../types";
import { getPatternColor } from "../lib/patterns";

interface Props {
  candles: Candle[];
  pattern: DetectedPattern | null;
}

export default function CandlestickChart({ candles, pattern }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const extraLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

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

    // Remove any extra line series from the previous render
    if (chartRef.current) {
      for (const s of extraLineSeriesRef.current) {
        try {
          chartRef.current.removeSeries(s);
        } catch {
          // already removed
        }
      }
      extraLineSeriesRef.current = [];
    }

    if (!lineSeriesRef.current) return;

    if (pattern && pattern.points.length >= 2) {
      const baseColor = getPatternColor(pattern.type);

      // Primary line: connects the main pattern points
      lineSeriesRef.current.applyOptions({ color: baseColor, lineWidth: 2, lineStyle: 0 });
      const lineData: LineData[] = pattern.points.map((p) => ({
        time: p.time as Time,
        value: p.price,
      }));
      lineSeriesRef.current.setData(lineData);

      // Extra lines (e.g. neckline, flag channel, triangle trendlines)
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

      // Markers on key points
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
  }, [candles, pattern]);

  useEffect(() => {
    updateChart();
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [updateChart]);

  return <div ref={containerRef} className="w-full h-full" />;
}
