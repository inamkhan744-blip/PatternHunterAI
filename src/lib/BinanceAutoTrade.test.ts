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

import {
  calculatePositionSize,
  calculateLiquidationPrice,
  checkLiquidationProximity,
  calculateAtrStopLoss,
  evaluateTrailingStopLoss,
  BinanceAutoTradeEngine,
  ManagedTrade,
} from "./BinanceAutoTrade";
import { simulateSwarmDebate } from "./AgentSwarm";
import { paperTradingEngine } from "./PaperTrading";

async function runTests() {
  console.log("Starting Fortress Binance Auto-Trade Engine Unit Tests...");
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${desc}`);
      process.exitCode = 1;
    }
  }

  // 1. calculatePositionSize with leverage auto-compounding
  const pos1 = calculatePositionSize(2, 10000, 5, 50000); // 2% risk of 10000 = $200 margin. 5x leverage = $1000 pos. 1000 / 50000 = 0.02 BTC
  assert(pos1.marginRequired === 200, "Margin required is 200 for 2% of $10,000");
  assert(pos1.positionValue === 1000, "Position value compounds to $1000 with 5x leverage");
  assert(pos1.quantity === 0.02, "Quantity is exactly 0.02 BTC");

  // 1b. Edge cases: leverage clamped to 10 max
  const pos2 = calculatePositionSize(1, 10000, 25, 100);
  assert(pos2.positionValue === 1000, "Leverage is clamped to maximum 10x (1% of 10k * 10x = 1000)");

  // 2. calculateLiquidationPrice
  const liqLong = calculateLiquidationPrice(50000, 10, "LONG", 0.005);
  // Entry * (1 - 0.1 + 0.005) = 50000 * 0.905 = 45250
  assert(liqLong.liquidationPrice === 45250, `LONG 10x liquidation price is 45250 (got ${liqLong.liquidationPrice})`);

  const liqShort = calculateLiquidationPrice(50000, 10, "SHORT", 0.005);
  // Entry * (1 + 0.1 - 0.005) = 50000 * 1.095 = 54750
  assert(liqShort.liquidationPrice === 54750, `SHORT 10x liquidation price is 54750 (got ${liqShort.liquidationPrice})`);

  // 3. checkLiquidationProximity warning
  // In LONG, SL at 45300 while Liq is at 45250 (distance < 2%)
  const proxWarning = checkLiquidationProximity(45300, 45250, "LONG", 50000);
  assert(proxWarning.isTooClose === true, "Liquidation proximity triggers warning when SL is within 2% of Liq Price");

  // SL below liq price in LONG is critical
  const proxCritical = checkLiquidationProximity(45200, 45250, "LONG", 50000);
  assert(proxCritical.isTooClose === true && proxCritical.distanceToLiqPct === 0, "Critical warning when SL is below Liq price");

  // 4. ATR Stop Loss: 1.5x ATR
  const atrResult = calculateAtrStopLoss(50000, 1000, "LONG", 1.5, 2.0);
  assert(atrResult.slDistance === 1500, "SL distance is 1.5x ATR (1500)");
  assert(atrResult.stopLossPrice === 48500, "LONG SL is Entry - 1.5x ATR = 48500");
  assert(atrResult.takeProfitPrice === 53000, "LONG TP is Entry + 3000 (2:1 RR) = 53000");

  const atrShort = calculateAtrStopLoss(50000, 1000, "SHORT", 1.5, 2.0);
  assert(atrShort.stopLossPrice === 51500, "SHORT SL is Entry + 1.5x ATR = 51500");
  assert(atrShort.takeProfitPrice === 47000, "SHORT TP is Entry - 3000 = 47000");

  // 5. evaluateTrailingStopLoss (Break-Even at 1:1 RR)
  const mockTrade: ManagedTrade = {
    id: "trade-1",
    symbol: "BTCUSDT",
    marketType: "Futures",
    direction: "LONG",
    leverage: 5,
    entryPrice: 50000,
    quantity: 0.1,
    positionValue: 5000,
    stopLossPrice: 48500, // Initial risk = 1500
    takeProfitPrice: 53000,
    initialStopLoss: 48500,
    trailingSlTriggered: false,
    atrAtEntry: 1000,
    openTime: Date.now(),
    status: "OPEN",
    orderType: "LIMIT",
  };

  // Price at 51000 (reward 1000 < initial risk 1500) -> should not trigger
  const trailNo = evaluateTrailingStopLoss(51000, mockTrade);
  assert(trailNo.shouldUpdateSl === false, "Trailing SL does not trigger before 1:1 RR target");

  // Price reaches 51500 (reward 1500 >= initial risk 1500) -> should move SL to break-even (50000)
  const trailYes = evaluateTrailingStopLoss(51500, mockTrade);
  assert(trailYes.shouldUpdateSl === true, "Trailing SL triggers at 1:1 RR target");
  assert(trailYes.newStopLoss === 50000, "Trailing SL sets stop loss to break-even (50000)");

  // 6. Circuit Breaker & Profit Vault in BinanceAutoTradeEngine
  const engine = new BinanceAutoTradeEngine();
  engine.saveConfig({ disclaimerAgreed: true, profitVaultEnabled: true, maxOpenTrades: 2 });
  engine.resetCircuitBreaker();

  // Push trade into engine so closeTrade finds it
  (engine as unknown as { trades: ManagedTrade[] }).trades.push({ ...mockTrade, id: "mock-trade-1" });
  const closedLoss1 = engine.closeTrade("mock-trade-1", 48500, "SL");
  assert(closedLoss1 !== null && engine.getCircuitBreaker().consecutiveLosses >= 0, "Engine circuit breaker initialized");

  // 7. Post-Loss Cooldown (30 minutes)
  engine.clearPostLossCooldown();
  assert(engine.getPostLossCooldown().isActive === false, "Cooldown inactive after clear");
  // Trigger cooldown
  const now = Date.now();
  // Simulate SL close directly on a managed trade inside engine
  const tradeToClose: ManagedTrade = {
    ...mockTrade,
    id: "trade-sl-test",
    openTime: now - 10000,
  };
  (engine as unknown as { trades: ManagedTrade[] }).trades.push(tradeToClose);
  engine.closeTrade("trade-sl-test", 48000, "SL");
  const cooldownState = engine.getPostLossCooldown();
  assert(cooldownState.isActive === true, "Post-loss cooldown active after trade hits SL");
  assert(cooldownState.remainingSeconds > 1700 && cooldownState.remainingSeconds <= 1800, "Cooldown set to ~30 minutes (1800 seconds)");

  // 8. Swarm Risk Manager Veto
  // Should NO-GO if spread is bad (> 0.1%)
  const swarmSpreadVeto = simulateSwarmDebate({
    symbol: "ETHUSDT",
    price: 3000,
    spreadPct: 0.15,
  });
  assert(swarmSpreadVeto.verdict === "NO-GO", "Risk Manager vetoes trade on excessive spread (>0.1%)");

  // Should NO-GO if volatility is extreme (ATR > 3% of price)
  const swarmVolVeto = simulateSwarmDebate({
    symbol: "SOLUSDT",
    price: 100,
    atrValue: 4.5,
  });
  assert(swarmVolVeto.verdict === "NO-GO", "Risk Manager vetoes trade on extreme ATR volatility");

  // Should GO when confluence is strong and risk checks pass
  const swarmGo = simulateSwarmDebate({
    symbol: "BTCUSDT",
    price: 50000,
    trend: "uptrend",
    patternDirection: "bullish",
    rsi: 50,
    spreadPct: 0.02,
    atrValue: 500,
  });
  assert(swarmGo.verdict === "GO", "Risk Manager issues GO verdict when confluence is verified and risk metrics pass");

  // 9. Dynamic Confluence Scaling
  // Normal ATR (1% of price) -> required score is 85
  const normalConfluence = engine.getRequiredConfluenceScore(50000, 500);
  assert(normalConfluence.requiredScore === 85, "Required confluence score is 85 in normal market volatility");

  // High ATR (3% of price) -> required score scales dynamically to 95
  const highVolConfluence = engine.getRequiredConfluenceScore(50000, 1500);
  assert(highVolConfluence.requiredScore === 95, "Required confluence score dynamically scales to 95 on high ATR volatility");

  // 10. Duplicate Protection (< 5 Minutes)
  const dupCheck1 = engine.checkDuplicateProtection("BTCUSDT");
  assert(dupCheck1.allowed === false, "Duplicate protection blocks BTCUSDT because trade was opened within 5 minutes");

  const dupCheck2 = engine.checkDuplicateProtection("XRPUSDT");
  assert(dupCheck2.allowed === true, "Duplicate protection allows new coin XRPUSDT not traded recently");

  // 11. Daily Drawdown Circuit Breaker
  const initialDrawdown = engine.getDailyDrawdown();
  assert(initialDrawdown.maxDailyLossPercent === 3.0, "Default max daily loss percent is 3.0%");
  assert(typeof initialDrawdown.drawdownPct === "number", "Drawdown percentage calculated");

  // 12. Paper Trading Simulation Engine
  paperTradingEngine.resetAccount(10000);
  const pAcc = paperTradingEngine.getAccount();
  assert(pAcc.balance === 10000, "Paper trading account starts with virtual $10,000");

  const pOrder = paperTradingEngine.executeOrder({
    symbol: "ETHUSDT",
    entryPrice: 3000,
    atrValue: 50,
    direction: "LONG",
    riskPercent: 2,
  });
  assert(pOrder.success === true && pOrder.trade !== undefined, "Paper order successfully executed virtually");
  assert(paperTradingEngine.getOpenTrades().length === 1, "Paper open trades contains 1 position");

  // Simulate close with profit
  paperTradingEngine.closeTrade(pOrder.trade!.id, 3100, "TP");
  assert(paperTradingEngine.getOpenTrades().length === 0, "Paper open trades cleared after close");
  assert(paperTradingEngine.getAccount().winCount === 1, "Paper win count incremented");
  assert(paperTradingEngine.getAccount().balance > 10000, "Paper virtual balance increased after profitable trade");

  console.log(`\nTests completed: ${passed}/${total} passed.`);
}

runTests();
