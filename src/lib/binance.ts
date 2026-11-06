import type { Candle, MarketStats, Timeframe } from "../types";

const BINANCE_API = "https://api.binance.com/api/v3/klines";
const TICKER_API = "https://api.binance.com/api/v3/ticker/24hr";

export async function fetchCandles(
  symbol: string,
  limit = 200,
  interval: Timeframe = "1h"
): Promise<Candle[]> {
  const url = `${BINANCE_API}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch data for ${symbol} (${res.status})`);
  }
  const raw: unknown[][] = await res.json();
  return raw.map((row) => ({
    time: Math.floor(row[0] as number / 1000),
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
  }));
}

export async function fetchMarketStats(symbol: string): Promise<MarketStats | null> {
  try {
    const res = await fetch(`${TICKER_API}?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json() as {
      highPrice: string;
      lowPrice: string;
      quoteVolume: string;
      priceChangePercent: string;
    };
    return {
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume24h: parseFloat(data.quoteVolume),
      priceChangePercent24h: parseFloat(data.priceChangePercent),
    };
  } catch {
    return null;
  }
}
