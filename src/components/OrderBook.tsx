import { useEffect, useState } from "react";
import { BookOpen, TrendingUp, TrendingDown } from "lucide-react";
import { subscribeOrderBook } from "../lib/websocket";
import { formatPrice } from "../lib/patterns";
import type { OrderBookData } from "../types";

interface Props {
  symbol: string;
}

export default function OrderBook({ symbol }: Props) {
  const [data, setData] = useState<OrderBookData | null>(null);

  useEffect(() => {
    setData(null);
    const unsubscribe = subscribeOrderBook(symbol, setData);
    return unsubscribe;
  }, [symbol]);

  const maxTotal = data
    ? Math.max(
        ...data.bids.map((b) => b.total),
        ...data.asks.map((a) => a.total)
      )
    : 1;

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            Order Book
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{symbol} — live Binance depth</p>
        </div>
        {data && (
          <div className="text-right">
            <p className="text-xs text-slate-500">Spread</p>
            <p className="text-sm font-medium text-slate-300">{formatPrice(data.spread)}</p>
          </div>
        )}
      </div>

      {!data ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Connecting to Binance…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Asks (sell orders) — reversed so highest is at top */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Asks (Sellers)</span>
            </div>
            <div className="px-2 py-1">
              <div className="grid grid-cols-3 text-[10px] text-slate-500 uppercase tracking-wider px-2 py-1">
                <span>Price</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Total</span>
              </div>
              <div className="space-y-0.5">
                {data.asks.slice(0, 12).reverse().map((ask, i) => (
                  <div
                    key={i}
                    className="relative grid grid-cols-3 px-2 py-1 text-xs rounded"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-red-500/10 rounded"
                      style={{ width: `${(ask.total / maxTotal) * 100}%` }}
                    />
                    <span className="relative text-red-400 font-medium">{formatPrice(ask.price)}</span>
                    <span className="relative text-right text-slate-300">{ask.quantity.toFixed(4)}</span>
                    <span className="relative text-right text-slate-500">{ask.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bids (buy orders) */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-green-400">Bids (Buyers)</span>
            </div>
            <div className="px-2 py-1">
              <div className="grid grid-cols-3 text-[10px] text-slate-500 uppercase tracking-wider px-2 py-1">
                <span>Price</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Total</span>
              </div>
              <div className="space-y-0.5">
                {data.bids.slice(0, 12).map((bid, i) => (
                  <div
                    key={i}
                    className="relative grid grid-cols-3 px-2 py-1 text-xs rounded"
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-green-500/10 rounded"
                      style={{ width: `${(bid.total / maxTotal) * 100}%` }}
                    />
                    <span className="relative text-green-400 font-medium">{formatPrice(bid.price)}</span>
                    <span className="relative text-right text-slate-300">{bid.quantity.toFixed(4)}</span>
                    <span className="relative text-right text-slate-500">{bid.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
