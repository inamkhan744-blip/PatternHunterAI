import { evaluateConfluence, calculateADX } from "./ConfluenceEngine";
import type { Candle } from "../types";
import type { SMCData, HTFTrendResult } from "./SMCScanner";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

async function runTests() {
  console.log("Running Confluence Engine Test Suite...");

  const candles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    const base = 100 + i * 2;
    candles.push({
      time: 1000 + i * 60,
      open: base,
      high: base + 3,
      low: base - 1,
      close: base + 2,
      volume: 100 + i * 10,
    });
  }

  const adxValues = calculateADX(candles, 14);
  const lastAdx = adxValues[adxValues.length - 1];
  assert(lastAdx !== null && lastAdx > 0, "ADX is calculated and positive on trending data");

  const smcData: SMCData = {
    orderBlocks: [
      {
        id: "ob-1",
        type: "bullish",
        top: 205,
        bottom: 195,
        startTime: 1000,
        endTime: 2000,
        mitigated: false,
      },
    ],
    fvgs: [],
  };

  const htfTrend: HTFTrendResult = {
    trend: "Bullish",
    ema1h: 190,
    ema4h: 180,
    price1h: 200,
    price4h: 198,
  };

  const result = evaluateConfluence(candles, smcData, htfTrend);

  assert(result.score >= 50, `Confluence score is elevated (got ${result.score})`);
  assert(result.setupBias === "Strong Buy" || result.setupBias === "Buy", `Bias is Buy/Strong Buy (got ${result.setupBias})`);
  assert(result.evidence.length > 0, "Provides transparent evidence behind signal");
  assert(result.invalidationCriteria.length > 0, "Provides actionable invalidation criteria");
  assert(result.items.some((i) => i.id === "htf-trend" && i.passed), "HTF Trend alignment check passed");
  assert(result.items.some((i) => i.id === "smc-setup" && i.passed), "SMC institutional zone check passed");

  console.log("All Confluence Engine tests passed successfully!");
}

runTests();
