/**
 * Range-scalp setup evaluator.
 *
 * The normal confluence engine is trend-following and deliberately refuses
 * low-ADX conditions. Range Scalper Mode uses a separate, mean-reversion setup:
 *
 *   LONG  when price is near the lower Bollinger Band and RSI < 35
 *   SHORT when price is near the upper Bollinger Band and RSI > 65
 *
 * Risk is tighter than a trend trade: 1.0 ATR stop and 1.5 ATR target.
 */

import type { Candle } from "./binance.ts";
import { adxLast, atrSeries, rsiSeries, sma } from "./confluence.ts";

export type RangeDirection = "LONG" | "SHORT";

export interface RangeSetup {
  canExecute: boolean;
  direction: RangeDirection | null;
  score: number;
  price: number;
  atr: number;
  adx: number | null;
  rsi: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  stopMultiplier: number;
  takeProfitMultiplier: number;
  reason: string;
}

export interface RangeOptions {
  /** RSI must be below this level for a long scalp. */
  lowerRsi?: number;
  /** RSI must be above this level for a short scalp. */
  upperRsi?: number;
  /** How close to the band counts as "near", as a fraction of ATR. */
  bandToleranceAtr?: number;
}

const MIN_CANDLES = 30;

function emptySetup(reason: string, price = 0, atr = 0): RangeSetup {
  return {
    canExecute: false,
    direction: null,
    score: 0,
    price,
    atr,
    adx: null,
    rsi: null,
    bbUpper: null,
    bbMiddle: null,
    bbLower: null,
    stopMultiplier: 1,
    takeProfitMultiplier: 1.5,
    reason,
  };
}

/** Bollinger Bands (20, 2) on the last closed candle. */
function bollinger(
  closes: number[],
  period = 20,
  stdDev = 2
): { upper: number; middle: number; lower: number; width: number } | null {
  if (closes.length < period) return null;
  const middle = sma(closes, period);
  if (middle === null) return null;

  const window = closes.slice(-period);
  const variance = window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  return { upper, middle, lower, width: upper - lower };
}

export function evaluateRangeSetup(
  candles: Candle[],
  options: RangeOptions = {}
): RangeSetup {
  if (candles.length < MIN_CANDLES) {
    return emptySetup("Insufficient candle history for range setup.");
  }

  const current = candles.at(-1)!;
  const price = current.close;
  const closes = candles.map((c) => c.close);
  const atr = atrSeries(candles, 14) ?? 0;
  const adx = adxLast(candles, 14);
  const rsi = rsiSeries(closes, 14).at(-1) ?? null;
  const bands = bollinger(closes, 20, 2);

  if (!(atr > 0) || rsi === null || !bands) {
    return {
      ...emptySetup("Range indicators unavailable.", price, atr),
      adx,
      rsi,
      bbUpper: bands?.upper ?? null,
      bbMiddle: bands?.middle ?? null,
      bbLower: bands?.lower ?? null,
    };
  }

  const lowerRsi = options.lowerRsi ?? 35;
  const upperRsi = options.upperRsi ?? 65;
  const tolerance = Math.max(atr * (options.bandToleranceAtr ?? 0.25), bands.width * 0.1);

  let direction: RangeDirection | null = null;
  let reason = "";
  if (price <= bands.lower + tolerance && rsi < lowerRsi) {
    direction = "LONG";
    reason = `Price near lower Bollinger Band with RSI ${rsi.toFixed(1)} < ${lowerRsi}.`;
  } else if (price >= bands.upper - tolerance && rsi > upperRsi) {
    direction = "SHORT";
    reason = `Price near upper Bollinger Band with RSI ${rsi.toFixed(1)} > ${upperRsi}.`;
  } else {
    reason = "Price is not at a range extreme.";
  }

  if (!direction) {
    return {
      canExecute: false,
      direction: null,
      score: 0,
      price,
      atr,
      adx,
      rsi,
      bbUpper: bands.upper,
      bbMiddle: bands.middle,
      bbLower: bands.lower,
      stopMultiplier: 1,
      takeProfitMultiplier: 1.5,
      reason,
    };
  }

  // Confidence is intentionally separate from the trend confluence score.
  // A deeper RSI extreme and a tighter band touch produce a higher score.
  const rsiExtreme = direction === "LONG" ? lowerRsi - rsi : rsi - upperRsi;
  const bandDistance = direction === "LONG" ? price - bands.lower : bands.upper - price;
  const bandBonus = Math.max(0, 1 - Math.abs(bandDistance) / Math.max(tolerance, 0.000001)) * 10;
  const score = Math.round(Math.min(100, Math.max(60, 70 + rsiExtreme * 1.5 + bandBonus)));

  const target = bands.middle;
  return {
    canExecute: true,
    direction,
    score,
    price,
    atr,
    adx,
    rsi,
    bbUpper: bands.upper,
    bbMiddle: bands.middle,
    bbLower: bands.lower,
    stopMultiplier: 1,
    takeProfitMultiplier: 1.5,
    reason: `${reason} Target middle band ${target.toFixed(2)}; stop 1.0 ATR, target 1.5 ATR.`,
  };
}
