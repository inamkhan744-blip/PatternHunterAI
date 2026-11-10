import { supabase } from "./supabase";

export type UserRole = "user" | "staff" | "admin";
export type SubscriptionTier = "free" | "pro" | "premium";

export interface UserSubscriptionProfile {
  role: UserRole;
  tier: SubscriptionTier;
  expiresAt: string | null;
  dailyTradeLimit: number;
}

export const ADMIN_BYPASS_EMAIL = "inamkhan744@gmail.com";
export const FREE_DAILY_MANUAL_TRADE_LIMIT = 3;
export type ProDailyTradeLimit = 1 | 5 | 10 | 100;

const STORAGE_KEY_PRO_TRADE_LIMIT = "fortress_pro_daily_trade_limit";
const STORAGE_KEY_DAILY_USAGE = "fortress_daily_trade_tracker";
const STORAGE_KEY_CACHED_PROFILE = "fortress_cached_user_profile";

interface DailyTradeTracker {
  date: string;
  count: number;
}

function getTodayString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isUserAdmin(email?: string | null, userMetadata?: Record<string, unknown>): boolean {
  if (email && email.trim().toLowerCase() === ADMIN_BYPASS_EMAIL.toLowerCase()) return true;
  if (userMetadata?.role === "admin") return true;
  return false;
}

export function isUserPro(
  email?: string | null,
  manualProState: boolean = false,
  userMetadata?: Record<string, unknown>
): boolean {
  if (isUserAdmin(email, userMetadata)) return true;
  if (userMetadata?.subscription_tier === "pro" || userMetadata?.subscription_tier === "premium") return true;
  return Boolean(manualProState);
}

export async function fetchUserProfile(userId?: string): Promise<UserSubscriptionProfile> {
  const defaultProfile: UserSubscriptionProfile = {
    role: "user",
    tier: "free",
    expiresAt: null,
    dailyTradeLimit: FREE_DAILY_MANUAL_TRADE_LIMIT,
  };

  if (!userId) return defaultProfile;

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("role, subscription_tier, subscription_expires_at, daily_trade_limit")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      if (typeof localStorage !== "undefined") {
        const cached = localStorage.getItem(STORAGE_KEY_CACHED_PROFILE);
        if (cached) return JSON.parse(cached);
      }
      return defaultProfile;
    }

    const profile: UserSubscriptionProfile = {
      role: (data.role as UserRole) || "user",
      tier: (data.subscription_tier as SubscriptionTier) || "free",
      expiresAt: data.subscription_expires_at || null,
      dailyTradeLimit: data.daily_trade_limit || (data.subscription_tier === "free" ? FREE_DAILY_MANUAL_TRADE_LIMIT : 100),
    };

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_CACHED_PROFILE, JSON.stringify(profile));
    }
    return profile;
  } catch {
    return defaultProfile;
  }
}

export function getProDailyTradeLimit(): ProDailyTradeLimit {
  try {
    if (typeof localStorage === "undefined") return 100;
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
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY_PRO_TRADE_LIMIT, limit.toString());
  }
}

export function getDailyTradeCount(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
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
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY_DAILY_USAGE);
      if (raw) {
        const parsed: DailyTradeTracker = JSON.parse(raw);
        if (parsed.date === today) {
          currentCount = parsed.count;
        }
      }
    }
  } catch {
    // fallback
  }

  const nextCount = currentCount + 1;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(
      STORAGE_KEY_DAILY_USAGE,
      JSON.stringify({ date: today, count: nextCount })
    );
  }
  return nextCount;
}

export function checkTradeExecutionAllowance(
  email?: string | null,
  isProManual: boolean = false,
  userMetadata?: Record<string, unknown>
): {
  allowed: boolean;
  limit: number;
  current: number;
  reason?: string;
  isPro: boolean;
  isAdmin: boolean;
} {
  const admin = isUserAdmin(email, userMetadata);
  const pro = isUserPro(email, isProManual, userMetadata);
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
        : `Free tier limit of ${FREE_DAILY_MANUAL_TRADE_LIMIT} trades per day reached (${current}/${FREE_DAILY_MANUAL_TRADE_LIMIT}). Upgrade to Pro for high-volume automated trading.`,
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
