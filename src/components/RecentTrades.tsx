import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { subscribeTrades } from "../lib/websocket";
import { formatPrice } from "../lib/patterns";
import type { RecentTrade } from "../types";

interface Props {
  symbol: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function RecentTrades({ symbol }: Props) {
  const [trades, setTrades] = useState<RecentTrade[]>([]);

  useEffect(() => {
    setTrades([]);
    const unsubscribe = subscribeTrades(symbol, setTrades);
    return unsubscribe;
  }, [symbol]);

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-cyan-400" />
            Recent Trades
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{symbol} — live Binance trades</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-slate-500">Live</span>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Connecting to Binance…</p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="grid grid-cols-4 px-4 py-2.5 border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
            <span>Price</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Value</span>
            <span className="text-right">Time</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {trades.map((trade) => {
              const isBuy = !trade.isBuyerMaker;
              const value = trade.price * trade.quantity;
              return (
                <div
                  key={trade.id}
                  className="grid grid-cols-4 px-4 py-1.5 text-xs border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  <span className={`font-medium ${isBuy ? "text-green-400" : "text-red-400"}`}>
                    {formatPrice(trade.price)}
                  </span>
                  <span className="text-right text-slate-300">{trade.quantity.toFixed(6)}</span>
                  <span className="text-right text-slate-500">{formatPrice(value)}</span>
                  <span className={`text-right ${isBuy ? "text-green-400/60" : "text-red-400/60"}`}>
                    {formatTime(trade.time)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
