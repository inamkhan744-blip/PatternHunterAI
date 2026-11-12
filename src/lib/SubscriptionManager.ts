import { supabase } from "./supabase";

/**
 * Server-trusted subscription & role authority.
 *
 * SECURITY CONTRACT
 * -----------------
 * - Roles and subscription tiers are read ONLY from public.user_profiles through
 *   Row Level Security. No email allow-list, no `user_metadata`, no localStorage
 *   and no URL parameters are ever trusted.
 * - `user_profiles.role` / `subscription_tier` cannot be written by the user: the
 *   UPDATE policy for regular users only permits contact fields, and privileged
 *   changes go through the `admin_*` SECURITY DEFINER RPCs.
 * - Daily trade quotas are consumed atomically on the server by
 *   `consume_trade_quota()`, so client-side counters can never raise a limit.
 * - Everything cached here is display-only; the server re-checks on every write.
 */

export type UserRole = "user" | "staff" | "admin";
export type SubscriptionTier = "free" | "pro" | "premium";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";

export interface UserSubscriptionProfile {
  role: UserRole;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAt: string | null;
  dailyTradeLimit: number;
}

export const FREE_DAILY_MANUAL_TRADE_LIMIT = 3;
export type ProDailyTradeLimit = 1 | 5 | 10 | 100;
export const DEFAULT_PRO_DAILY_TRADE_LIMIT: ProDailyTradeLimit = 100;

export const FREE_PROFILE: UserSubscriptionProfile = {
  role: "user",
  tier: "free",
  status: "active",
  expiresAt: null,
  dailyTradeLimit: FREE_DAILY_MANUAL_TRADE_LIMIT,
};

/** Last profile returned by the server. Display cache only — never an authorization source. */
let activeProfile: UserSubscriptionProfile | null = null;
let activeQuota: TradeAllowance | null = null;

export function setActiveSubscriptionProfile(profile: UserSubscriptionProfile | null): void {
  activeProfile = profile;
}

export function getActiveSubscriptionProfile(): UserSubscriptionProfile | null {
  return activeProfile;
}

export function clearSubscriptionCache(): void {
  activeProfile = null;
  activeQuota = null;
}

/** A subscription only counts while it is active/trialing and not past its expiry. */
export function isSubscriptionActive(profile: UserSubscriptionProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.tier !== "pro" && profile.tier !== "premium") return false;
  if (profile.status !== "active" && profile.status !== "trialing") return false;
  if (profile.expiresAt) {
    const expires = Date.parse(profile.expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) return false;
  }
  return true;
}

/** Admin status comes from the server profile row only. */
export function isUserAdmin(profile: UserSubscriptionProfile | null | undefined): boolean {
  return profile?.role === "admin";
}

/** Pro status comes from the server profile row only (admins also get Pro tooling). */
export function isUserPro(profile: UserSubscriptionProfile | null | undefined): boolean {
  if (isUserAdmin(profile)) return true;
  return isSubscriptionActive(profile);
}

function normalizeProfile(row: Record<string, unknown>): UserSubscriptionProfile {
  const tier = (row.subscription_tier as SubscriptionTier) || "free";
  const limit = Number(row.daily_trade_limit);
  return {
    role: (row.role as UserRole) || "user",
    tier,
    status: (row.subscription_status as SubscriptionStatus) || "active",
    expiresAt: (row.subscription_expires_at as string | null) ?? null,
    dailyTradeLimit:
      Number.isFinite(limit) && limit > 0
        ? limit
        : tier === "free"
          ? FREE_DAILY_MANUAL_TRADE_LIMIT
          : DEFAULT_PRO_DAILY_TRADE_LIMIT,
  };
}

/**
 * Reads the caller's own profile via RLS. Returns the free profile when the user
 * is anonymous, the table is unreachable, or no row exists yet.
 */
export async function fetchUserProfile(userId?: string): Promise<UserSubscriptionProfile> {
  if (!userId) {
    activeProfile = null;
    return FREE_PROFILE;
  }

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("role, subscription_tier, subscription_status, subscription_expires_at, daily_trade_limit")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      activeProfile = null;
      return FREE_PROFILE;
    }

    const profile = normalizeProfile(data as Record<string, unknown>);
    activeProfile = profile;
    return profile;
  } catch {
    activeProfile = null;
    return FREE_PROFILE;
  }
}

export interface TradeAllowance {
  allowed: boolean;
  limit: number;
  current: number;
  isPro: boolean;
  isAdmin: boolean;
  reason?: string;
}

function normalizeAllowance(raw: Record<string, unknown> | null): TradeAllowance {
  const isAdmin = raw?.isAdmin === true;
  const isPro = raw?.isPro === true || isAdmin;
  const limit = Number(raw?.limit);
  const current = Number(raw?.current);
  return {
    allowed: raw?.allowed === true,
    limit: Number.isFinite(limit) ? limit : FREE_DAILY_MANUAL_TRADE_LIMIT,
    current: Number.isFinite(current) ? current : 0,
    isPro,
    isAdmin,
    reason: typeof raw?.reason === "string" ? raw.reason : undefined,
  };
}

/**
 * Server-side quota check. With `consume: true` the server atomically increments
 * today's usage counter and refuses once the tier limit is reached. The returned
 * decision is authoritative — never derive it from cached numbers.
 */
export async function checkTradeExecutionAllowance(options: { consume?: boolean } = {}): Promise<TradeAllowance> {
  const rpc = options.consume === false ? "get_trade_quota" : "consume_trade_quota";

  try {
    const { data, error } = await supabase.rpc(rpc);
    if (error || !data) {
      return {
        allowed: false,
        limit: 0,
        current: 0,
        isPro: false,
        isAdmin: false,
        reason: "Unable to verify your trade allowance with the server. Please sign in and try again.",
      };
    }
    const allowance = normalizeAllowance(data as Record<string, unknown>);
    activeQuota = allowance;
    return allowance;
  } catch {
    return {
      allowed: false,
      limit: 0,
      current: 0,
      isPro: false,
      isAdmin: false,
      reason: "Unable to verify your trade allowance with the server. Please sign in and try again.",
    };
  }
}

/** Read-only quota snapshot used for UI counters. */
export async function refreshTradeQuota(): Promise<TradeAllowance> {
  return checkTradeExecutionAllowance({ consume: false });
}

export function getLastKnownTradeAllowance(): TradeAllowance | null {
  return activeQuota;
}

export function getDailyTradeCount(): number {
  return activeQuota?.current ?? 0;
}

export function getDailyTradeLimit(): number {
  if (activeQuota) return activeQuota.limit;
  if (isUserAdmin(activeProfile)) return 1000000;
  return isUserPro(activeProfile) ? getProDailyTradeLimit() : FREE_DAILY_MANUAL_TRADE_LIMIT;
}

/** Pro daily limit is a server-side profile field an admin can set for the whole tier. */
export function getProDailyTradeLimit(): ProDailyTradeLimit {
  const configured = activeProfile?.dailyTradeLimit ?? DEFAULT_PRO_DAILY_TRADE_LIMIT;
  return ([1, 5, 10, 100] as const).includes(configured as ProDailyTradeLimit)
    ? (configured as ProDailyTradeLimit)
    : DEFAULT_PRO_DAILY_TRADE_LIMIT;
}

/**
 * Updates the default Pro daily limit. The RPC enforces `is_admin()` server-side,
 * so this simply fails for non-admins.
 */
export async function setProDailyTradeLimit(limit: ProDailyTradeLimit): Promise<boolean> {
  if (![1, 5, 10, 100].includes(limit)) return false;
  try {
    const { data, error } = await supabase.rpc("admin_set_pro_daily_limit", { p_limit: limit });
    if (error || data !== true) return false;
    if (activeProfile) {
      activeProfile = {
        ...activeProfile,
        dailyTradeLimit: limit,
      };
    }
    return true;
  } catch {
    return false;
  }
}

/** Backwards-compatible helper: returns 0 because usage is tracked server-side. */
export function resetDailyTradeCountIfNewDay(): number {
  return 0;
}
