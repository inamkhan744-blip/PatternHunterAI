import type { Candle, SRLevel } from "../types";

export interface BollingerBands {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
}

export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      result.push(sum / period);
    }
  }
  return result;
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      result.push(prev);
    } else {
      prev = values[i] * k + (prev as number) * (1 - k);
      result.push(prev);
    }
  }
  return result;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(null);
      continue;
    }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      gains += gain;
      losses += loss;
      if (i === period) {
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      } else {
        result.push(null);
      }
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      const rs = losses === 0 ? 100 : gains / losses;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

export function findSupportResistance(candles: Candle[], lookback = 100): SRLevel[] {
  const recent = candles.slice(-lookback);
  if (recent.length < 10) return [];

  const levels: { price: number; touches: number; type: "support" | "resistance" }[] = [];
  const tolerance = (Math.max(...recent.map((c) => c.high)) - Math.min(...recent.map((c) => c.low))) * 0.01;

  for (let i = 2; i < recent.length - 2; i++) {
    const isPeak = recent[i].high >= recent[i - 1].high && recent[i].high >= recent[i + 1].high;
    const isTrough = recent[i].low <= recent[i - 1].low && recent[i].low <= recent[i + 1].low;

    if (isPeak) {
      const existing = levels.find((l) => l.type === "resistance" && Math.abs(l.price - recent[i].high) < tolerance);
      if (existing) {
        existing.touches++;
        existing.price = (existing.price + recent[i].high) / 2;
      } else {
        levels.push({ price: recent[i].high, touches: 1, type: "resistance" });
      }
    }
    if (isTrough) {
      const existing = levels.find((l) => l.type === "support" && Math.abs(l.price - recent[i].low) < tolerance);
      if (existing) {
        existing.touches++;
        existing.price = (existing.price + recent[i].low) / 2;
      } else {
        levels.push({ price: recent[i].low, touches: 1, type: "support" });
      }
    }
  }

  return levels
    .filter((l) => l.touches >= 2)
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 6);
}

export function calculateConfidence(
  patternType: string,
  candles: Candle[],
  points: { time: number; price: number }[]
): number {
  let score = 50;
  const closes = candles.map((c) => c.close);
  const recent = closes.slice(-20);

  const vol = recent.length > 1 ? Math.sqrt(recent.reduce((acc, v, i) => i > 0 ? acc + Math.pow(v - recent[i - 1], 2) : acc, 0) / recent.length) : 0;
  const avgPrice = recent.reduce((a, b) => a + b, 0) / recent.length;
  const volatility = avgPrice > 0 ? vol / avgPrice : 0;

  if (volatility < 0.01) score += 12;
  else if (volatility < 0.02) score += 6;
  else if (volatility > 0.04) score -= 10;

  const uniquePrices = new Set(points.map((p) => p.price.toFixed(4)));
  score += Math.min(uniquePrices.size * 3, 12);

  const strongPatterns = ["head_and_shoulders", "inverse_head_and_shoulders", "cup_and_handle", "double_top", "double_bottom"];
  if (strongPatterns.includes(patternType)) score += 8;

  return Math.max(30, Math.min(95, Math.round(score)));
}

export function bollingerBands(closes: number[], period = 20, stdDev = 2): BollingerBands {
  const middle = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || middle[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    const mid = middle[i] as number;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(closes[j] - mid, 2);
    }
    const sd = Math.sqrt(sumSq / period);
    upper.push(mid + stdDev * sd);
    lower.push(mid - stdDev * sd);
  }

  return { upper, middle, lower };
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macdLine.push((fastEma[i] as number) - (slowEma[i] as number));
    } else {
      macdLine.push(null);
    }
  }

  const validMacd = macdLine.map((v) => (v === null ? 0 : v));
  const signalEma = ema(validMacd, signalPeriod);
  const signal: (number | null)[] = [];
  const histogram: (number | null)[] = [];

  let firstValidIdx = -1;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      firstValidIdx = i;
      break;
    }
  }

  for (let i = 0; i < closes.length; i++) {
    if (i < firstValidIdx + signalPeriod - 1 || macdLine[i] === null) {
      signal.push(null);
      histogram.push(null);
    } else {
      signal.push(signalEma[i]);
      histogram.push((macdLine[i] as number) - (signalEma[i] as number));
    }
  }

  return { macd: macdLine, signal, histogram };
}

export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): StochasticResult {
  const k: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      k.push(null);
      continue;
    }
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highestHigh) highestHigh = candles[j].high;
      if (candles[j].low < lowestLow) lowestLow = candles[j].low;
    }
    const range = highestHigh - lowestLow;
    const val = range === 0 ? 50 : ((candles[i].close - lowestLow) / range) * 100;
    k.push(val);
  }

  const d: (number | null)[] = [];
  for (let i = 0; i < k.length; i++) {
    if (i < dPeriod - 1 || k[i] === null) {
      d.push(null);
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      if (k[j] !== null) {
        sum += k[j] as number;
        count++;
      }
    }
    d.push(count > 0 ? sum / count : null);
  }

  return { k, d };
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
      continue;
    }
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      prev = sum / period;
      result.push(prev);
    } else {
      prev = ((prev as number) * (period - 1) + tr[i]) / period;
      result.push(prev);
    }
  }
  return result;
}

export function fibonacciRetracement(candles: Candle[]): { level: number; ratio: number; type: "support" | "resistance" | "midpoint" }[] {
  if (candles.length < 20) return [];
  const recent = candles.slice(-100);
  let highest = -Infinity;
  let lowest = Infinity;
  for (const c of recent) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }
  if (highest === lowest) return [];
  const diff = highest - lowest;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const direction = recent[recent.length - 1].close >= recent[0].close ? "up" : "down";

  return ratios.map((r) => {
    const level = direction === "up" ? lowest + diff * r : highest - diff * r;
    let type: "support" | "resistance" | "midpoint" = "midpoint";
    if (r === 0 || r === 0.236) type = direction === "up" ? "support" : "resistance";
    else if (r === 1 || r === 0.786) type = direction === "up" ? "resistance" : "support";
    return { level, ratio: r, type };
  });
}

export function detectDivergence(candles: Candle[], rsiValues: (number | null)[]): "bullish" | "bearish" | null {
  if (candles.length < 30) return null;
  const lookback = 30;
  const recentCandles = candles.slice(-lookback);
  const recentRsi = rsiValues.slice(-lookback);

  let priceLowIdx = 0;
  let rsiLowIdx = 0;
  let priceHighIdx = 0;
  let rsiHighIdx = 0;

  for (let i = 1; i < recentCandles.length; i++) {
    if (recentCandles[i].low < recentCandles[priceLowIdx].low) priceLowIdx = i;
    if (recentCandles[i].high > recentCandles[priceHighIdx].high) priceHighIdx = i;
  }

  for (let i = 1; i < recentRsi.length; i++) {
    if (recentRsi[i] === null) continue;
    if (recentRsi[i]! < (recentRsi[rsiLowIdx] ?? Infinity)) rsiLowIdx = i;
    if (recentRsi[i]! > (recentRsi[rsiHighIdx] ?? -Infinity)) rsiHighIdx = i;
  }

  const lastIdx = recentCandles.length - 1;
  const lastRsi = recentRsi[lastIdx];
  if (lastRsi === null) return null;

  const prevLow = recentCandles[priceLowIdx].low;
  const lastLow = recentCandles[lastIdx].low;
  const prevRsiLow = recentRsi[rsiLowIdx];
  if (prevRsiLow !== null && lastLow < prevLow && lastRsi > prevRsiLow) {
    return "bullish";
  }

  const prevHigh = recentCandles[priceHighIdx].high;
  const lastHigh = recentCandles[lastIdx].high;
  const prevRsiHigh = recentRsi[rsiHighIdx];
  if (prevRsiHigh !== null && lastHigh > prevHigh && lastRsi < prevRsiHigh) {
    return "bearish";
  }

  return null;
}
