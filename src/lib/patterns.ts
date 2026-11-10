import type { Candle, DetectedPattern, PatternType, PatternWithConfidence, PatternTradeSetup } from "../types";
import { calculateConfidence } from "./indicators";

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
  if (a === 0) return 0;
  return Math.abs(a - b) / a;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildTradeSetup(
  direction: "bullish" | "bearish",
  entry: number,
  invalidation: number,
  reasons: string[],
  invalidationConditions: string[]
): PatternTradeSetup {
  const riskDist = Math.abs(entry - invalidation) || entry * 0.015;
  const sl = direction === "bullish" ? entry - riskDist : entry + riskDist;
  const tp1 = direction === "bullish" ? entry + riskDist * 1.5 : entry - riskDist * 1.5;
  const tp2 = direction === "bullish" ? entry + riskDist * 2.5 : entry - riskDist * 2.5;
  const tp3 = direction === "bullish" ? entry + riskDist * 4.0 : entry - riskDist * 4.0;
  const rr = Number((2.0).toFixed(2));

  return {
    entryPrice: Number(entry.toFixed(4)),
    stopLossPrice: Number(sl.toFixed(4)),
    takeProfit1: Number(tp1.toFixed(4)),
    takeProfit2: Number(tp2.toFixed(4)),
    takeProfit3: Number(tp3.toFixed(4)),
    riskRewardRatio: rr,
    confirmationStatus: "CONFIRMED",
    invalidationLevel: Number(invalidation.toFixed(4)),
    supportingReasons: reasons,
    invalidationConditions,
  };
}

function detectDoubleTop(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { peaks } = findLocalExtrema(recent);
  if (peaks.length < 2) return null;

  for (let i = peaks.length - 1; i >= 1; i--) {
    const p1 = peaks[i - 1];
    const p2 = peaks[i];
    const price1 = recent[p1].high;
    const price2 = recent[p2].high;
    if (pct(price1, price2) <= 0.012) {
      const midIdx = Math.round((p1 + p2) / 2);
      const valleyLow = recent[midIdx].low;
      return {
        type: "double_top",
        name: "Double Top",
        description: `Two peaks near $${price1.toFixed(2)} with neckline at $${valleyLow.toFixed(2)}`,
        points: [
          { time: recent[p1].time, price: price1 },
          { time: recent[midIdx].time, price: valleyLow },
          { time: recent[p2].time, price: price2 },
        ],
        direction: "bearish",
        tradeSetup: buildTradeSetup(
          "bearish",
          valleyLow,
          Math.max(price1, price2),
          ["Two failed attempts to breach resistance", "Rejection at key supply level"],
          ["Candle closes above twin peak highs", "Breakout volume spike above resistance"]
        ),
      };
    }
  }
  return null;
}

function detectDoubleBottom(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-50);
  const { troughs } = findLocalExtrema(recent);
  if (troughs.length < 2) return null;

  for (let i = troughs.length - 1; i >= 1; i--) {
    const t1 = troughs[i - 1];
    const t2 = troughs[i];
    const price1 = recent[t1].low;
    const price2 = recent[t2].low;
    if (pct(price1, price2) <= 0.012) {
      const midIdx = Math.round((t1 + t2) / 2);
      const necklineHigh = recent[midIdx].high;
      return {
        type: "double_bottom",
        name: "Double Bottom",
        description: `Two troughs near $${price1.toFixed(2)} with neckline at $${necklineHigh.toFixed(2)}`,
        points: [
          { time: recent[t1].time, price: price1 },
          { time: recent[midIdx].time, price: necklineHigh },
          { time: recent[t2].time, price: price2 },
        ],
        direction: "bullish",
        tradeSetup: buildTradeSetup(
          "bullish",
          necklineHigh,
          Math.min(price1, price2),
          ["Support floor defended twice", "Accumulation at key demand block"],
          ["Candle close below twin trough support", "Bearish continuation breakdown"]
        ),
      };
    }
  }
  return null;
}

function detectTripleTop(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-60);
  const { peaks } = findLocalExtrema(recent);
  if (peaks.length < 3) return null;

  for (let i = peaks.length - 1; i >= 2; i--) {
    const p1 = recent[peaks[i - 2]].high;
    const p2 = recent[peaks[i - 1]].high;
    const p3 = recent[peaks[i]].high;

    if (pct(p1, p2) <= 0.015 && pct(p2, p3) <= 0.015) {
      const peakMax = Math.max(p1, p2, p3);
      const valley = recent[Math.round((peaks[i - 2] + peaks[i]) / 2)].low;
      return {
        type: "triple_top",
        name: "Triple Top",
        description: `Three major resistance tests near $${p2.toFixed(2)} signaling exhaustion`,
        points: [
          { time: recent[peaks[i - 2]].time, price: p1 },
          { time: recent[peaks[i - 1]].time, price: p2 },
          { time: recent[peaks[i]].time, price: p3 },
        ],
        direction: "bearish",
        tradeSetup: buildTradeSetup(
          "bearish",
          valley,
          peakMax,
          ["Heavy institutional sell wall tested three times", "Momentum fading on each test"],
          ["Closing bar above highest peak", "Volume expansion breaking resistance"]
        ),
      };
    }
  }
  return null;
}

function detectTripleBottom(candles: Candle[]): DetectedPattern | null {
  const recent = candles.slice(-60);
  const { troughs } = findLocalExtrema(recent);
  if (troughs.length < 3) return null;

  for (let i = troughs.length - 1; i >= 2; i--) {
    const t1 = recent[troughs[i - 2]].low;
    const t2 = recent[troughs[i - 1]].low;
    const t3 = recent[troughs[i]].low;

    if (pct(t1, t2) <= 0.015 && pct(t2, t3) <= 0.015) {
      const troughMin = Math.min(t1, t2, t3);
      const ridge = recent[Math.round((troughs[i - 2] + troughs[i]) / 2)].high;
      return {
        type: "triple_bottom",
        name: "Triple Bottom",
        description: `Three major support tests near $${t2.toFixed(2)} signaling accumulation`,
        points: [
          { time: recent[troughs[i - 2]].time, price: t1 },
          { time: recent[troughs[i - 1]].time, price: t2 },
          { time: recent[troughs[i]].time, price: t3 },
        ],
        direction: "bullish",
        tradeSetup: buildTradeSetup(
          "bullish",
          ridge,
          troughMin,
          ["Triple demand defense with absorption of selling pressure", "Bullish divergence"],
          ["Sustained close below the triple floor", "Flash selloff breakdown"]
        ),
      };
    }
  }
  return null;
}

function detectCandlestickPatterns(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 4) return null;
  const c0 = candles[candles.length - 1];
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 3];

  const body0 = Math.abs(c0.close - c0.open);
  const range0 = c0.high - c0.low || 0.0001;
  const body1 = Math.abs(c1.close - c1.open);
  const range1 = c1.high - c1.low || 0.0001;

  if (c1.close < c1.open && c0.close > c0.open && c0.close > c1.open && c0.open < c1.close) {
    return {
      type: "bullish_engulfing",
      name: "Bullish Engulfing",
      description: `Large green candle entirely engulfed preceding red candle at $${c0.close.toFixed(2)}`,
      points: [
        { time: c1.time, price: c1.open },
        { time: c0.time, price: c0.close },
      ],
      direction: "bullish",
      tradeSetup: buildTradeSetup(
        "bullish",
        c0.close,
        Math.min(c0.low, c1.low),
        ["Buyers completely overwhelmed previous selling supply", "Strong reversal trigger"],
        ["Immediate drop below low of the engulfing candle"]
      ),
    };
  }

  if (c1.close > c1.open && c0.close < c0.open && c0.open > c1.close && c0.close < c1.open) {
    return {
      type: "bearish_engulfing",
      name: "Bearish Engulfing",
      description: `Large red candle completely engulfed previous green candle at $${c0.close.toFixed(2)}`,
      points: [
        { time: c1.time, price: c1.open },
        { time: c0.time, price: c0.close },
      ],
      direction: "bearish",
      tradeSetup: buildTradeSetup(
        "bearish",
        c0.close,
        Math.max(c0.high, c1.high),
        ["Sellers completely overwhelmed previous buyer demand", "Distribution signal"],
        ["Subsequent candle close above high of engulfing candle"]
      ),
    };
  }

  const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;
  const upperWick0 = c0.high - Math.max(c0.open, c0.close);
  if (lowerWick0 >= 2 * body0 && lowerWick0 >= 0.5 * range0 && upperWick0 <= 0.2 * range0 && range0 > 0) {
    return {
      type: "hammer",
      name: "Hammer",
      description: `Bullish rejection pinbar with long lower shadow at $${c0.low.toFixed(2)}`,
      points: [
        { time: c0.time, price: c0.low },
        { time: c0.time, price: c0.close },
      ],
      direction: "bullish",
      tradeSetup: buildTradeSetup(
        "bullish",
        c0.close,
        c0.low,
        ["Sharp intraday liquidity sweep followed by aggressive bid absorption", "Rejection of lower prices"],
        ["Price closes beneath the hammer tail low"]
      ),
    };
  }

  if (upperWick0 >= 2 * body0 && upperWick0 >= 0.5 * range0 && lowerWick0 <= 0.2 * range0 && range0 > 0) {
    return {
      type: "shooting_star",
      name: "Shooting Star",
      description: `Bearish exhaustion pinbar with extended upper shadow at $${c0.high.toFixed(2)}`,
      points: [
        { time: c0.time, price: c0.high },
        { time: c0.time, price: c0.close },
      ],
      direction: "bearish",
      tradeSetup: buildTradeSetup(
        "bearish",
        c0.close,
        c0.high,
        ["Strong rejection at overhead highs", "Buyer liquidity exhaustively tapped"],
        ["Price pushes and closes above the wick high"]
      ),
    };
  }

  if (c2.close < c2.open && body1 <= 0.3 * range1 && c0.close > c0.open && c0.close > (c2.open + c2.close) / 2) {
    return {
      type: "morning_star",
      name: "Morning Star",
      description: `3-candle bullish reversal anchored around star pivot at $${c1.low.toFixed(2)}`,
      points: [
        { time: c2.time, price: c2.close },
        { time: c1.time, price: c1.low },
        { time: c0.time, price: c0.close },
      ],
      direction: "bullish",
      tradeSetup: buildTradeSetup(
        "bullish",
        c0.close,
        c1.low,
        ["Downtrend momentum stall confirmed by strong bullish follow-through", "Bottom formation"],
        ["Break below lowest point of the star candle"]
      ),
    };
  }

  if (c2.close > c2.open && body1 <= 0.3 * range1 && c0.close < c0.open && c0.close < (c2.open + c2.close) / 2) {
    return {
      type: "evening_star",
      name: "Evening Star",
      description: `3-candle bearish reversal anchored around star top at $${c1.high.toFixed(2)}`,
      points: [
        { time: c2.time, price: c2.close },
        { time: c1.time, price: c1.high },
        { time: c0.time, price: c0.close },
      ],
      direction: "bearish",
      tradeSetup: buildTradeSetup(
        "bearish",
        c0.close,
        c1.high,
        ["Uptrend stalled followed by sharp supply wave into prior candle body", "Top reversal structure"],
        ["Break and close above the high of the middle star candle"]
      ),
    };
  }

  const upperWickDoji = c0.high - Math.max(c0.open, c0.close);
  const lowerWickDoji = Math.min(c0.open, c0.close) - c0.low;
  if (body0 <= 0.05 * range0 && range0 > 0 && Math.abs(upperWickDoji - lowerWickDoji) / range0 < 0.4) {
    return {
      type: "doji",
      name: "Doji Indecision",
      description: `Market equilibrium / indecision candle at $${c0.close.toFixed(2)}`,
      points: [{ time: c0.time, price: c0.close }],
      direction: c0.close >= c1.close ? "bullish" : "bearish",
      tradeSetup: buildTradeSetup(
        c0.close >= c1.close ? "bullish" : "bearish",
        c0.close,
        c0.close >= c1.close ? c0.low : c0.high,
        ["Equilibrium between bulls and bears", "High probability volatility squeeze imminent"],
        ["Failed resolution outside the candle high/low range"]
      ),
    };
  }

  return null;
}

function detectLiquidityAndBreakouts(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 20) return null;
  const recent = candles.slice(-20);
  const last = recent[recent.length - 1];
  const prevCandles = recent.slice(0, -1);

  const highestHigh = Math.max(...prevCandles.map((c) => c.high));
  const lowestLow = Math.min(...prevCandles.map((c) => c.low));

  if (last.low < lowestLow && last.close > lowestLow) {
    return {
      type: "liquidity_sweep_bull",
      name: "Bullish Liquidity Sweep",
      description: `Stop hunt below $${lowestLow.toFixed(2)} absorbed by buyers`,
      points: [
        { time: last.time, price: last.low },
        { time: last.time, price: last.close },
      ],
      direction: "bullish",
      tradeSetup: buildTradeSetup(
        "bullish",
        last.close,
        last.low,
        ["Trapped retail stop-losses absorbed by institutions", "Fast mean reversion response"],
        ["New low printed below the sweep wick"]
      ),
    };
  }

  if (last.high > highestHigh && last.close < highestHigh) {
    return {
      type: "liquidity_sweep_bear",
      name: "Bearish Liquidity Sweep",
      description: `Buy-side liquidity tapped above $${highestHigh.toFixed(2)} with quick rejection`,
      points: [
        { time: last.time, price: last.high },
        { time: last.time, price: last.close },
      ],
      direction: "bearish",
      tradeSetup: buildTradeSetup(
        "bearish",
        last.close,
        last.high,
        ["Breakout buyers trapped at the highs", "Immediate supply dump back under key resistance"],
        ["New candle closing above sweep apex"]
      ),
    };
  }

  if (last.close > highestHigh) {
    return {
      type: "breakout_bull",
      name: "Bullish Range Breakout",
      description: `Momentum breakout above key 20-candle range ceiling at $${highestHigh.toFixed(2)}`,
      points: [
        { time: last.time, price: highestHigh },
        { time: last.time, price: last.close },
      ],
      direction: "bullish",
      tradeSetup: buildTradeSetup(
        "bullish",
        last.close,
        highestHigh * 0.985,
        ["Decisive range expansion without immediate rejection", "Trend continuation"],
        ["Re-entry into previous consolidated range"]
      ),
    };
  }

  if (last.close < lowestLow) {
    return {
      type: "breakout_bear",
      name: "Bearish Range Breakdown",
      description: `Breakdown below key 20-candle range support floor at $${lowestLow.toFixed(2)}`,
      points: [
        { time: last.time, price: lowestLow },
        { time: last.time, price: last.close },
      ],
      direction: "bearish",
      tradeSetup: buildTradeSetup(
        "bearish",
        last.close,
        lowestLow * 1.015,
        ["Support floor broke decisively on heavy seller initiative", "Continuation pattern"],
        ["Fake breakdown reclaiming range baseline"]
      ),
    };
  }

  return null;
}

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
      const nlAvg = avg([necklineLeft, necklineRight]);
      return {
        type: "head_and_shoulders",
        name: "Head and Shoulders",
        description: `Head at $${hP.toFixed(2)} flanked by shoulders, neckline near $${nlAvg.toFixed(2)}`,
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
        tradeSetup: buildTradeSetup(
          "bearish",
          nlAvg,
          hP,
          ["Classic institutional distribution pattern", "Right shoulder printed lower high"],
          ["Price breaks above head peak at $" + hP.toFixed(2)]
        ),
      };
    }
  }
  return null;
}

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
      const nlAvg = avg([necklineLeft, necklineRight]);
      return {
        type: "inverse_head_and_shoulders",
        name: "Inverse Head and Shoulders",
        description: `Inverse head at $${hP.toFixed(2)} flanked by shoulders, neckline near $${nlAvg.toFixed(2)}`,
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
        tradeSetup: buildTradeSetup(
          "bullish",
          nlAvg,
          hP,
          ["Institutional reaccumulation bottom", "Right shoulder printed higher low"],
          ["Price breaks below inverse head trough at $" + hP.toFixed(2)]
        ),
      };
    }
  }
  return null;
}

function detectFlag(candles: Candle[], bullish: boolean): DetectedPattern | null {
  const recent = candles.slice(-50);
  if (recent.length < 20) return null;
  const poleEnd = Math.floor(recent.length * 0.4);
  const pole = recent.slice(0, poleEnd);
  const flag = recent.slice(poleEnd);

  const poleStart = pole[0].close;
  const poleEndPrice = pole[pole.length - 1].close;
  const poleMove = bullish ? poleEndPrice - poleStart : poleStart - poleEndPrice;
  const polePct = poleMove / (poleStart || 1);

  if (polePct < 0.03) return null;

  const flagHighs = flag.map((c) => c.high);
  const flagLows = flag.map((c) => c.low);
  const flagRange = avg(flagHighs) - avg(flagLows);
  const flagAvgPct = flagRange / (poleEndPrice || 1);

  if (flagAvgPct > 0.03) return null;

  const flagSlope = linearSlope(
    flag.map((_, i) => i),
    flag.map((c) => c.close)
  );

  if (bullish && flagSlope < -0.0001) {
    return {
      type: "bull_flag",
      name: "Bull Flag",
      description: `Strong uptrend of ${(polePct * 100).toFixed(1)}% followed by shallow consolidation`,
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
      tradeSetup: buildTradeSetup(
        "bullish",
        flag[flag.length - 1].high,
        flag[0].low,
        ["High pole momentum", "Orderly tight pullback preserving majority of gain"],
        ["Closing candle below flag channel base"]
      ),
    };
  }

  if (!bullish && flagSlope > 0.0001) {
    return {
      type: "bear_flag",
      name: "Bear Flag",
      description: `Strong downtrend of ${(polePct * 100).toFixed(1)}% followed by ascending consolidation`,
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
      tradeSetup: buildTradeSetup(
        "bearish",
        flag[flag.length - 1].low,
        flag[0].high,
        ["Strong impulsive downward impulse", "Weak low-volume corrective flag bounce"],
        ["Closing candle above flag channel ceiling"]
      ),
    };
  }

  return null;
}

const DETECTORS: ((candles: Candle[]) => DetectedPattern | null)[] = [
  detectLiquidityAndBreakouts,
  detectCandlestickPatterns,
  detectDoubleTop,
  detectDoubleBottom,
  detectTripleTop,
  detectTripleBottom,
  detectHeadAndShoulders,
  detectInverseHeadAndShoulders,
  (c) => detectFlag(c, true),
  (c) => detectFlag(c, false),
];

export function detectPattern(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 5) return null;
  for (const det of DETECTORS) {
    const result = det(candles);
    if (result) return result;
  }
  return null;
}

export function detectAllPatterns(candles: Candle[]): PatternWithConfidence[] {
  if (candles.length < 5) return [];
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
    "triple_bottom",
    "ma_crossover_bull",
    "inverse_head_and_shoulders",
    "bull_flag",
    "ascending_triangle",
    "cup_and_handle",
    "falling_wedge",
    "bullish_engulfing",
    "hammer",
    "morning_star",
    "liquidity_sweep_bull",
    "breakout_bull",
  ];
  return bullish.includes(type) ? "#22c55e" : "#ef4444";
}

export function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(6)}`;
}
