import { useEffect, useState, useRef } from "react";
import { COINS, PRO_COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { formatPrice } from "../lib/patterns";

interface TickerItem {
  symbol: string;
  price: number;
  change: number;
}

export default function MarketTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const coins = [...COINS, ...PRO_COINS.slice(0, 20)];
      const settled = await Promise.allSettled(
        coins.map(async (c) => {
          const data = await fetchCandles(c.binanceSymbol, 25, "1h");
          if (data.length < 2) return null;
          const first = data[0].close;
          const last = data[data.length - 1].close;
          return {
            symbol: c.symbol,
            price: last,
            change: ((last - first) / first) * 100,
          };
        })
      );
      if (cancelled) return;
      const results = settled
        .map((s) => (s.status === "fulfilled" ? s.value : null))
        .filter((v): v is TickerItem => v !== null);
      setItems(results);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  return (
    <div className="overflow-hidden bg-slate-950 border-b border-slate-800/50 py-1.5">
      <div
        ref={scrollRef}
        className="flex items-center gap-6 whitespace-nowrap animate-ticker"
      >
        {doubled.map((item, idx) => (
          <div key={`${item.symbol}-${idx}`} className="flex items-center gap-2 text-xs shrink-0">
            <span className="font-semibold text-slate-300">{item.symbol}</span>
            <span className="text-slate-400">{formatPrice(item.price)}</span>
            <span className={item.change >= 0 ? "text-green-400" : "text-red-400"}>
              {item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
