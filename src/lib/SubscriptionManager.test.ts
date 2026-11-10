import { isUserAdmin, isUserPro, checkTradeExecutionAllowance, setProDailyTradeLimit, getProDailyTradeLimit } from "./SubscriptionManager";

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
  console.log("Running SubscriptionManager Test Suite...");

  assert(isUserAdmin("user@example.com", { role: "admin" }) === true, "Admin role in metadata grants admin");
  assert(isUserAdmin("user@example.com", { role: "user" }) === false, "Standard user in metadata is not admin");

  assert(isUserPro("user@example.com", false, { subscription_tier: "pro" }) === true, "Pro tier in metadata unlocks Pro");
  assert(isUserPro("user@example.com", false, { subscription_tier: "premium" }) === true, "Premium tier in metadata unlocks Pro");
  assert(isUserPro("user@example.com", false, { subscription_tier: "free" }) === false, "Free tier in metadata is not Pro");

  setProDailyTradeLimit(50 as any);
  setProDailyTradeLimit(10);
  assert(getProDailyTradeLimit() === 10, "Configurable Pro trade limit can be set and retrieved");

  const freeAllowance = checkTradeExecutionAllowance("freeuser@test.com", false);
  assert(freeAllowance.allowed === true, "Free user starts with allowed trade execution");
  assert(freeAllowance.limit === 3, "Free user limit is 3 trades per day");

  const adminAllowance = checkTradeExecutionAllowance("admin@test.com", false, { role: "admin" });
  assert(adminAllowance.isAdmin === true, "Admin user identified from metadata");
  assert(adminAllowance.limit > 900000, "Admin user has uncapped execution allowance");

  console.log("All SubscriptionManager tests passed successfully!");
}

runTests();
