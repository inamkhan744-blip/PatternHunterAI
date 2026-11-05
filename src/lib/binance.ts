import type { Candle, Timeframe } from "../types";

const BINANCE_API = "https://api.binance.com/api/v3/klines";

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
