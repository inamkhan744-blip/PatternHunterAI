import type { Candle, DetectedPattern, PatternType, PatternWithConfidence } from "../types";
import { calculateConfidence } from "./indicators";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simpleMA(candles: Candle[], period: number, endIndex: number): number | null {
  if (endIndex + 1 < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    sum += candles[i].close;
  }
  return sum / period;
}

function findLocalExtrema(candles: Candle[], window = 3): { peaks: number[]; troughs: number[] } {
  const peaks: number[] = [];
  const troughs: number[] = [];
  for (let i = window; i < candles.length - window; i++) {
    let isPeak = true;
    let isTrough = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isPeak = false;
      if (candles[j].low <= candles[i].low) isTrough = false;
    }
    if (isPeak) peaks.push(i);
    if (isTrough) troughs.push(i);
  }
  return { peaks, troughs };
}

/** Linear regression slope of a set of (index, value) points. */
function linearSlope(indices: number[], values: number[]): number {
  const n = indices.length;
  if (n < 2) return 0;
  const sumX = indices.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = indices.reduce((acc, x, i) => acc + x * values[i], 0);
  const sumX2 = indices.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function pct(a: number, b: number): number {
  return Math.abs(a - b) / a;
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ---------------------------------------------------------------------------
// 1. Double Top  (bearish)
// ---------------------------------------------------------------------------

function detectDoubleTop(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { peaks } = findLocalExtrema(recent);
  if (peaks.length < 2) return null;

  for (let i = peaks.length - 1; i >= 1; i--) {
    const p1 = peaks[i - 1];
    const p2 = peaks[i];
    const price1 = recent[p1].high;
    const price2 = recent[p2].high;
    if (pct(price1, price2) <= 0.01) {
      const midIdx = Math.round((p1 + p2) / 2);
      return {
        type: "double_top",
        name: "Double Top",
        description: `Two peaks near $${price1.toFixed(2)} with a valley at $${recent[midIdx].low.toFixed(2)}`,
        points: [
          { time: recent[p1].time, price: price1 },
          { time: recent[midIdx].time, price: recent[midIdx].low },
          { time: recent[p2].time, price: price2 },
        ],
        direction: "bearish",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Double Bottom  (bullish)
// ---------------------------------------------------------------------------

function detectDoubleBottom(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { troughs } = findLocalExtrema(recent);
  if (troughs.length < 2) return null;

  for (let i = troughs.length - 1; i >= 1; i--) {
    const t1 = troughs[i - 1];
    const t2 = troughs[i];
    const price1 = recent[t1].low;
    const price2 = recent[t2].low;
    if (pct(price1, price2) <= 0.01) {
      const midIdx = Math.round((t1 + t2) / 2);
      return {
        type: "double_bottom",
        name: "Double Bottom",
        description: `Two troughs near $${price1.toFixed(2)} with a peak at $${recent[midIdx].high.toFixed(2)}`,
        points: [
          { time: recent[t1].time, price: price1 },
          { time: recent[midIdx].time, price: recent[midIdx].high },
          { time: recent[t2].time, price: price2 },
        ],
        direction: "bullish",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Moving Average Crossover  (bull / bear)
// ---------------------------------------------------------------------------

function detectMACross(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-50);
  const shortPeriod = 7;
  const longPeriod = 21;
  if (recent.length < longPeriod + 2) return null;

  const endIdx = recent.length - 1;
  const shortMA = simpleMA(recent, shortPeriod, endIdx);
  const longMA = simpleMA(recent, longPeriod, endIdx);
  const prevShortMA = simpleMA(recent, shortPeriod, endIdx - 1);
  const prevLongMA = simpleMA(recent, longPeriod, endIdx - 1);
  if (!shortMA || !longMA || !prevShortMA || !prevLongMA) return null;

  const last = recent[endIdx];
  if (prevShortMA <= prevLongMA && shortMA > longMA) {
    return {
      type: "ma_crossover_bull",
      name: "Golden Cross (MA7 > MA21)",
      description: `MA7 crossed above MA21 near $${last.close.toFixed(2)}`,
      points: [
        { time: recent[endIdx - 1].time, price: prevShortMA },
        { time: last.time, price: shortMA },
      ],
      direction: "bullish",
    };
  }
  if (prevShortMA >= prevLongMA && shortMA < longMA) {
    return {
      type: "ma_crossover_bear",
      name: "Death Cross (MA7 < MA21)",
      description: `MA7 crossed below MA21 near $${last.close.toFixed(2)}`,
      points: [
        { time: recent[endIdx - 1].time, price: prevShortMA },
        { time: last.time, price: shortMA },
      ],
      direction: "bearish",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Head and Shoulders  (bearish)
// ---------------------------------------------------------------------------

function detectHeadAndShoulders(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-60);
  const { peaks } = findLocalExtrema(recent);
  if (peaks.length < 3) return null;

  for (let i = peaks.length - 1; i >= 2; i--) {
    const ls = peaks[i - 2];
    const head = peaks[i - 1];
    const rs = peaks[i];
    if (head === ls || head === rs) continue;

    const lsP = recent[ls].high;
    const hP = recent[head].high;
    const rsP = recent[rs].high;

    const shouldersClose = pct(lsP, rsP) <= 0.02;
    const headHigher = hP > lsP * 1.01 && hP > rsP * 1.01;

    if (shouldersClose && headHigher) {
      const necklineLeft = recent[Math.round((ls + head) / 2)].low;
      const necklineRight = recent[Math.round((head + rs) / 2)].low;
      return {
        type: "head_and_shoulders",
        name: "Head and Shoulders",
        description: `Head at $${hP.toFixed(2)} flanked by shoulders at $${lsP.toFixed(2)} and $${rsP.toFixed(2)}, neckline near $${avg([necklineLeft, necklineRight]).toFixed(2)}`,
        points: [
          { time: recent[ls].time, price: lsP },
          { time: recent[head].time, price: hP },
          { time: recent[rs].time, price: rsP },
          { time: recent[Math.round((head + rs) / 2)].time, price: necklineRight },
        ],
        lines: [
          {
            points: [
              { time: recent[Math.round((ls + head) / 2)].time, price: necklineLeft },
              { time: recent[Math.round((head + rs) / 2)].time, price: necklineRight },
            ],
            color: "#ef4444",
          },
        ],
        direction: "bearish",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Inverse Head and Shoulders  (bullish)
// ---------------------------------------------------------------------------

function detectInverseHeadAndShoulders(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-60);
  const { troughs } = findLocalExtrema(recent);
  if (troughs.length < 3) return null;

  for (let i = troughs.length - 1; i >= 2; i--) {
    const ls = troughs[i - 2];
    const head = troughs[i - 1];
    const rs = troughs[i];
    if (head === ls || head === rs) continue;

    const lsP = recent[ls].low;
    const hP = recent[head].low;
    const rsP = recent[rs].low;

    const shouldersClose = pct(lsP, rsP) <= 0.02;
    const headLower = hP < lsP * 0.99 && hP < rsP * 0.99;

    if (shouldersClose && headLower) {
      const necklineLeft = recent[Math.round((ls + head) / 2)].high;
      const necklineRight = recent[Math.round((head + rs) / 2)].high;
      return {
        type: "inverse_head_and_shoulders",
        name: "Inverse Head and Shoulders",
        description: `Inverse head at $${hP.toFixed(2)} flanked by shoulders at $${lsP.toFixed(2)} and $${rsP.toFixed(2)}, neckline near $${avg([necklineLeft, necklineRight]).toFixed(2)}`,
        points: [
          { time: recent[ls].time, price: lsP },
          { time: recent[head].time, price: hP },
          { time: recent[rs].time, price: rsP },
          { time: recent[Math.round((head + rs) / 2)].time, price: necklineRight },
        ],
        lines: [
          {
            points: [
              { time: recent[Math.round((ls + head) / 2)].time, price: necklineLeft },
              { time: recent[Math.round((head + rs) / 2)].time, price: necklineRight },
            ],
            color: "#22c55e",
          },
        ],
        direction: "bullish",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Bull Flag  (bullish)  &  7. Bear Flag  (bearish)
// ---------------------------------------------------------------------------

function detectFlag(candles: Candle[], bullish: boolean): DetectedPattern | null {
  const recent = candles.slice(-50);
  if (recent.length < 20) return null;
  const poleEnd = Math.floor(recent.length * 0.4);
  const pole = recent.slice(0, poleEnd);
  const flag = recent.slice(poleEnd);

  const poleStart = bullish ? pole[0].close : pole[0].close;
  const poleEndPrice = bullish ? pole[pole.length - 1].close : pole[pole.length - 1].close;
  const poleMove = bullish ? poleEndPrice - poleStart : poleStart - poleEndPrice;
  const polePct = poleMove / poleStart;

  if (polePct < 0.03) return null;

  const flagHighs = flag.map((c) => c.high);
  const flagLows = flag.map((c) => c.low);
  const flagRange = avg(flagHighs) - avg(flagLows);
  const flagAvgPct = flagRange / poleEndPrice;

  if (flagAvgPct > 0.03) return null;

  const flagSlope = linearSlope(
    flag.map((_, i) => i),
    flag.map((c) => (bullish ? c.close : c.close))
  );

  if (bullish && flagSlope < -0.0001) {
    return {
      type: "bull_flag",
      name: "Bull Flag",
      description: `Strong uptrend of ${(polePct * 100).toFixed(1)}% followed by a downward-sloping consolidation`,
      points: [
        { time: pole[0].time, price: poleStart },
        { time: pole[pole.length - 1].time, price: poleEndPrice },
        { time: flag[0].time, price: flag[0].high },
        { time: flag[flag.length - 1].time, price: flag[flag.length - 1].low },
      ],
      lines: [
        {
          points: [
            { time: flag[0].time, price: flag[0].high },
            { time: flag[flag.length - 1].time, price: flag[flag.length - 1].high },
          ],
          color: "#22c55e",
        },
        {
          points: [
            { time: flag[0].time, price: flag[0].low },
            { time: flag[flag.length - 1].time, price: flag[flag.length - 1].low },
          ],
          color: "#22c55e",
        },
      ],
      direction: "bullish",
    };
  }

  if (!bullish && flagSlope > 0.0001) {
    return {
      type: "bear_flag",
      name: "Bear Flag",
      description: `Strong downtrend of ${(polePct * 100).toFixed(1)}% followed by an upward-sloping consolidation`,
      points: [
        { time: pole[0].time, price: poleStart },
        { time: pole[pole.length - 1].time, price: poleEndPrice },
        { time: flag[0].time, price: flag[0].low },
        { time: flag[flag.length - 1].time, price: flag[flag.length - 1].high },
      ],
      lines: [
        {
          points: [
            { time: flag[0].time, price: flag[0].high },
            { time: flag[flag.length - 1].time, price: flag[flag.length - 1].high },
          ],
          color: "#ef4444",
        },
        {
          points: [
            { time: flag[0].time, price: flag[0].low },
            { time: flag[flag.length - 1].time, price: flag[flag.length - 1].low },
          ],
          color: "#ef4444",
        },
      ],
      direction: "bearish",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 8. Ascending Triangle  (bullish)  &  9. Descending Triangle  (bearish)
// ---------------------------------------------------------------------------

function detectTriangle(candles: Candle[], ascending: boolean): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { peaks, troughs } = findLocalExtrema(recent);
  const minPoints = ascending ? troughs.length : peaks.length;
  const flatSeries = ascending ? peaks : troughs;
  const slopeSeries = ascending ? troughs : peaks;

  if (minPoints < 3 || flatSeries.length < 2) return null;

  const flatPrices = flatSeries.map((i) => (ascending ? recent[i].high : recent[i].low));
  const flatAvg = avg(flatPrices);
  const flatSpread = Math.max(...flatPrices) - Math.min(...flatPrices);
  if (flatSpread / flatAvg > 0.015) return null;

  const slopeIdxs = slopeSeries.map((i) => i);
  const slopeVals = slopeSeries.map((i) => (ascending ? recent[i].low : recent[i].high));
  const slope = linearSlope(slopeIdxs, slopeVals);

  if (ascending && slope <= 0.0001) return null;
  if (!ascending && slope >= -0.0001) return null;

  const color = ascending ? "#22c55e" : "#ef4444";
  const flatLinePoints = flatSeries.slice(0, 2).map((i) => ({
    time: recent[i].time,
    price: ascending ? recent[i].high : recent[i].low,
  }));
  const slopeLinePoints = slopeSeries.slice(-2).map((i) => ({
    time: recent[i].time,
    price: ascending ? recent[i].low : recent[i].high,
  }));

  return {
    type: ascending ? "ascending_triangle" : "descending_triangle",
    name: ascending ? "Ascending Triangle" : "Descending Triangle",
    description: `Flat ${ascending ? "resistance" : "support"} near $${flatAvg.toFixed(2)} with ${ascending ? "rising" : "falling"} ${ascending ? "support" : "resistance"} trendline`,
    points: [...flatLinePoints, ...slopeLinePoints],
    lines: [
      { points: flatLinePoints, color },
      { points: slopeLinePoints, color },
    ],
    direction: ascending ? "bullish" : "bearish",
  };
}

// ---------------------------------------------------------------------------
// 10. Cup and Handle  (bullish)
// ---------------------------------------------------------------------------

function detectCupAndHandle(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-60);
  if (recent.length < 30) return null;

  const cupEnd = Math.floor(recent.length * 0.7);
  const cup = recent.slice(0, cupEnd);
  const handle = recent.slice(cupEnd);
  if (handle.length < 5) return null;

  const cupStartP = cup[0].high;
  let cupLowIdx = 0;
  let cupLow = cup[0].low;
  for (let i = 1; i < cup.length; i++) {
    if (cup[i].low < cupLow) {
      cupLow = cup[i].low;
      cupLowIdx = i;
    }
  }
  const cupEndP = cup[cup.length - 1].high;
  const rimSpread = pct(cupStartP, cupEndP);
  const cupDepth = (cupStartP - cupLow) / cupStartP;

  if (rimSpread > 0.03 || cupDepth < 0.03 || cupDepth > 0.25) return null;
  if (cupLowIdx < 3 || cupLowIdx > cup.length - 3) return null;

  const handleStartP = handle[0].close;
  const handleEndP = handle[handle.length - 1].close;
  const handleDrift = (handleEndP - handleStartP) / handleStartP;
  if (handleDrift > 0.02 || handleDrift < -0.06) return null;

  return {
    type: "cup_and_handle",
    name: "Cup and Handle",
    description: `Rounded bottom from $${cupStartP.toFixed(2)} to $${cupLow.toFixed(2)} back to $${cupEndP.toFixed(2)}, with shallow handle consolidation`,
    points: [
      { time: cup[0].time, price: cupStartP },
      { time: cup[cupLowIdx].time, price: cupLow },
      { time: cup[cup.length - 1].time, price: cupEndP },
      { time: handle[handle.length - 1].time, price: handleEndP },
    ],
    lines: [
      {
        points: [
          { time: cup[0].time, price: cupStartP },
          { time: cup[cup.length - 1].time, price: cupEndP },
        ],
        color: "#22c55e",
      },
    ],
    direction: "bullish",
  };
}

// ---------------------------------------------------------------------------
// 11. Rising Wedge  (bearish)  &  12. Falling Wedge  (bullish)
// ---------------------------------------------------------------------------

function detectWedge(candles: Candle[], rising: boolean): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { peaks, troughs } = findLocalExtrema(recent);
  if (peaks.length < 2 || troughs.length < 2) return null;

  const peakIdxs = peaks.slice(-3);
  const troughIdxs = troughs.slice(-3);
  if (peakIdxs.length < 2 || troughIdxs.length < 2) return null;

  const peakSlope = linearSlope(peakIdxs, peakIdxs.map((i) => recent[i].high));
  const troughSlope = linearSlope(troughIdxs, troughIdxs.map((i) => recent[i].low));

  if (rising) {
    if (peakSlope <= 0 || troughSlope <= 0) return null;
    if (troughSlope >= peakSlope) return null;
  } else {
    if (peakSlope >= 0 || troughSlope >= 0) return null;
    if (troughSlope <= peakSlope) return null;
  }

  const color = rising ? "#ef4444" : "#22c55e";
  const peakLine = peakIdxs.slice(0, 2).map((i) => ({ time: recent[i].time, price: recent[i].high }));
  const troughLine = troughIdxs.slice(0, 2).map((i) => ({ time: recent[i].time, price: recent[i].low }));

  return {
    type: rising ? "rising_wedge" : "falling_wedge",
    name: rising ? "Rising Wedge" : "Falling Wedge",
    description: `${rising ? "Converging upward" : "Converging downward"} trendlines — price squeezing into an apex, suggesting a ${rising ? "bearish" : "bullish"} breakout`,
    points: [...peakLine, ...troughLine],
    lines: [
      { points: peakLine, color },
      { points: troughLine, color },
    ],
    direction: rising ? "bearish" : "bullish",
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DETECTORS: ((candles: Candle[]) => DetectedPattern | null)[] = [
  detectHeadAndShoulders,
  detectInverseHeadAndShoulders,
  detectDoubleTop,
  detectDoubleBottom,
  detectCupAndHandle,
  (c) => detectWedge(c, true),
  (c) => detectWedge(c, false),
  (c) => detectTriangle(c, true),
  (c) => detectTriangle(c, false),
  (c) => detectFlag(c, true),
  (c) => detectFlag(c, false),
  detectMACross,
];

export function detectPattern(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 25) return null;
  for (const det of DETECTORS) {
    const result = det(candles);
    if (result) return result;
  }
  return null;
}

export function detectAllPatterns(candles: Candle[]): PatternWithConfidence[] {
  if (candles.length < 25) return [];
  const found: PatternWithConfidence[] = [];
  for (const det of DETECTORS) {
    const result = det(candles);
    if (result) {
      const confidence = calculateConfidence(result.type, candles, result.points);
      found.push({ pattern: result, confidence });
    }
  }
  return found.sort((a, b) => b.confidence - a.confidence);
}

export function getPatternColor(type: PatternType): string {
  const bullish: PatternType[] = [
    "double_bottom",
    "ma_crossover_bull",
    "inverse_head_and_shoulders",
    "bull_flag",
    "ascending_triangle",
    "cup_and_handle",
    "falling_wedge",
  ];
  return bullish.includes(type) ? "#22c55e" : "#ef4444";
}

export function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(6)}`;
}
