import type { Candle } from "../types";
import { rsi } from "./indicators";
import type { SMCData, HTFTrendResult } from "./SMCScanner";

export interface ConfluenceCheckItem {
  id: string;
  name: string;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  detail?: string;
}

export interface ConfluenceResult {
  score: number; // 0 - 100
  canExecute: boolean; // score >= 85
  items: ConfluenceCheckItem[];
  setupBias: "Bullish" | "Bearish" | "Neutral";
  currentPrice: number;
  adxValue: number | null;
  rsiValue: number | null;
  volumeRatio: number | null;
  smcZoneFound: string | null;
}

/**
 * Calculates Welles Wilder's ADX (Average Directional Index)
 * standard 14 period.
 * Returns array of ADX values corresponding to candles, or null if insufficient data.
 */
export function calculateADX(candles: Candle[], period = 14): (number | null)[] {
  const n = candles.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (n < period * 2) {
    return result;
  }

  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < n; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    // True Range
    const currentTR = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(currentTR);

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Smooth TR, +DM, -DM using Wilder's smoothing
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dx: (number | null)[] = new Array(n).fill(null);

  const calcDX = (pDM: number, mDM: number, sTR: number) => {
    if (sTR === 0) return 0;
    const plusDI = (pDM / sTR) * 100;
    const minusDI = (mDM / sTR) * 100;
    const sumDI = plusDI + minusDI;
    if (sumDI === 0) return 0;
    return (Math.abs(plusDI - minusDI) / sumDI) * 100;
  };

  dx[period] = calcDX(smoothPlusDM, smoothMinusDM, smoothTR);

  for (let i = period + 1; i < n; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    dx[i] = calcDX(smoothPlusDM, smoothMinusDM, smoothTR);
  }

  // Calculate ADX as smoothed DX
  const firstAdxIndex = period * 2 - 1;
  if (firstAdxIndex < n) {
    let sumDX = 0;
    for (let i = period; i <= firstAdxIndex; i++) {
      sumDX += dx[i] ?? 0;
    }
    let prevADX = sumDX / period;
    result[firstAdxIndex] = prevADX;

    for (let i = firstAdxIndex + 1; i < n; i++) {
      prevADX = (prevADX * (period - 1) + (dx[i] ?? 0)) / period;
      result[i] = prevADX;
    }
  }

  return result;
}

/**
 * Sniper Confluence Engine:
 * Evaluates 5 conditions totaling 100 points:
 * 1. HTF Trend alignment (25 pts)
 * 2. SMC setup: Price inside Bullish/Bearish FVG or OB (25 pts)
 * 3. RSI: 40-60 (Neutral sweet spot) or Overbought/Oversold extremes (15 pts)
 * 4. Volume: Above 20-period average (15 pts)
 * 5. ADX: > 20 (Trending market) (20 pts)
 */
export function evaluateConfluence(
  candles: Candle[],
  smcData: SMCData,
  htfTrend: HTFTrendResult | null
): ConfluenceResult {
  const items: ConfluenceCheckItem[] = [];

  if (candles.length === 0) {
    return {
      score: 0,
      canExecute: false,
      items: [],
      setupBias: "Neutral",
      currentPrice: 0,
      adxValue: null,
      rsiValue: null,
      volumeRatio: null,
      smcZoneFound: null,
    };
  }

  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;

  // Detect bias: based on HTF trend or recent price structure
  const htfDirection = htfTrend?.trend ?? "Neutral";
  let setupBias: "Bullish" | "Bearish" | "Neutral" = "Neutral";
  if (htfDirection === "Bullish") setupBias = "Bullish";
  else if (htfDirection === "Bearish") setupBias = "Bearish";
  else {
    // Fallback: 20-period SMA
    const recentCloses = candles.slice(-20).map((c) => c.close);
    const avgClose = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    setupBias = currentPrice >= avgClose ? "Bullish" : "Bearish";
  }

  // 1. HTF Trend Alignment (25 Points)
  // Aligned if HTF Trend is Bullish (price above 1H & 4H EMA50) or Bearish (price below EMA50)
  // and aligns with setup bias.
  const isHtfAligned =
    htfTrend !== null &&
    (htfTrend.trend === "Bullish" || htfTrend.trend === "Bearish");

  if (isHtfAligned) {
    items.push({
      id: "htf-trend",
      name: "HTF Trend Alignment",
      passed: true,
      score: 25,
      maxScore: 25,
      message: `HTF Trend: ${htfTrend.trend} (1H & 4H EMA50 aligned)`,
      detail: `1H EMA(50): $${htfTrend.ema1h?.toFixed(2) ?? "N/A"} | 4H EMA(50): $${htfTrend.ema4h?.toFixed(2) ?? "N/A"}`,
    });
  } else {
    items.push({
      id: "htf-trend",
      name: "HTF Trend Alignment",
      passed: false,
      score: 0,
      maxScore: 25,
      message: "HTF Trend Neutral / Conflicted",
      detail: "1H and 4H EMAs are conflicting or awaiting trend definition.",
    });
  }

  // 2. SMC Setup (25 Points)
  // Check if currentPrice is inside any active Bullish/Bearish Order Block or Fair Value Gap
  let activeSMCZone: string | null = null;
  let smcType: "bullish" | "bearish" | null = null;

  // Check recent unmitigated or active zones
  for (const ob of smcData.orderBlocks) {
    const minP = Math.min(ob.top, ob.bottom);
    const maxP = Math.max(ob.top, ob.bottom);
    // Expand tolerance slightly by 0.1% for wick contact
    const tolerance = currentPrice * 0.001;
    if (currentPrice >= minP - tolerance && currentPrice <= maxP + tolerance) {
      activeSMCZone = `${ob.type === "bullish" ? "Bullish" : "Bearish"} Order Block ($${minP.toFixed(2)} - $${maxP.toFixed(2)})`;
      smcType = ob.type;
      break;
    }
  }

  if (!activeSMCZone) {
    for (const fvg of smcData.fvgs) {
      const minP = Math.min(fvg.top, fvg.bottom);
      const maxP = Math.max(fvg.top, fvg.bottom);
      const tolerance = currentPrice * 0.001;
      if (currentPrice >= minP - tolerance && currentPrice <= maxP + tolerance) {
        activeSMCZone = `${fvg.type === "bullish" ? "Bullish" : "Bearish"} Fair Value Gap ($${minP.toFixed(2)} - $${maxP.toFixed(2)})`;
        smcType = fvg.type;
        break;
      }
    }
  }

  if (activeSMCZone) {
    items.push({
      id: "smc-setup",
      name: "Smart Money Concepts (SMC) Setup",
      passed: true,
      score: 25,
      maxScore: 25,
      message: `Price inside ${activeSMCZone}`,
      detail: `Institutional zone reaction detected (${smcType === "bullish" ? "Demand" : "Supply"}).`,
    });
  } else {
    items.push({
      id: "smc-setup",
      name: "Smart Money Concepts (SMC) Setup",
      passed: false,
      score: 0,
      maxScore: 25,
      message: "Price outside Key SMC Levels",
      detail: "Current price is not inside an active Order Block or Fair Value Gap.",
    });
  }

  // 3. RSI: 40-60 (Neutral) or Overbought/Oversold extremes (15 points)
  const closes = candles.map((c) => c.close);
  const rsiSeries = rsi(closes, 14);
  const currentRsi = rsiSeries[rsiSeries.length - 1];

  let rsiPassed = false;
  let rsiDesc = "";

  if (currentRsi !== null && currentRsi !== undefined) {
    if (currentRsi >= 40 && currentRsi <= 60) {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Healthy Neutral Sweet Spot)`;
    } else if (currentRsi <= 30) {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Oversold Extreme - Reversal Confluence)`;
    } else if (currentRsi >= 70) {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Overbought Extreme - Exhaustion Confluence)`;
    } else {
      rsiPassed = false;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (No Confluence / Mid-momentum 30-40 or 60-70)`;
    }
  } else {
    rsiDesc = "Insufficient data for RSI calculation";
  }

  items.push({
    id: "rsi-condition",
    name: "RSI Confluence (40-60 Neutral or Extremes)",
    passed: rsiPassed,
    score: rsiPassed ? 15 : 0,
    maxScore: 15,
    message: rsiDesc,
    detail: "Criteria: 40-60 for momentum continuation OR < 30 / > 70 for key reversal confluence.",
  });

  // 4. Volume: Above 20-period average (15 points)
  const period = 20;
  let volumeRatio: number | null = null;
  let volPassed = false;
  let volDesc = "";

  if (candles.length >= period) {
    const recent20 = candles.slice(-period);
    const avgVol = recent20.reduce((sum, c) => sum + c.volume, 0) / period;
    const currentVol = currentCandle.volume;
    volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

    if (currentVol > avgVol) {
      volPassed = true;
      volDesc = `Volume: ${(volumeRatio * 100).toFixed(0)}% of 20-period average (High Volume)`;
    } else {
      volPassed = false;
      volDesc = `Volume: ${(volumeRatio * 100).toFixed(0)}% of 20-period average (Below Average)`;
    }
  } else {
    volDesc = "Insufficient candle history for 20-period volume average";
  }

  items.push({
    id: "volume-condition",
    name: "Volume Confirmation (> 20-period SMA)",
    passed: volPassed,
    score: volPassed ? 15 : 0,
    maxScore: 15,
    message: volDesc,
    detail: `Current volume: ${currentCandle.volume.toLocaleString()} vs 20-MA average.`,
  });

  // 5. ADX: > 20 (Trending Market) (20 points)
  const adxSeries = calculateADX(candles, 14);
  const currentADX = adxSeries[adxSeries.length - 1];

  let adxPassed = false;
  let adxDesc = "";

  if (currentADX !== null && currentADX !== undefined) {
    if (currentADX > 20) {
      adxPassed = true;
      adxDesc = `ADX: ${currentADX.toFixed(1)} (Trending Market)`;
    } else {
      adxPassed = false;
      adxDesc = `ADX < 20 (${currentADX.toFixed(1)}): Choppy Market`;
    }
  } else {
    adxDesc = "ADX calculation requires at least 28 candles";
  }

  items.push({
    id: "adx-condition",
    name: "ADX Trend Strength (> 20)",
    passed: adxPassed,
    score: adxPassed ? 20 : 0,
    maxScore: 20,
    message: adxDesc,
    detail: "ADX > 20 filters out low-liquidity consolidations and confirms active trend momentum.",
  });

  const totalScore = items.reduce((sum, it) => sum + it.score, 0);
  const canExecute = totalScore >= 85;

  return {
    score: totalScore,
    canExecute,
    items,
    setupBias,
    currentPrice,
    adxValue: currentADX ?? null,
    rsiValue: currentRsi ?? null,
    volumeRatio,
    smcZoneFound: activeSMCZone,
  };
}
