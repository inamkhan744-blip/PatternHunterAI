import { detectPattern, getPatternColor } from "./patterns";
import type { Candle } from "../types";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

async function runTests() {
  console.log("Running Advanced Pattern Detection Test Suite...");

  const engulfingCandles: Candle[] = [
    { time: 500, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 600, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 1000, open: 100, high: 105, low: 98, close: 102, volume: 100 },
    { time: 2000, open: 102, high: 103, low: 95, close: 96, volume: 120 },
    { time: 3000, open: 95, high: 106, low: 94, close: 104, volume: 250 },
  ];
  const engulfed = detectPattern(engulfingCandles);
  assert(engulfed !== null && engulfed.type === "bullish_engulfing", "Detects Bullish Engulfing pattern");
  assert(engulfed?.direction === "bullish", "Bullish Engulfing direction is bullish");
  assert(engulfed?.tradeSetup !== undefined, "Trade setup generated with entry and SL");
  assert(engulfed?.tradeSetup?.riskRewardRatio === 2.0, "Risk reward ratio is set correctly");

  const hammerCandles: Candle[] = [
    { time: 500, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 600, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 700, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 1000, open: 100, high: 102, low: 98, close: 99, volume: 100 },
    { time: 2000, open: 99, high: 100, low: 90, close: 99.5, volume: 150 },
  ];
  const hammer = detectPattern(hammerCandles);
  assert(hammer !== null && hammer.type === "hammer", "Detects Hammer candlestick pattern");
  assert(hammer?.direction === "bullish", "Hammer is bullish direction");

  const starCandles: Candle[] = [
    { time: 500, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 600, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 700, open: 100, high: 101, low: 99, close: 100, volume: 100 },
    { time: 1000, open: 100, high: 102, low: 98, close: 101, volume: 100 },
    { time: 2000, open: 101, high: 112, low: 100.5, close: 101.5, volume: 150 },
  ];
  const shootingStar = detectPattern(starCandles);
  assert(shootingStar !== null && shootingStar.type === "shooting_star", "Detects Shooting Star rejection candle");
  assert(shootingStar?.direction === "bearish", "Shooting Star is bearish direction");

  const rangeCandles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    rangeCandles.push({
      time: 1000 + i * 60,
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 100,
    });
  }
  rangeCandles.push({
    time: 3000,
    open: 96,
    high: 99,
    low: 92,
    close: 98,
    volume: 300,
  });
  const sweep = detectPattern(rangeCandles);
  assert(sweep !== null && sweep.type === "liquidity_sweep_bull", "Detects Bullish Liquidity Sweep");
  assert((sweep?.tradeSetup?.invalidationConditions?.length ?? 0) > 0, "Provides actionable invalidation criteria");

  assert(getPatternColor("bullish_engulfing") === "#22c55e", "Bullish engulfing returns green color code");
  assert(getPatternColor("shooting_star") === "#ef4444", "Shooting star returns red color code");

  console.log("All Pattern Detection tests passed successfully!");
}

runTests();
