import {
  isUserAdmin,
  isUserPro,
  checkTradeExecutionAllowance,
  setProDailyTradeLimit,
  getProDailyTradeLimit,
  ProDailyTradeLimit,
  ADMIN_BYPASS_EMAIL,
  getDailyTradeCount,
  incrementDailyTradeCount,
  resetDailyTradeCountIfNewDay,
} from "./SubscriptionManager";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

const mockStorage = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

async function runTests() {
  console.log("Running SubscriptionManager Test Suite...");

  assert(isUserAdmin("user@example.com", { role: "admin" }) === true, "Admin role in metadata grants admin");
  assert(isUserAdmin("user@example.com", { role: "user" }) === false, "Standard user in metadata is not admin");
  assert(isUserAdmin(ADMIN_BYPASS_EMAIL) === true, "Admin bypass email is recognized as admin");
  assert(isUserAdmin("inamkhan744@gmail.com", {}) === true, "Admin email strictly sets isAdmin = true even with empty metadata");
  assert(isUserPro("inamkhan744@gmail.com", false, {}) === true, "Admin email strictly sets isPro = true even with empty metadata");

  assert(isUserPro("user@example.com", false, { role: "admin" }) === true, "Admin role in metadata automatically unlocks Pro");
  assert(isUserPro("user@example.com", false, { subscription_tier: "pro" }) === true, "Pro tier in metadata unlocks Pro");
  assert(isUserPro("user@example.com", false, { subscription_tier: "premium" }) === true, "Premium tier in metadata unlocks Pro");
  assert(isUserPro("user@example.com", false, { subscription_tier: "free" }) === false, "Free tier in metadata is not Pro");

  setProDailyTradeLimit(10 as ProDailyTradeLimit);
  assert(getProDailyTradeLimit() === 10, "Configurable Pro trade limit can be set and retrieved");

  const freeAllowance = checkTradeExecutionAllowance("freeuser@test.com", false);
  assert(freeAllowance.allowed === true, "Free user starts with allowed trade execution");
  assert(freeAllowance.limit === 3, "Free user limit is 3 trades per day");

  const adminAllowance = checkTradeExecutionAllowance("admin@test.com", false, { role: "admin" });
  assert(adminAllowance.isAdmin === true, "Admin user identified from metadata");
  assert(adminAllowance.limit > 900000, "Admin user has uncapped execution allowance");

  const adminEmailAllowance = checkTradeExecutionAllowance("inamkhan744@gmail.com", false);
  assert(adminEmailAllowance.isAdmin === true, "Admin bypass email identified as admin in allowance check");
  assert(adminEmailAllowance.isPro === true, "Admin bypass email identified as pro in allowance check");
  assert(adminEmailAllowance.allowed === true, "Admin bypass email allowed execution");
  assert(adminEmailAllowance.limit > 900000, "Admin bypass email has uncapped execution allowance");

  // Daily reset logic test
  localStorage.setItem("fortress_daily_trade_tracker", JSON.stringify({
    date: "2024-01-01",
    lastTradeDate: "2024-01-01",
    count: 3,
  }));
  const resetCount = resetDailyTradeCountIfNewDay();
  assert(resetCount === 0, "Trade counter resets to 0 when last trade was yesterday / past date");
  assert(getDailyTradeCount() === 0, "getDailyTradeCount() returns 0 after reset");

  incrementDailyTradeCount();
  assert(getDailyTradeCount() === 1, "getDailyTradeCount() increments to 1 for today");

  console.log("All SubscriptionManager tests passed successfully!");
}

runTests();
