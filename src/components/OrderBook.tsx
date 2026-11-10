import { useState, useCallback, useMemo } from "react";
import {
  BookOpen,
  TrendingUp,
  TrendingDown,
  Wifi,
  WifiOff,
  RefreshCw,
  Activity,
  Layers,
  BarChart2,
  ShieldAlert,
  Sliders,
} from "lucide-react";
import { formatPrice } from "../lib/patterns";
import { useBinanceWebSocket } from "../lib/useBinanceWebSocket";
import type { OrderBookData, OrderBookEntry } from "../types";

interface Props {
  symbol: string;
}

type ViewMode = "depth_chart" | "order_book" | "volume_profile";

interface WhaleWall {
  price: number;
  quantity: number;
  notionalUsd: number;
  side: "BID" | "ASK";
  distancePct: number;
}

export default function OrderBook({ symbol }: Props) {
  const [data, setData] = useState<OrderBookData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("depth_chart");
  const [_zoomLevel, _setZoomLevel] = useState<number>(2); // 1%, 2%, 5%
  void _zoomLevel; void _setZoomLevel;
  const [hoveredPoint, setHoveredPoint] = useState<{
    price: number;
    cumulative: number;
    side: "BID" | "ASK";
  } | null>(null);

  const streamName = `${symbol.toLowerCase()}@depth20@100ms`;

  const handleMessage = useCallback((raw: unknown) => {
    const msg = raw as {
      stream?: string;
      data?: { bids: [string, string][]; asks: [string, string][] };
      bids?: [string, string][];
      asks?: [string, string][];
    };

    const depth = msg.data || msg;
    if (!depth?.bids || !depth?.asks) return;

    let bidTotal = 0;
    const bids: OrderBookEntry[] = depth.bids.slice(0, 20).map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      bidTotal += quantity;
      return { price, quantity, total: bidTotal };
    });

    let askTotal = 0;
    const asks: OrderBookEntry[] = depth.asks.slice(0, 20).map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      askTotal += quantity;
      return { price, quantity, total: askTotal };
    });

    const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : 0;
    setData({ bids, asks, spread });
  }, []);

  const { status, reconnectAttempts, latency, reconnect } = useBinanceWebSocket({
    streams: [streamName],
    onMessage: handleMessage,
  });

  const midPrice = useMemo(() => {
    if (!data || data.bids.length === 0 || data.asks.length === 0) return 0;
    return (data.bids[0].price + data.asks[0].price) / 2;
  }, [data]);

  const maxTotal = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      ...data.bids.map((b) => b.total),
      ...data.asks.map((a) => a.total),
      1
    );
  }, [data]);

  // Institutional Whale Detection: Detect orders with high notional value
  const whaleThreshold = useMemo(() => {
    if (!data) return 50000;
    const allNotionals = [
      ...data.bids.map((b) => b.price * b.quantity),
      ...data.asks.map((a) => a.price * a.quantity),
    ].sort((a, b) => b - a);

    if (allNotionals.length === 0) return 50000;
    const p80 = allNotionals[Math.floor(allNotionals.length * 0.2)] || 20000;
    return Math.max(20000, p80);
  }, [data]);

  // Detected Whale Walls
  const whaleWalls = useMemo(() => {
    if (!data || midPrice === 0) return { bidWalls: [], askWalls: [] };

    const bidWalls: WhaleWall[] = data.bids
      .map((b) => ({
        price: b.price,
        quantity: b.quantity,
        notionalUsd: b.price * b.quantity,
        side: "BID" as const,
        distancePct: ((midPrice - b.price) / midPrice) * 100,
      }))
      .filter((w) => w.notionalUsd >= whaleThreshold)
      .slice(0, 3);

    const askWalls: WhaleWall[] = data.asks
      .map((a) => ({
        price: a.price,
        quantity: a.quantity,
        notionalUsd: a.price * a.quantity,
        side: "ASK" as const,
        distancePct: ((a.price - midPrice) / midPrice) * 100,
      }))
      .filter((w) => w.notionalUsd >= whaleThreshold)
      .slice(0, 3);

    return { bidWalls, askWalls };
  }, [data, midPrice, whaleThreshold]);

  const spreadPercent = useMemo(() => {
    if (!data || data.asks.length === 0 || data.asks[0].price === 0) return 0;
    return (data.spread / data.asks[0].price) * 100;
  }, [data]);

  // Total Bid & Ask Liquidity Depth comparison
  const totalBidVolume = useMemo(() => {
    if (!data || data.bids.length === 0) return 0;
    return data.bids[data.bids.length - 1].total;
  }, [data]);

  const totalAskVolume = useMemo(() => {
    if (!data || data.asks.length === 0) return 0;
    return data.asks[data.asks.length - 1].total;
  }, [data]);

  const bidAskRatio = useMemo(() => {
    const sum = totalBidVolume + totalAskVolume;
    if (sum === 0) return 50;
    return (totalBidVolume / sum) * 100;
  }, [totalBidVolume, totalAskVolume]);

  // SVG Depth Chart Coordinate Calculations
  const depthSvgCoordinates = useMemo(() => {
    if (!data || data.bids.length === 0 || data.asks.length === 0) {
      return { bidPoints: "", askPoints: "", bidArea: "", askArea: "" };
    }

    const svgWidth = 800;
    const svgHeight = 280;
    const halfWidth = svgWidth / 2;

    const maxVol = Math.max(
      data.bids[data.bids.length - 1].total,
      data.asks[data.asks.length - 1].total,
      1
    );

    // Bids (Buy side): Green, from midPrice (halfWidth) going left (0)
    // In bids array: index 0 is closest to midPrice, last index is furthest left
    const bidCoords: { x: number; y: number; price: number; total: number }[] = [];
    data.bids.forEach((bid, idx) => {
      const x = halfWidth - (idx / (data.bids.length - 1)) * halfWidth;
      const y = svgHeight - (bid.total / maxVol) * (svgHeight - 30);
      bidCoords.push({ x, y, price: bid.price, total: bid.total });
    });

    // Asks (Sell side): Red, from midPrice (halfWidth) going right (svgWidth)
    // In asks array: index 0 is closest to midPrice, last index is furthest right
    const askCoords: { x: number; y: number; price: number; total: number }[] = [];
    data.asks.forEach((ask, idx) => {
      const x = halfWidth + (idx / (data.asks.length - 1)) * halfWidth;
      const y = svgHeight - (ask.total / maxVol) * (svgHeight - 30);
      askCoords.push({ x, y, price: ask.price, total: ask.total });
    });

    // Build SVG polyline points
    const bidPoints = bidCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const askPoints = askCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    // Build SVG filled areas (closed path)
    const bidArea = `M ${halfWidth},${svgHeight} ` +
      bidCoords.map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ") +
      ` L 0,${svgHeight} Z`;

    const askArea = `M ${halfWidth},${svgHeight} ` +
      askCoords.map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ") +
      ` L ${svgWidth},${svgHeight} Z`;

    return { bidPoints, askPoints, bidArea, askArea, bidCoords, askCoords };
  }, [data]);

  // Volume Profile (Volume at Price Level distribution)
  const volumeProfileData = useMemo(() => {
    if (!data) return [];
    const combined = [
      ...data.bids.map((b) => ({
        price: b.price,
        volume: b.quantity,
        notional: b.price * b.quantity,
        side: "BID" as const,
      })),
      ...data.asks.map((a) => ({
        price: a.price,
        volume: a.quantity,
        notional: a.price * a.quantity,
        side: "ASK" as const,
      })),
    ].sort((a, b) => b.price - a.price);

    const maxNotional = Math.max(...combined.map((c) => c.notional), 1);
    return combined.map((item) => ({
      ...item,
      percentage: (item.notional / maxNotional) * 100,
    }));
  }, [data]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-4">
      {/* Top Header & Terminal Status Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" />
              Institutional Order Book & Visual Depth Chart
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              @depth20@100ms
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Real-time Binance depth stream with dynamic whale walls and volume profile analysis
          </p>
        </div>

        {/* Mode Selector Tabs & Network Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode("depth_chart")}
              className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "depth_chart"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Depth Chart</span>
            </button>
            <button
              onClick={() => setViewMode("order_book")}
              className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "order_book"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>L2 Book</span>
            </button>
            <button
              onClick={() => setViewMode("volume_profile")}
              className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === "volume_profile"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Volume Profile</span>
            </button>
          </div>

          {/* Connection Status Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              status === "CONNECTED"
                ? "bg-[#00ff66]/10 text-[#00ff66] border-[#00ff66]/30 shadow-sm shadow-[#00ff66]/20"
                : status === "RECONNECTING" || status === "CONNECTING"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse"
                : "bg-red-500/10 text-[#ff3344] border-red-500/30"
            }`}
          >
            {status === "CONNECTED" ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-[#00ff66]" />
                <span>ONLINE {latency !== null ? `(${latency}ms)` : ""}</span>
              </>
            ) : status === "RECONNECTING" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>RECONNECTING (#{reconnectAttempts})</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-[#ff3344]" />
                <span>DISCONNECTED</span>
              </>
            )}
          </div>

          {status !== "CONNECTED" && (
            <button
              onClick={reconnect}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Manual Reconnect"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Whale Walls & Order Flow Liquidity Bar */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bid/Ask Volume Imbalance Meter */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1 font-bold">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                ORDER FLOW PRESSURE
              </span>
              <span className="text-slate-300 font-bold">
                {bidAskRatio.toFixed(1)}% Bids / {(100 - bidAskRatio).toFixed(1)}% Asks
              </span>
            </div>
            {/* Visual ratio bar */}
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
              <div
                className="bg-[#00ff66] transition-all duration-300"
                style={{ width: `${bidAskRatio}%` }}
              />
              <div
                className="bg-[#ff3344] transition-all duration-300"
                style={{ width: `${100 - bidAskRatio}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-sans">
              <span className="text-[#00ff66]">Total Bids: {totalBidVolume.toFixed(2)}</span>
              <span className="text-[#ff3344]">Total Asks: {totalAskVolume.toFixed(2)}</span>
            </div>
          </div>

          {/* Whale Support Walls */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-emerald-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#00ff66] font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                WHALE BUY WALLS
              </span>
              <span className="text-[10px] text-slate-500 font-sans">Threshold &gt; ${whaleThreshold.toLocaleString()}</span>
            </div>
            {whaleWalls.bidWalls.length === 0 ? (
              <p className="text-xs text-slate-500 font-sans italic py-1">No major whale walls in top 20 levels</p>
            ) : (
              <div className="space-y-1">
                {whaleWalls.bidWalls.map((wall, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-emerald-950/30 border border-emerald-500/20">
                    <span className="text-[#00ff66] font-bold">{formatPrice(wall.price)}</span>
                    <span className="text-slate-300">${(wall.notionalUsd / 1000).toFixed(1)}K</span>
                    <span className="text-slate-500 text-[10px]">(-{wall.distancePct.toFixed(2)}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Whale Resistance Walls */}
          <div className="p-4 rounded-xl bg-[#090d16] border border-red-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#ff3344] font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                WHALE SELL WALLS
              </span>
              <span className="text-[10px] text-slate-500 font-sans">Threshold &gt; ${whaleThreshold.toLocaleString()}</span>
            </div>
            {whaleWalls.askWalls.length === 0 ? (
              <p className="text-xs text-slate-500 font-sans italic py-1">No major sell walls in top 20 levels</p>
            ) : (
              <div className="space-y-1">
                {whaleWalls.askWalls.map((wall, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-red-950/30 border border-red-500/20">
                    <span className="text-[#ff3344] font-bold">{formatPrice(wall.price)}</span>
                    <span className="text-slate-300">${(wall.notionalUsd / 1000).toFixed(1)}K</span>
                    <span className="text-slate-500 text-[10px]">(+{wall.distancePct.toFixed(2)}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Viewport Content */}
      {!data ? (
        <div className="flex flex-col items-center justify-center py-24 bg-slate-950/60 rounded-2xl border border-slate-800">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm font-sans">Connecting to Binance @depth20 WebSocket stream…</p>
          <p className="text-slate-600 text-xs font-sans mt-1">Direct institutional socket link</p>
        </div>
      ) : viewMode === "depth_chart" ? (
        /* VISUAL DEPTH CHART VIEW */
        <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Cumulative Market Depth (Bids vs Asks)
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                Mid: ${midPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 uppercase text-[10px]">Spread:</span>
              <span className={`font-bold ${spreadPercent > 0.1 ? "text-amber-400" : "text-[#00ff66]"}`}>
                {formatPrice(data.spread)} ({spreadPercent.toFixed(3)}%)
              </span>
            </div>
          </div>

          {/* SVG Depth Chart */}
          <div className="relative w-full h-72 bg-slate-950/90 rounded-xl border border-slate-800/80 overflow-hidden flex flex-col justify-end">
            {hoveredPoint && (
              <div className="absolute top-3 left-4 z-10 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs space-y-0.5 shadow-xl">
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${hoveredPoint.side === "BID" ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                    {hoveredPoint.side}
                  </span>
                  <span className="text-white font-mono">${formatPrice(hoveredPoint.price)}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Cumulative Size: {hoveredPoint.cumulative.toFixed(4)}
                </div>
              </div>
            )}

            <svg
              viewBox="0 0 800 280"
              className="w-full h-full select-none"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="bidGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#00ff66" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#00ff66" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="askGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ff3344" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#ff3344" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="400" y1="0" x2="400" y2="280" stroke="#334155" strokeDasharray="3 3" strokeWidth="1" />
              <line x1="0" y1="210" x2="800" y2="210" stroke="#1e293b" strokeWidth="1" />
              <line x1="0" y1="140" x2="800" y2="140" stroke="#1e293b" strokeWidth="1" />
              <line x1="0" y1="70" x2="800" y2="70" stroke="#1e293b" strokeWidth="1" />

              {/* Bid Area & Line */}
              <path d={depthSvgCoordinates.bidArea} fill="url(#bidGradient)" />
              <polyline
                fill="none"
                stroke="#00ff66"
                strokeWidth="2.5"
                points={depthSvgCoordinates.bidPoints}
              />

              {/* Ask Area & Line */}
              <path d={depthSvgCoordinates.askArea} fill="url(#askGradient)" />
              <polyline
                fill="none"
                stroke="#ff3344"
                strokeWidth="2.5"
                points={depthSvgCoordinates.askPoints}
              />

              {/* Interactive Circles on Depth Points */}
              {depthSvgCoordinates.bidCoords?.map((pt, i) => (
                <circle
                  key={`bid-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={4}
                  className="fill-[#00ff66] hover:scale-150 transition-all cursor-pointer opacity-70 hover:opacity-100"
                  onMouseEnter={() => setHoveredPoint({ price: pt.price, cumulative: pt.total, side: "BID" })}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              ))}

              {depthSvgCoordinates.askCoords?.map((pt, i) => (
                <circle
                  key={`ask-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={4}
                  className="fill-[#ff3344] hover:scale-150 transition-all cursor-pointer opacity-70 hover:opacity-100"
                  onMouseEnter={() => setHoveredPoint({ price: pt.price, cumulative: pt.total, side: "ASK" })}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              ))}
            </svg>

            {/* Bottom Price Scale */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#060910] border-t border-slate-800 text-[11px] text-slate-400">
              <span className="text-[#00ff66]">
                Min Bid: ${formatPrice(data.bids[data.bids.length - 1]?.price || 0)}
              </span>
              <span className="font-bold text-white">
                Spread: ${formatPrice(data.spread)}
              </span>
              <span className="text-[#ff3344]">
                Max Ask: ${formatPrice(data.asks[data.asks.length - 1]?.price || 0)}
              </span>
            </div>
          </div>
        </div>
      ) : viewMode === "volume_profile" ? (
        /* VOLUME PROFILE (HEATMAP AT PRICE LEVELS) */
        <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-cyan-400" />
              Volume Profile (Volume at Price Distribution)
            </span>
            <span className="text-[11px] text-slate-400 font-sans">
              Top 40 active price nodes with liquidity clustering
            </span>
          </div>

          <div className="space-y-1 max-h-[500px] overflow-y-auto pr-2">
            {volumeProfileData.map((node, i) => {
              const isWhale = node.notional >= whaleThreshold;
              return (
                <div
                  key={i}
                  className={`relative flex items-center justify-between px-3 py-1.5 text-xs rounded transition ${
                    isWhale
                      ? node.side === "BID"
                        ? "bg-emerald-950/30 border border-emerald-500/40"
                        : "bg-red-950/30 border border-red-500/40"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  {/* Volume bar background */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 pointer-events-none rounded transition-all ${
                      node.side === "BID"
                        ? "bg-gradient-to-r from-emerald-500/25 to-emerald-500/5"
                        : "bg-gradient-to-r from-red-500/25 to-red-500/5"
                    }`}
                    style={{ width: `${node.percentage}%` }}
                  />

                  <div className="relative flex items-center gap-2">
                    <span
                      className={`font-bold ${
                        node.side === "BID" ? "text-[#00ff66]" : "text-[#ff3344]"
                      }`}
                    >
                      {formatPrice(node.price)}
                    </span>
                    {isWhale && (
                      <span
                        className={`px-1 py-0.2 rounded text-[9px] font-black uppercase font-sans ${
                          node.side === "BID"
                            ? "bg-emerald-600/30 text-emerald-300"
                            : "bg-red-600/30 text-red-300"
                        }`}
                      >
                        WHALE WALL
                      </span>
                    )}
                  </div>

                  <div className="relative flex items-center gap-4 text-[11px]">
                    <span className="text-slate-300 font-mono">
                      {node.volume.toFixed(4)}
                    </span>
                    <span className="text-slate-400 font-mono w-20 text-right">
                      ${node.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* STANDARD 2-COLUMN L2 ORDER BOOK VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Asks (Sell Orders) */}
          <div className="rounded-xl bg-[#090d16] border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-4 py-3 border-b border-slate-800/80 bg-[#060910] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-[#ff3344]" />
                <span className="text-xs font-bold text-[#ff3344] uppercase tracking-wider">
                  Asks (Sell Liquidity)
                </span>
              </div>
              <span className="text-[10px] text-slate-500">
                20 Depth Levels
              </span>
            </div>

            <div className="p-2">
              <div className="grid grid-cols-4 text-[10px] text-slate-500 uppercase tracking-wider px-2 py-1.5 border-b border-slate-800/60">
                <span>Price (USDT)</span>
                <span className="text-right">Size</span>
                <span className="text-right">Notional ($)</span>
                <span className="text-right">Cumulative</span>
              </div>

              <div className="space-y-1 mt-1">
                {data.asks
                  .slice(0, 20)
                  .reverse()
                  .map((ask, i) => {
                    const notional = ask.price * ask.quantity;
                    const isWhale = notional >= whaleThreshold;
                    const depthPercent = (ask.total / maxTotal) * 100;

                    return (
                      <div
                        key={i}
                        className={`relative grid grid-cols-4 px-2 py-1 text-xs rounded transition-colors ${
                          isWhale ? "bg-red-500/15 border border-red-500/40" : "hover:bg-slate-800/40"
                        }`}
                      >
                        {/* Horizontal volume bar */}
                        <div
                          className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-red-500/25 to-red-500/5 rounded pointer-events-none"
                          style={{ width: `${depthPercent}%` }}
                        />
                        <span className="relative text-[#ff3344] font-bold flex items-center gap-1">
                          {formatPrice(ask.price)}
                          {isWhale && (
                            <span className="px-1 py-0.2 rounded text-[9px] bg-red-600/30 text-red-300 font-sans font-bold uppercase">
                              WHALE
                            </span>
                          )}
                        </span>
                        <span className="relative text-right text-slate-300">{ask.quantity.toFixed(4)}</span>
                        <span className="relative text-right text-slate-400 font-mono">
                          ${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                        <span className="relative text-right text-slate-500">{ask.total.toFixed(2)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Bids (Buy Orders) */}
          <div className="rounded-xl bg-[#090d16] border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-4 py-3 border-b border-slate-800/80 bg-[#060910] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#00ff66]" />
                <span className="text-xs font-bold text-[#00ff66] uppercase tracking-wider">
                  Bids (Buy Liquidity)
                </span>
              </div>
              <span className="text-[10px] text-slate-500">
                20 Depth Levels
              </span>
            </div>

            <div className="p-2">
              <div className="grid grid-cols-4 text-[10px] text-slate-500 uppercase tracking-wider px-2 py-1.5 border-b border-slate-800/60">
                <span>Price (USDT)</span>
                <span className="text-right">Size</span>
                <span className="text-right">Notional ($)</span>
                <span className="text-right">Cumulative</span>
              </div>

              <div className="space-y-1 mt-1">
                {data.bids.slice(0, 20).map((bid, i) => {
                  const notional = bid.price * bid.quantity;
                  const isWhale = notional >= whaleThreshold;
                  const depthPercent = (bid.total / maxTotal) * 100;

                  return (
                    <div
                      key={i}
                      className={`relative grid grid-cols-4 px-2 py-1 text-xs rounded transition-colors ${
                        isWhale ? "bg-green-500/15 border border-green-500/40" : "hover:bg-slate-800/40"
                      }`}
                    >
                      {/* Horizontal volume bar */}
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-green-500/25 to-green-500/5 rounded pointer-events-none"
                        style={{ width: `${depthPercent}%` }}
                      />
                      <span className="relative text-[#00ff66] font-bold flex items-center gap-1">
                        {formatPrice(bid.price)}
                        {isWhale && (
                          <span className="px-1 py-0.2 rounded text-[9px] bg-green-600/30 text-green-300 font-sans font-bold uppercase">
                            WHALE
                          </span>
                        )}
                      </span>
                      <span className="relative text-right text-slate-300">{bid.quantity.toFixed(4)}</span>
                      <span className="relative text-right text-slate-400 font-mono">
                        ${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                      <span className="relative text-right text-slate-500">{bid.total.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
