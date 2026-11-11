// Mock localStorage for node test runner before any imports
const memoryStorage: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memoryStorage[key] || null,
  setItem: (key: string, value: string) => {
    memoryStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete memoryStorage[key];
  },
  clear: () => {
    for (const k in memoryStorage) delete memoryStorage[k];
  },
  key: (index: number) => Object.keys(memoryStorage)[index] || null,
  length: 0,
};

import { liveWorkerLogStore, WorkerLog } from "./LiveWorkerLogStore";
import { evaluateLocalHeuristicEngine, simulateSwarmDebate } from "./AgentSwarm";
import { autoTradeEngine } from "./BinanceAutoTrade";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

async function runDiagnosticsAndFallbackTests() {
  console.log("Starting Auto-Pilot Diagnostics & Gemini Fallback Unit Tests...\n");

  // 1. LiveWorkerLogStore Tests
  liveWorkerLogStore.clear();
  assert(liveWorkerLogStore.getLogs().length === 0, "Log store starts empty after clear");

  let receivedLogs: WorkerLog[] = [];
  const unsub = liveWorkerLogStore.subscribe((logs) => {
    receivedLogs = logs;
  });

  const log1 = liveWorkerLogStore.addLog("Trade rejected: Confluence score 60/85", "warn", { symbol: "BTCUSDT" });
  assert(receivedLogs.length === 1, "Subscriber received log event");
  assert(receivedLogs[0].message === "Trade rejected: Confluence score 60/85", "Logged rejection message matches");
  assert(receivedLogs[0].level === "warn", "Logged level is warn");
  assert(receivedLogs[0].symbol === "BTCUSDT", "Logged symbol is BTCUSDT");

  // Verify throttling for duplicate logs within 2 seconds
  const throttledLog = liveWorkerLogStore.addLog("Trade rejected: Confluence score 60/85", "warn", { symbol: "BTCUSDT" });
  assert(throttledLog.id === log1.id, "Duplicate message within debounce window returns previous log instance");
  assert(receivedLogs.length === 1, "Subscriber not flooded with duplicate message");

  unsub();

  // 2. Local Heuristic Engine Fallback Tests
  console.log("\nTesting Local Heuristic Engine Fallback in AgentSwarm...");
  const heuristicGoResult = evaluateLocalHeuristicEngine({
    symbol: "ETHUSDT",
    price: 3500,
    rsi: 30, // oversold bounce -> bullish confluence
    trend: "uptrend",
    patternName: "Double Bottom",
    patternDirection: "bullish",
    fearGreed: 25,
    allowAiFallback: true,
  });

  assert(heuristicGoResult.isFallback === true, "Result is marked as fallback");
  assert(heuristicGoResult.verdict === "GO", "Heuristic engine issues GO verdict on high-probability bullish setup");
  assert(heuristicGoResult.recommendedDirection === "LONG", "Recommended direction is LONG");

  const heuristicVetoResult = evaluateLocalHeuristicEngine({
    symbol: "SOLUSDT",
    price: 150,
    spreadPct: 0.25, // Excessive spread (>0.1%)
    allowAiFallback: true,
  });
  assert(heuristicVetoResult.verdict === "NO-GO", "Heuristic engine vetoes on high spread");
  assert(heuristicVetoResult.verdictReason.includes("Excessive Bid/Ask spread"), "Veto reason indicates spread guard");

  const fallbackDisabledResult = evaluateLocalHeuristicEngine({
    symbol: "ETHUSDT",
    price: 3500,
    rsi: 30,
    trend: "uptrend",
    patternName: "Double Bottom",
    patternDirection: "bullish",
    allowAiFallback: false,
  });
  assert(fallbackDisabledResult.verdict === "NO-GO", "Heuristic engine blocks trade if allowAiFallback is disabled");
  assert(fallbackDisabledResult.verdictReason.includes("Gemini API unavailable"), "Blocked reason indicates AI fallback disabled");

  // 3. Engine Rejection Logging Verification
  console.log("\nTesting BinanceAutoTrade rejection logs...");
  liveWorkerLogStore.clear();

  // Enable disclaimer first so execution reaches circuit breaker check
  autoTradeEngine.saveConfig({ disclaimerAgreed: true });
  autoTradeEngine.tripCircuitBreaker("Unit Test Trip");

  const rejectRes = await autoTradeEngine.executeTrade({
    symbol: "BTCUSDT",
    entryPrice: 65000,
    atrValue: 1000,
  });
  assert(rejectRes.success === false, "Execution blocked by circuit breaker");
  const logsAfterBreaker = liveWorkerLogStore.getLogs();
  assert(logsAfterBreaker.some((l) => l.message.includes("Circuit Breaker is TRIPPED")), "Circuit breaker trip logged to LiveWorkerLogStore");

  autoTradeEngine.resetCircuitBreaker();

  console.log("\nAll Auto-Pilot Diagnostics & Gemini Fallback Unit Tests passed!\n");
}

runDiagnosticsAndFallbackTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
