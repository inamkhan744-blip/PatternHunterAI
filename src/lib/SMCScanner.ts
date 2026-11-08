import type { Candle } from "../types";
import { ema } from "./indicators";
import { fetchCandles } from "./binance";

export interface OrderBlock {
  id: string;
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startTime: number;
  endTime: number;
  mitigated: boolean;
}

export interface FairValueGap {
  id: string;
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startTime: number;
  endTime: number;
  mitigated: boolean;
}

export interface SMCData {
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
}

export type HTFTrend = "Bullish" | "Bearish" | "Neutral";

export interface HTFTrendResult {
  trend: HTFTrend;
  ema1h: number | null;
  ema4h: number | null;
  price1h: number | null;
  price4h: number | null;
}

/**
 * Detect Order Blocks (OB):
 * - Bullish OB: The last down candle (close < open) before a strong impulsive up move.
 * - Bearish OB: The last up candle (close > open) before a strong impulsive down move.
 */
export function detectOrderBlocks(candles: Candle[], maxBlocks = 8): OrderBlock[] {
  if (candles.length < 5) return [];

  const orderBlocks: OrderBlock[] = [];
  const lastTime = candles[candles.length - 1].time;

  // Compute average candle body size for impulse comparison
  let totalBody = 0;
  for (const c of candles) {
    totalBody += Math.abs(c.close - c.open);
  }
  const avgBody = totalBody / candles.length;

  for (let i = 1; i < candles.length - 2; i++) {
    const prevCandle = candles[i];
    const nextCandle = candles[i + 1];
    const nextCandle2 = candles[i + 2];

    const nextBody1 = nextCandle.close - nextCandle.open;
    const nextBody2 = nextCandle2.close - nextCandle2.open;

    // Bullish OB:
    // 1. Current candle is down (close < open)
    // 2. Followed by strong impulsive up move (next candle is strongly green, or 2 consecutive bullish candles break previous candle high)
    const isImpulsiveUp =
      (nextBody1 > 0 && nextBody1 >= avgBody * 1.5 && nextCandle.close > prevCandle.high) ||
      (nextBody1 > 0 && nextBody2 > 0 && (nextCandle2.close > prevCandle.high) && (nextBody1 + nextBody2) >= avgBody * 2);

    if (prevCandle.close < prevCandle.open && isImpulsiveUp) {
      const top = Math.max(prevCandle.open, prevCandle.high);
      const bottom = prevCandle.low;

      // Check if mitigated by future price action
      let mitigated = false;
      let endTime = lastTime;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].low <= bottom) {
          mitigated = true;
          endTime = candles[j].time;
          break;
        }
      }

      orderBlocks.push({
        id: `ob-bullish-${prevCandle.time}`,
        type: "bullish",
        top,
        bottom,
        startTime: prevCandle.time,
        endTime,
        mitigated,
      });
    }

    // Bearish OB:
    // 1. Current candle is up (close > open)
    // 2. Followed by strong impulsive down move (next candle is strongly red, or 2 consecutive bearish candles break previous candle low)
    const isImpulsiveDown =
      (nextBody1 < 0 && Math.abs(nextBody1) >= avgBody * 1.5 && nextCandle.close < prevCandle.low) ||
      (nextBody1 < 0 && nextBody2 < 0 && (nextCandle2.close < prevCandle.low) && Math.abs(nextBody1 + nextBody2) >= avgBody * 2);

    if (prevCandle.close > prevCandle.open && isImpulsiveDown) {
      const top = prevCandle.high;
      const bottom = Math.min(prevCandle.open, prevCandle.low);

      // Check if mitigated by future price action
      let mitigated = false;
      let endTime = lastTime;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].high >= top) {
          mitigated = true;
          endTime = candles[j].time;
          break;
        }
      }

      orderBlocks.push({
        id: `ob-bearish-${prevCandle.time}`,
        type: "bearish",
        top,
        bottom,
        startTime: prevCandle.time,
        endTime,
        mitigated,
      });
    }
  }

  // Return the most recent unmitigated ones first, then mitigated, limited to maxBlocks
  const unmitigated = orderBlocks.filter((b) => !b.mitigated);
  const mitigated = orderBlocks.filter((b) => b.mitigated);

  return [...unmitigated.slice(-maxBlocks), ...mitigated.slice(-2)].slice(-maxBlocks);
}

/**
 * Detect Fair Value Gaps (FVG):
 * - Bullish FVG: Gap between candle 1's high and candle 3's low (candle 3 low > candle 1 high).
 * - Bearish FVG: Gap between candle 1's low and candle 3's high (candle 1 low > candle 3 high).
 */
export function detectFVG(candles: Candle[], maxGaps = 8): FairValueGap[] {
  if (candles.length < 3) return [];

  const fvgs: FairValueGap[] = [];
  const lastTime = candles[candles.length - 1].time;

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bullish FVG: Large up candle (c2) where c1.high < c3.low
    if (c2.close > c2.open && c3.low > c1.high) {
      const top = c3.low;
      const bottom = c1.high;

      // Check mitigation
      let mitigated = false;
      let endTime = lastTime;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low <= bottom) {
          mitigated = true;
          endTime = candles[j].time;
          break;
        }
      }

      fvgs.push({
        id: `fvg-bullish-${c2.time}`,
        type: "bullish",
        top,
        bottom,
        startTime: c2.time,
        endTime,
        mitigated,
      });
    }

    // Bearish FVG: Large down candle (c2) where c1.low > c3.high
    if (c2.close < c2.open && c1.low > c3.high) {
      const top = c1.low;
      const bottom = c3.high;

      // Check mitigation
      let mitigated = false;
      let endTime = lastTime;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high >= top) {
          mitigated = true;
          endTime = candles[j].time;
          break;
        }
      }

      fvgs.push({
        id: `fvg-bearish-${c2.time}`,
        type: "bearish",
        top,
        bottom,
        startTime: c2.time,
        endTime,
        mitigated,
      });
    }
  }

  const unmitigated = fvgs.filter((g) => !g.mitigated);
  const mitigated = fvgs.filter((g) => g.mitigated);

  return [...unmitigated.slice(-maxGaps), ...mitigated.slice(-2)].slice(-maxGaps);
}

/**
 * Scan candle data for all SMC features (Order Blocks and FVGs).
 */
export function scanSMC(candles: Candle[]): SMCData {
  return {
    orderBlocks: detectOrderBlocks(candles),
    fvgs: detectFVG(candles),
  };
}

/**
 * Fetch and calculate 1H and 4H EMA (50) to determine the Higher Timeframe (HTF) trend.
 */
export async function calculateHTFTrend(symbol: string): Promise<HTFTrendResult> {
  try {
    const [candles1h, candles4h] = await Promise.all([
      fetchCandles(symbol, 100, "1h"),
      fetchCandles(symbol, 100, "4h"),
    ]);

    if (!candles1h.length || !candles4h.length) {
      return { trend: "Neutral", ema1h: null, ema4h: null, price1h: null, price4h: null };
    }

    const closes1h = candles1h.map((c) => c.close);
    const closes4h = candles4h.map((c) => c.close);

    const ema50_1h = ema(closes1h, 50);
    const ema50_4h = ema(closes4h, 50);

    const lastEma1h = ema50_1h[ema50_1h.length - 1];
    const lastEma4h = ema50_4h[ema50_4h.length - 1];

    const lastPrice1h = closes1h[closes1h.length - 1];
    const lastPrice4h = closes4h[closes4h.length - 1];

    if (lastEma1h === null || lastEma4h === null) {
      return { trend: "Neutral", ema1h: lastEma1h, ema4h: lastEma4h, price1h: lastPrice1h, price4h: lastPrice4h };
    }

    // Bullish if price is above EMA 50 on both 1H and 4H
    // Bearish if price is below EMA 50 on both 1H and 4H
    const is1hBull = lastPrice1h > lastEma1h;
    const is4hBull = lastPrice4h > lastEma4h;

    let trend: HTFTrend = "Neutral";
    if (is1hBull && is4hBull) {
      trend = "Bullish";
    } else if (!is1hBull && !is4hBull) {
      trend = "Bearish";
    } else {
      // If mixed, 4H has higher weight
      trend = is4hBull ? "Bullish" : "Bearish";
    }

    return {
      trend,
      ema1h: lastEma1h,
      ema4h: lastEma4h,
      price1h: lastPrice1h,
      price4h: lastPrice4h,
    };
  } catch (error) {
    console.error("Error calculating HTF trend:", error);
    return { trend: "Neutral", ema1h: null, ema4h: null, price1h: null, price4h: null };
  }
}
