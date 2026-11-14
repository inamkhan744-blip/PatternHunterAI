import type { Candle, MarketStats, Timeframe, Coin } from "../types";

const BINANCE_API = "https://api.binance.com/api/v3/klines";
const TICKER_API = "https://api.binance.com/api/v3/ticker/24hr";

export async function fetchCandles(
  symbol: string,
  limit = 200,
  interval: Timeframe = "1h"
): Promise<Candle[]> {
  const binanceInterval = interval === "1W" ? "1w" : interval;
  const url = `${BINANCE_API}?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
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

let topPairsCache: { data: Coin[]; timestamp: number } | null = null;
let volumes24hCache: { data: Record<string, number>; timestamp: number } | null = null;
let marketCapsCache: { data: Record<string, number>; timestamp: number } | null = null;

export async function fetchTopUsdtPairs(limit = 100): Promise<Coin[]> {
  const now = Date.now();
  if (topPairsCache && now - topPairsCache.timestamp < 5 * 60 * 1000) {
    return topPairsCache.data.slice(0, limit);
  }

  try {
    const res = await fetch(TICKER_API);
    if (!res.ok) throw new Error(`Ticker fetch failed (${res.status})`);
    const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>;
    const result = data
      .filter(
        (item) =>
          item.symbol.endsWith("USDT") &&
          !item.symbol.endsWith("UPUSDT") &&
          !item.symbol.endsWith("DOWNUSDT") &&
          !item.symbol.endsWith("BULLUSDT") &&
          !item.symbol.endsWith("BEARUSDT")
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .map((item) => ({
        symbol: item.symbol.replace("USDT", ""),
        label: item.symbol.replace("USDT", ""),
        binanceSymbol: item.symbol,
      }));
    topPairsCache = { data: result, timestamp: Date.now() };
    return result.slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetch24hQuoteVolumes(): Promise<Record<string, number>> {
  const now = Date.now();
  if (volumes24hCache && now - volumes24hCache.timestamp < 5 * 60 * 1000) {
    return volumes24hCache.data;
  }

  try {
    const res = await fetch(TICKER_API);
    if (!res.ok) throw new Error(`Ticker fetch failed (${res.status})`);
    const data = await res.json() as Array<{ symbol: string; quoteVolume: string }>;
    const result: Record<string, number> = {};
    for (const item of data) {
      if (item.symbol.endsWith("USDT")) {
        result[item.symbol.replace("USDT", "")] = parseFloat(item.quoteVolume) || 0;
      }
    }
    volumes24hCache = { data: result, timestamp: now };
    return result;
  } catch {
    return {};
  }
}

export async function fetchMarketCaps(): Promise<Record<string, number>> {
  const now = Date.now();
  if (marketCapsCache && now - marketCapsCache.timestamp < 10 * 60 * 1000) {
    return marketCapsCache.data;
  }

  try {
    const res = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1");
    if (!res.ok) throw new Error(`Market cap fetch failed (${res.status})`);
    const data = await res.json() as Array<{ symbol: string; market_cap: number | null }>;
    const result: Record<string, number> = {};
    for (const item of data) {
      if (item.symbol && item.market_cap) {
        result[item.symbol.toUpperCase()] = item.market_cap;
      }
    }
    marketCapsCache = { data: result, timestamp: now };
    return result;
  } catch {
    return {};
  }
}
