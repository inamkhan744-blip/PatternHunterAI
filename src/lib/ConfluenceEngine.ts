import type { Candle } from "../types";
import { rsi, macd } from "./indicators";
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

export type SignalSetupBias = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell" | "Bullish" | "Bearish";

export interface ConfluenceResult {
  score: number;
  canExecute: boolean;
  items: ConfluenceCheckItem[];
  setupBias: SignalSetupBias;
  currentPrice: number;
  adxValue: number | null;
  rsiValue: number | null;
  volumeRatio: number | null;
  smcZoneFound: string | null;
  evidence: string[];
  invalidationCriteria: string[];
}

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

    const currentTR = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(currentTR);

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

export function evaluateConfluence(
  candles: Candle[],
  smcData: SMCData,
  htfTrend: HTFTrendResult | null
): ConfluenceResult {
  const items: ConfluenceCheckItem[] = [];
  const evidence: string[] = [];
  const invalidationCriteria: string[] = [];

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
      evidence: ["No candle data provided"],
      invalidationCriteria: ["Empty chart feed"],
    };
  }

  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;
  const closes = candles.map((c) => c.close);

  const htfDirection = htfTrend?.trend ?? "Neutral";
  let baseBias: "Bullish" | "Bearish" | "Neutral" = "Neutral";
  if (htfDirection === "Bullish") baseBias = "Bullish";
  else if (htfDirection === "Bearish") baseBias = "Bearish";
  else {
    const recentCloses = candles.slice(-20).map((c) => c.close);
    const avgClose = recentCloses.reduce((a, b) => a + b, 0) / (recentCloses.length || 1);
    baseBias = currentPrice >= avgClose ? "Bullish" : "Bearish";
  }

  const isHtfAligned = htfTrend !== null && (htfTrend.trend === "Bullish" || htfTrend.trend === "Bearish");
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
    evidence.push(`Strong HTF directional alignment: ${htfTrend.trend} trend confirmed on 1H/4H timeframe`);
    invalidationCriteria.push(`1H candle close across opposite side of EMA(50)`);
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

  let activeSMCZone: string | null = null;
  let smcType: "bullish" | "bearish" | null = null;

  for (const ob of smcData.orderBlocks) {
    const minP = Math.min(ob.top, ob.bottom);
    const maxP = Math.max(ob.top, ob.bottom);
    const tolerance = currentPrice * 0.0015;
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
      const tolerance = currentPrice * 0.0015;
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
    evidence.push(`Price is interacting with institutional ${activeSMCZone}`);
    invalidationCriteria.push(`Candle close outside of ${activeSMCZone}`);
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

  const rsiSeries = rsi(closes, 14);
  const currentRsi = rsiSeries[rsiSeries.length - 1];
  let rsiPassed = false;
  let rsiDesc = "";

  if (currentRsi !== null && currentRsi !== undefined) {
    if (currentRsi >= 40 && currentRsi <= 60) {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Healthy Neutral Sweet Spot)`;
      evidence.push(`RSI at ${currentRsi.toFixed(1)} provides ample runway without immediate exhaustion`);
    } else if (currentRsi <= 30 && baseBias === "Bullish") {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Oversold Extreme - Demand Reversal)`;
      evidence.push(`RSI oversold bounce confluence at ${currentRsi.toFixed(1)}`);
    } else if (currentRsi >= 70 && baseBias === "Bearish") {
      rsiPassed = true;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Overbought Extreme - Supply Rejection)`;
      evidence.push(`RSI overbought rejection confluence at ${currentRsi.toFixed(1)}`);
    } else {
      rsiPassed = false;
      rsiDesc = `RSI: ${currentRsi.toFixed(1)} (Neutral / Counter-trend reading)`;
    }
  } else {
    rsiDesc = "Insufficient candle data for RSI";
  }

  items.push({
    id: "rsi-condition",
    name: "RSI Confluence",
    passed: rsiPassed,
    score: rsiPassed ? 15 : 0,
    maxScore: 15,
    message: rsiDesc,
  });

  let macdPassed = false;
  let macdDesc = "";
  if (candles.length >= 26) {
    const macdData = macd(closes, 12, 26, 9);
    const lastHist = macdData.histogram[macdData.histogram.length - 1];
    const prevHist = macdData.histogram[macdData.histogram.length - 2];

    if (lastHist !== null && prevHist !== null) {
      if (baseBias === "Bullish" && lastHist > 0 && lastHist >= prevHist) {
        macdPassed = true;
        macdDesc = `MACD Histogram positive & expanding (+${lastHist.toFixed(2)})`;
        evidence.push("Bullish MACD histogram expansion confirming upward acceleration");
      } else if (baseBias === "Bearish" && lastHist < 0 && lastHist <= prevHist) {
        macdPassed = true;
        macdDesc = `MACD Histogram negative & accelerating (${lastHist.toFixed(2)})`;
        evidence.push("Bearish MACD histogram expansion confirming downward acceleration");
      } else {
        macdPassed = false;
        macdDesc = `MACD histogram neutral/conflicted (${lastHist.toFixed(2)})`;
      }
    } else {
      macdDesc = "MACD histogram pending signal line convergence";
    }
  } else {
    macdDesc = "Insufficient candle history for MACD";
  }

  items.push({
    id: "macd-condition",
    name: "MACD Momentum Alignment",
    passed: macdPassed,
    score: macdPassed ? 15 : 0,
    maxScore: 15,
    message: macdDesc,
  });

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
      volDesc = `Volume: ${(volumeRatio * 100).toFixed(0)}% of 20-period SMA (Above Average)`;
      evidence.push(`Elevated trading volume (${(volumeRatio * 100).toFixed(0)}% of 20-SMA) shows institutional participation`);
    } else {
      volPassed = false;
      volDesc = `Volume: ${(volumeRatio * 100).toFixed(0)}% of 20-period SMA (Below Average)`;
    }
  } else {
    volDesc = "Insufficient candle history for 20-SMA volume";
  }

  items.push({
    id: "volume-condition",
    name: "Volume Confirmation",
    passed: volPassed,
    score: volPassed ? 10 : 0,
    maxScore: 10,
    message: volDesc,
  });

  const adxSeries = calculateADX(candles, 14);
  const currentADX = adxSeries[adxSeries.length - 1];
  let adxPassed = false;
  let adxDesc = "";

  if (currentADX !== null && currentADX !== undefined) {
    if (currentADX > 20) {
      adxPassed = true;
      adxDesc = `ADX: ${currentADX.toFixed(1)} (Active Trend Momentum)`;
      evidence.push(`ADX trend strength at ${currentADX.toFixed(1)} confirms non-ranging conditions`);
    } else {
      adxPassed = false;
      adxDesc = `ADX: ${currentADX.toFixed(1)} (Weak / Sideways Range)`;
    }
  } else {
    adxDesc = "ADX requires at least 28 candles";
  }

  items.push({
    id: "adx-condition",
    name: "ADX Trend Strength",
    passed: adxPassed,
    score: adxPassed ? 10 : 0,
    maxScore: 10,
    message: adxDesc,
  });

  const totalScore = items.reduce((sum, it) => sum + it.score, 0);
  const canExecute = totalScore >= 85;

  let setupBias: SignalSetupBias = "Neutral";
  if (baseBias === "Bullish") {
    setupBias = totalScore >= 85 ? "Strong Buy" : totalScore >= 50 ? "Buy" : "Neutral";
  } else if (baseBias === "Bearish") {
    setupBias = totalScore >= 85 ? "Strong Sell" : totalScore >= 50 ? "Sell" : "Neutral";
  }

  if (invalidationCriteria.length === 0) {
    invalidationCriteria.push("Reversal across 20-period SMA on closing timeframe");
  }

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
    evidence,
    invalidationCriteria,
  };
}
