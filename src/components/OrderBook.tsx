import { useState, useCallback, useMemo } from "react";
import {
  BookOpen,
  TrendingUp,
  TrendingDown,
  Wifi,
  WifiOff,
  RefreshCw,
  Crown,
  Activity,
  Layers,
} from "lucide-react";
import { formatPrice } from "../lib/patterns";
import { useBinanceWebSocket } from "../lib/useBinanceWebSocket";
import type { OrderBookData, OrderBookEntry } from "../types";

interface Props {
  symbol: string;
}

export default function OrderBook({ symbol }: Props) {
  const [data, setData] = useState<OrderBookData | null>(null);

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
    const bids: OrderBookEntry[] = depth.bids.slice(0, 15).map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      bidTotal += quantity;
      return { price, quantity, total: bidTotal };
    });

    let askTotal = 0;
    const asks: OrderBookEntry[] = depth.asks.slice(0, 15).map(([p, q]) => {
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

  const spreadPercent = useMemo(() => {
    if (!data || data.asks.length === 0 || data.asks[0].price === 0) return 0;
    return (data.spread / data.asks[0].price) * 100;
  }, [data]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono">
      {/* Top Header & Terminal Status Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" />
              Institutional Order Book (L2 Depth)
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              @depth20@100ms
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Real-time Binance depth stream with horizontal whale block detection
          </p>
        </div>

        {/* Network & Health Badges */}
        <div className="flex items-center gap-3">
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

          {data && (
            <div className="text-right px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg">
              <span className="text-[10px] text-slate-500 block uppercase">Spread</span>
              <span
                className={`text-xs font-bold font-mono ${
                  spreadPercent > 0.1 ? "text-amber-400" : "text-[#00ff66]"
                }`}
              >
                {formatPrice(data.spread)} ({spreadPercent.toFixed(3)}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {!data ? (
        <div className="flex flex-col items-center justify-center py-24 bg-slate-950/60 rounded-2xl border border-slate-800">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm font-sans">Connecting to Binance @depth20 WebSocket stream…</p>
          <p className="text-slate-600 text-xs font-sans mt-1">Direct institutional socket link</p>
        </div>
      ) : (
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
                15 Depth Levels
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
                  .slice(0, 15)
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
                15 Depth Levels
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
                {data.bids.slice(0, 15).map((bid, i) => {
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
