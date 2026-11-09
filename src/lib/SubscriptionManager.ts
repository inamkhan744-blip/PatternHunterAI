/**
 * Subscription Manager & Admin Bypass Engine
 *
 * Rules:
 * - Admin bypass: if user's email is inamkhan744@gmail.com, automatically unlock all Pro features for free.
 * - Free users:
 *    - Lock Auto-Pilot
 *    - Hide Telegram settings
 *    - Limit manual trades to 3 per day
 * - Pro users:
 *    - Configurable Daily Trade Limit (dropdown: 1, 5, 10, 100)
 *    - Unlocked Auto-Pilot
 *    - Full Telegram settings access
 */

export const ADMIN_BYPASS_EMAIL = "inamkhan744@gmail.com";
export const FREE_DAILY_MANUAL_TRADE_LIMIT = 3;
export type ProDailyTradeLimit = 1 | 5 | 10 | 100;

const STORAGE_KEY_PRO_TRADE_LIMIT = "fortress_pro_daily_trade_limit";
const STORAGE_KEY_DAILY_USAGE = "fortress_daily_trade_tracker";

interface DailyTradeTracker {
  date: string; // YYYY-MM-DD
  count: number;
}

function getTodayString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isUserAdmin(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_BYPASS_EMAIL.toLowerCase();
}

export function isUserPro(email?: string | null, manualProState: boolean = false): boolean {
  if (isUserAdmin(email)) {
    return true;
  }
  return manualProState;
}

export function getProDailyTradeLimit(): ProDailyTradeLimit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRO_TRADE_LIMIT);
    if (raw) {
      const val = parseInt(raw, 10);
      if ([1, 5, 10, 100].includes(val)) {
        return val as ProDailyTradeLimit;
      }
    }
  } catch {
    // fallback
  }
  return 100;
}

export function setProDailyTradeLimit(limit: ProDailyTradeLimit): void {
  localStorage.setItem(STORAGE_KEY_PRO_TRADE_LIMIT, limit.toString());
}

export function getDailyTradeCount(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DAILY_USAGE);
    if (raw) {
      const parsed: DailyTradeTracker = JSON.parse(raw);
      if (parsed.date === getTodayString()) {
        return parsed.count;
      }
    }
  } catch {
    // fallback
  }
  return 0;
}

export function incrementDailyTradeCount(): number {
  const today = getTodayString();
  let currentCount = 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DAILY_USAGE);
    if (raw) {
      const parsed: DailyTradeTracker = JSON.parse(raw);
      if (parsed.date === today) {
        currentCount = parsed.count;
      }
    }
  } catch {
    // fallback
  }

  const nextCount = currentCount + 1;
  localStorage.setItem(
    STORAGE_KEY_DAILY_USAGE,
    JSON.stringify({ date: today, count: nextCount })
  );
  return nextCount;
}

export function checkTradeExecutionAllowance(email?: string | null, isProManual: boolean = false): {
  allowed: boolean;
  limit: number;
  current: number;
  reason?: string;
  isPro: boolean;
  isAdmin: boolean;
} {
  const admin = isUserAdmin(email);
  const pro = isUserPro(email, isProManual);
  const current = getDailyTradeCount();

  if (admin) {
    return {
      allowed: true,
      limit: 999999,
      current,
      isPro: true,
      isAdmin: true,
    };
  }

  const limit = pro ? getProDailyTradeLimit() : FREE_DAILY_MANUAL_TRADE_LIMIT;

  if (current >= limit) {
    return {
      allowed: false,
      limit,
      current,
      reason: pro
        ? `Pro daily trade limit reached (${current}/${limit}). Increase limit in Settings or wait until UTC midnight.`
        : `Free tier limit of ${FREE_DAILY_MANUAL_TRADE_LIMIT} trades per day reached (${current}/${FREE_DAILY_MANUAL_TRADE_LIMIT}). Upgrade to Pro or sign in as Admin for unlimited trading.`,
      isPro: pro,
      isAdmin: false,
    };
  }

  return {
    allowed: true,
    limit,
    current,
    isPro: pro,
    isAdmin: false,
  };
}
