/**
 * TradeManager.test.ts
 *
 * Unit tests for TradeManager:
 * - Trade persistence (addTrade, closeTrade)
 * - Separation of Real and Paper trades (is_paper flag)
 * - Supabase payload formatting
 * - Realtime payload handling (INSERT, UPDATE, DELETE)
 * - Multi-device remote trade merging
 */

import assert from "assert";
import { tradeManager, TradeManager } from "./TradeManager";

console.log("Starting TradeManager Sync & Realtime Tests...");

// Clean slate
tradeManager.closeAllTrades("MANUAL");
assert.strictEqual(tradeManager.getActiveTrades().length, 0, "Initial active trades should be empty");

// Test 1: Paper trade addition
const paperTrade = tradeManager.addTrade({
  symbol: "BTCUSDT",
  entryPrice: 65000,
  quantity: 0.1,
  direction: "LONG",
  mode: "PAPER",
  source: "AUTO-PILOT",
  customId: "TRD-TEST-PAPER-1",
});

assert(paperTrade !== null, "Paper trade should be created");
assert.strictEqual(paperTrade?.mode, "PAPER", "Mode should be PAPER");
assert.strictEqual(tradeManager.hasActivePosition("BTCUSDT"), true, "hasActivePosition should return true for BTCUSDT");

// Test 2: Duplicate position guard
const duplicateTrade = tradeManager.addTrade({
  symbol: "BTCUSDT",
  entryPrice: 65100,
  quantity: 0.1,
  direction: "LONG",
  mode: "PAPER",
});
assert.strictEqual(duplicateTrade, null, "Duplicate trade for same symbol should be blocked");

// Test 3: Real trade addition for another symbol
const realTrade = tradeManager.addTrade({
  symbol: "ETHUSDT",
  entryPrice: 3500,
  quantity: 1,
  direction: "SHORT",
  mode: "REAL",
  source: "MANUAL",
  customId: "TRD-TEST-REAL-2",
});

assert(realTrade !== null, "Real trade should be created");
assert.strictEqual(realTrade?.mode, "REAL", "Mode should be REAL");
assert.strictEqual(tradeManager.getActiveTrades().length, 2, "Active trades count should be 2");

// Test 4: Realtime INSERT payload processing
const instance = new TradeManager();
// Clear existing in new instance
instance.closeAllTrades("MANUAL");

instance.handleRealtimePayload({
  eventType: "INSERT",
  new: {
    id: "TRD-REMOTE-1",
    symbol: "SOLUSDT",
    direction: "LONG",
    entry_price: 150,
    status: "OPEN",
    pnl: 0,
    pnl_percent: 0,
    quantity: 10,
    leverage: 1,
    market_type: "Spot",
    stop_loss_price: 140,
    take_profit_price: 170,
    is_paper: true,
    created_at: new Date().toISOString(),
  },
  old: {},
});

const solTrade = instance.getActiveTrades().find((t) => t.id === "TRD-REMOTE-1");
assert(solTrade !== undefined, "Remote trade should be merged into active trades");
assert.strictEqual(solTrade?.symbol, "SOLUSDT");
assert.strictEqual(solTrade?.mode, "PAPER", "is_paper: true should map to mode: PAPER");
assert.strictEqual(solTrade?.entryPrice, 150);

// Test 5: Realtime UPDATE to CLOSED
instance.handleRealtimePayload({
  eventType: "UPDATE",
  new: {
    id: "TRD-REMOTE-1",
    symbol: "SOLUSDT",
    direction: "LONG",
    entry_price: 150,
    exit_price: 165,
    status: "CLOSED",
    pnl: 150,
    pnl_percent: 10,
    quantity: 10,
    exit_reason: "TP",
    is_paper: true,
    created_at: new Date(Date.now() - 60000).toISOString(),
    closed_at: new Date().toISOString(),
  },
  old: {
    id: "TRD-REMOTE-1",
    status: "OPEN",
  },
});

assert.strictEqual(instance.getActiveTrades().some((t) => t.id === "TRD-REMOTE-1"), false, "Trade should be removed from active");
const closedSol = instance.getTradeHistory().find((t) => t.id === "TRD-REMOTE-1");
assert(closedSol !== undefined, "Closed trade should be in trade history");
assert.strictEqual(closedSol?.exitPrice, 165);
assert.strictEqual(closedSol?.realizedPnl, 150);
assert.strictEqual(closedSol?.exitReason, "TP");
assert.strictEqual(closedSol?.mode, "PAPER");

// Test 6: Realtime DELETE
instance.handleRealtimePayload({
  eventType: "DELETE",
  new: {},
  old: {
    id: "TRD-REMOTE-1",
  },
});
assert.strictEqual(instance.getTradeHistory().some((t) => t.id === "TRD-REMOTE-1"), false, "Deleted trade should be removed from history");

// Clean up
tradeManager.closeAllTrades("MANUAL");
instance.closeAllTrades("MANUAL");

console.log("All TradeManager sync tests passed successfully!");
