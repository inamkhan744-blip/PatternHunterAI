import {
  FREE_PROFILE,
  FREE_DAILY_MANUAL_TRADE_LIMIT,
  isUserAdmin,
  isUserPro,
  isSubscriptionActive,
  getProDailyTradeLimit,
  setActiveSubscriptionProfile,
  clearSubscriptionCache,
  type UserSubscriptionProfile,
} from "./SubscriptionManager";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${msg}`);
}

function profile(overrides: Partial<UserSubscriptionProfile> = {}): UserSubscriptionProfile {
  return { ...FREE_PROFILE, ...overrides };
}

async function runTests() {
  console.log("Running SubscriptionManager (server-trusted) Test Suite...");

  // --- Admin is decided by the profile row only -------------------------
  assert(isUserAdmin(profile({ role: "admin" })) === true, "role=admin in user_profiles grants admin");
  assert(
    isUserAdmin(profile({ role: "user", adminFlag: true })) === true,
    "is_admin=true grants admin even when role was never updated"
  );
  assert(isUserAdmin(profile({ role: "user", adminFlag: false })) === false, "role=user is not admin");
  assert(isUserAdmin(null) === false, "Missing profile is not admin");

  // There is no email allow-list or metadata path any more.
  const manager = await import("./SubscriptionManager");
  assert(
    !("ADMIN_BYPASS_EMAIL" in manager),
    "Email-based admin bypass constant has been removed"
  );
  assert(
    (manager.isUserAdmin as unknown as { length: number }).length <= 1,
    "isUserAdmin accepts a profile only (no email/metadata arguments)"
  );

  // --- Subscription entitlement -----------------------------------------
  const activePro = profile({ tier: "pro", status: "active" });
  assert(isSubscriptionActive(activePro) === true, "Active Pro subscription is entitled");
  assert(isUserPro(activePro) === true, "Active Pro subscription unlocks Pro");

  assert(
    isSubscriptionActive(profile({ tier: "pro", status: "canceled" })) === false,
    "Canceled subscription is not entitled"
  );
  assert(
    isSubscriptionActive(profile({ tier: "premium", status: "past_due" })) === false,
    "Past-due subscription is not entitled"
  );
  assert(
    isSubscriptionActive(profile({ tier: "pro", status: "active", expiresAt: "2020-01-01T00:00:00Z" })) === false,
    "Expired subscription is not entitled"
  );
  assert(isUserPro(profile({ tier: "free" })) === false, "Free tier is not Pro");
  assert(isUserPro(profile({ role: "admin", tier: "free" })) === true, "Admins get Pro tooling");

  // --- Limits come from the server profile ------------------------------
  assert(FREE_DAILY_MANUAL_TRADE_LIMIT === 3, "Free tier daily limit is 3");
  clearSubscriptionCache();
  assert(getProDailyTradeLimit() === 100, "Default Pro limit is 100 when no profile is loaded");

  setActiveSubscriptionProfile(profile({ tier: "pro", status: "active", dailyTradeLimit: 10 }));
  assert(getProDailyTradeLimit() === 10, "Pro limit follows the server profile value");

  setActiveSubscriptionProfile(profile({ tier: "pro", status: "active", dailyTradeLimit: 7 }));
  assert(getProDailyTradeLimit() === 100, "Unsupported limit values fall back to the default");

  clearSubscriptionCache();
  assert(getProDailyTradeLimit() === 100, "Clearing the cache removes the cached profile");

  console.log("All SubscriptionManager tests passed successfully!");
}

runTests();
