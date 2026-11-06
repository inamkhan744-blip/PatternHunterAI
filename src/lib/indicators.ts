import type { Candle, SRLevel } from "../types";

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
