/**
 * Server-side port of the Confluence engine.
 *
 * The browser build imports `src/lib/ConfluenceEngine.ts`, which cannot be
 * bundled into an edge function (it lives outside the function directory). This
 * module mirrors the same scoring so server and client agree on what a
 * high-quality setup is:
 *
 *   HTF trend alignment  25
 *   SMC zone reaction    25
 *   RSI confluence       15
 *   MACD momentum        15
 *   Volume confirmation  10
 *   ADX trend strength   10
 *   ------------------------
 *   Total               100   (executable at >= 85, exactly like the client)
 */

import type { Candle } from "./binance.ts";

export type ServerBias = "Strong Buy" | "Strong Sell" | "Neutral";

export interface ConfluenceScore {
  score: number;
  canExecute: boolean;
  bias: ServerBias;
  price: number;
  atr: number;
  rsi: number | null;
  adx: number | null;
  volumeRatio: number | null;
  reasons: string[];
}

export interface ConfluenceOptions {
  minScore?: number;
  /** Tolerance for "price is inside the zone", as a fraction of price. */
  zoneTolerance?: number;
}

const MIN_CANDLES = 60;

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macdHistogram(values: number[]): number[] {
  if (values.length < 35) return [];
  const fast = 12;
  const slow = 26;
  const signalPeriod = 9;
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  const kSignal = 2 / (signalPeriod + 1);

  let emaFast = values[0];
  let emaSlow = values[0];
  const macdLine: number[] = [];
  for (let i = 1; i < values.length; i++) {
    emaFast = values[i] * kFast + emaFast * (1 - kFast);
    emaSlow = values[i] * kSlow + emaSlow * (1 - kSlow);
    macdLine.push(emaFast - emaSlow);
  }
  if (macdLine.length < signalPeriod) return [];
  let signal = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  const histogram: number[] = [];
  for (let i = signalPeriod; i < macdLine.length; i++) {
    signal = macdLine[i] * kSignal + signal * (1 - kSignal);
    histogram.push(macdLine[i] - signal);
  }
  return histogram;
}

function atrSeries(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr || null;
}

function adxLast(candles: Candle[], period = 14): number | null {
  if (candles.length < period * 2) return null;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }

  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dx = (p: number, m: number, t: number): number => {
    if (t === 0) return 0;
    const plusDI = (p / t) * 100;
    const minusDI = (m / t) * 100;
    const sum = plusDI + minusDI;
    return sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  };

  let adx = dx(smoothPlus, smoothMinus, smoothTR);
  for (let i = period; i < tr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDM[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDM[i];
    adx = (adx * (period - 1) + dx(smoothPlus, smoothMinus, smoothTR)) / period;
  }
  return Number.isFinite(adx) ? adx : null;
}

/** Nearest swing-based supply/demand zone or unfilled gap around price. */
function smcZone(candles: Candle[], price: number, toleranceRatio: number): string | null {
  const tolerance = price * toleranceRatio;

  // Fair value gaps over the recent window.
  for (let i = candles.length - 3; i >= Math.max(candles.length - 40, 1); i--) {
    const prev = candles[i - 1];
    const curr = candles[i + 1];
    if (curr.low > prev.high) {
      const low = prev.high;
      const high = curr.low;
      if (price >= low - tolerance && price <= high + tolerance) {
        return `Bullish Fair Value Gap ($${low.toFixed(2)} - $${high.toFixed(2)})`;
      }
    }
    if (curr.high < prev.low) {
      const low = curr.high;
      const high = prev.low;
      if (price >= low - tolerance && price <= high + tolerance) {
        return `Bearish Fair Value Gap ($${low.toFixed(2)} - $${high.toFixed(2)})`;
      }
    }
  }

  // Last swing high/low becomes the working order block.
  const window = candles.slice(-40);
  let swingHigh = window[0];
  let swingLow = window[0];
  for (const c of window) {
    if (c.high > swingHigh.high) swingHigh = c;
    if (c.low < swingLow.low) swingLow = c;
  }
  const blockHigh = Math.max(swingHigh.open, swingHigh.close);
  const blockLow = Math.min(swingHigh.open, swingHigh.close);
  if (price >= blockLow - tolerance && price <= blockHigh + tolerance) {
    return `Bearish Order Block ($${blockLow.toFixed(2)} - $${blockHigh.toFixed(2)})`;
  }
  const demandHigh = Math.max(swingLow.open, swingLow.close);
  const demandLow = Math.min(swingLow.open, swingLow.close);
  if (price >= demandLow - tolerance && price <= demandHigh + tolerance) {
    return `Bullish Order Block ($${demandLow.toFixed(2)} - $${demandHigh.toFixed(2)})`;
  }
  return null;
}

/** EMA(50) agreement across 1H and 4H decides the higher-timeframe bias. */
function htfBias(htf1h: Candle[], htf4h: Candle[], fallbackPrice: number): "Bullish" | "Bearish" | "Neutral" {
  const closes1h = htf1h.map((c) => c.close);
  const closes4h = htf4h.map((c) => c.close);
  const ema1h = emaLast(closes1h, 50);
  const ema4h = emaLast(closes4h, 50);
  const last1h = closes1h.at(-1) ?? fallbackPrice;
  const last4h = closes4h.at(-1) ?? fallbackPrice;

  if (ema1h === null || ema4h === null) {
    const avg = sma(closes1h, Math.min(closes1h.length, 20));
    if (avg === null) return "Neutral";
    return fallbackPrice >= avg ? "Bullish" : "Bearish";
  }
  if (last1h > ema1h && last4h > ema4h) return "Bullish";
  if (last1h < ema1h && last4h < ema4h) return "Bearish";
  return "Neutral";
}

/**
 * Scores the last *closed* candle of `candles`.
 * Returns `canExecute: false` when there is not enough history.
 */
export function evaluateServerConfluence(
  candles: Candle[],
  htf1h: Candle[],
  htf4h: Candle[],
  options: ConfluenceOptions = {}
): ConfluenceScore {
  const minScore = options.minScore ?? 85;
  const empty: ConfluenceScore = {
    score: 0,
    canExecute: false,
    bias: "Neutral",
    price: 0,
    atr: 0,
    rsi: null,
    adx: null,
    volumeRatio: null,
    reasons: ["Insufficient candle history"],
  };
  if (candles.length < MIN_CANDLES) return empty;

  const current = candles.at(-1)!;
  const price = current.close;
  const closes = candles.map((c) => c.close);
  const reasons: string[] = [];
  let score = 0;

  const trend = htfBias(htf1h, htf4h, price);
  if (trend !== "Neutral") {
    score += 25;
    reasons.push(`HTF EMA(50) alignment: ${trend}`);
  }

  const zone = smcZone(candles, price, options.zoneTolerance ?? 0.0015);
  if (zone) {
    score += 25;
    reasons.push(`Price reacting at ${zone}`);
  }

  const rsiValue = rsiSeries(closes, 14).at(-1) ?? null;
  if (rsiValue !== null) {
    const inSweetSpot = rsiValue >= 40 && rsiValue <= 60;
    const oversoldLong = rsiValue <= 30 && trend === "Bullish";
    const overboughtShort = rsiValue >= 70 && trend === "Bearish";
    if (inSweetSpot || oversoldLong || overboughtShort) {
      score += 15;
      reasons.push(`RSI ${rsiValue.toFixed(1)} supports the setup`);
    }
  }

  const histogram = macdHistogram(closes);
  if (histogram.length >= 2) {
    const last = histogram.at(-1)!;
    const prev = histogram.at(-2)!;
    if (trend === "Bullish" && last > 0 && last >= prev) {
      score += 15;
      reasons.push("Bullish MACD histogram expansion");
    } else if (trend === "Bearish" && last < 0 && last <= prev) {
      score += 15;
      reasons.push("Bearish MACD histogram expansion");
    }
  }

  const avgVolume = sma(
    candles.slice(-20).map((c) => c.volume),
    20
  );
  const volumeRatio = avgVolume && avgVolume > 0 ? current.volume / avgVolume : null;
  if (avgVolume !== null && current.volume > avgVolume) {
    score += 10;
    reasons.push(`Volume ${((volumeRatio ?? 1) * 100).toFixed(0)}% of its 20-period average`);
  }

  const adx = adxLast(candles, 14);
  if (adx !== null && adx > 20) {
    score += 10;
    reasons.push(`ADX ${adx.toFixed(1)} confirms trend strength`);
  }

  const atr = atrSeries(candles, 14) ?? 0;

  let bias: ServerBias = "Neutral";
  if (score >= minScore && trend === "Bullish") bias = "Strong Buy";
  else if (score >= minScore && trend === "Bearish") bias = "Strong Sell";

  return {
    score,
    canExecute: score >= minScore && bias !== "Neutral" && atr > 0,
    bias,
    price,
    atr,
    rsi: rsiValue,
    adx,
    volumeRatio,
    reasons,
  };
}
