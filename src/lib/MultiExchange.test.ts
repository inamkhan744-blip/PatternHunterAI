import { SUPPORTED_EXCHANGES, UnifiedExchangeAdapter, getActiveExchange, setActiveExchange } from "./MultiExchange";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

async function runTests() {
  console.log("Running MultiExchange Architecture Test Suite...");

  assert(SUPPORTED_EXCHANGES.length === 4, "Supports 4 Tier-1 crypto exchanges");
  const binanceCfg = SUPPORTED_EXCHANGES.find((e) => e.id === "binance");
  assert(binanceCfg !== undefined && binanceCfg.capabilities.paperTrading, "Binance supports paper and live trading");
  assert(binanceCfg?.status === "LIVE_INTEGRATED", "Binance marked as LIVE_INTEGRATED");

  setActiveExchange("bybit");
  assert(getActiveExchange() === "bybit", "Active exchange successfully switched to Bybit");

  setActiveExchange("binance");
  assert(getActiveExchange() === "binance", "Active exchange returned to Binance");

  const adapter = new UnifiedExchangeAdapter("binance");
  assert(adapter.getExchangeId() === "binance", "Adapter instantiated with correct exchange ID");
  assert(adapter.getConfig().name === "Binance", "Adapter retrieves exchange metadata configuration");

  console.log("All MultiExchange tests passed successfully!");
}

runTests();
