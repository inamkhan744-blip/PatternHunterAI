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
  /** Mirrors `user_profiles.is_admin`, which some deployments use instead of `role`. */
  adminFlag: boolean;
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
  adminFlag: false,
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

/**
 * Admin status comes from the server profile row only. Both representations are
 * honoured because `role = 'admin'` and `is_admin = true` are set independently in
 * different dashboards/migrations.
 */
export function isUserAdmin(profile: UserSubscriptionProfile | null | undefined): boolean {
  if (!profile) return false;
  return profile.adminFlag === true || profile.role === "admin";
}

/** Pro status comes from the server profile row only (admins also get Pro tooling). */
export function isUserPro(profile: UserSubscriptionProfile | null | undefined): boolean {
  if (isUserAdmin(profile)) return true;
  return isSubscriptionActive(profile);
}

function normalizeRole(value: unknown): UserRole {
  const role = typeof value === "string" ? value.toLowerCase() : "";
  return role === "admin" || role === "staff" ? (role as UserRole) : "user";
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeProfile(row: Record<string, unknown>): UserSubscriptionProfile {
  const tier = (row.subscription_tier as SubscriptionTier) || "free";
  const limit = Number(row.daily_trade_limit);
  return {
    role: normalizeRole(row.role),
    // A row with `is_admin = true` is an admin even if `role` was never updated.
    adminFlag: isTruthyFlag(row.is_admin),
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
 * Reads the caller's own profile via RLS.
 *
 * `select("*")` is deliberate: a deployment may or may not have an `is_admin`
 * column, and naming a missing column makes PostgREST fail the whole request — which
 * is exactly how a real admin silently ends up on the free tier.
 *
 * A transient failure never downgrades a known admin: the last good profile is kept.
 */
export async function fetchUserProfile(
  userId?: string,
  email?: string | null
): Promise<UserSubscriptionProfile> {
  if (!userId) {
    activeProfile = null;
    return FREE_PROFILE;
  }

  const readRow = async (column: "id" | "user_id") => {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq(column, userId)
      .maybeSingle();
    return { data, error };
  };

  let row: Record<string, unknown> | null = null;
  let lastError: string | null = null;

  // Attempt 1 — canonical key. Retried once because a cold token refresh can race
  // the first request after login.
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    const { data, error } = await readRow("id");
    if (data) {
      row = data as Record<string, unknown>;
      break;
    }
    if (error) lastError = error.message;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // Attempt 2 — some installations key the table on `user_id` instead of `id`.
  if (!row) {
    const { data, error } = await readRow("user_id");
    if (data) row = data as Record<string, unknown>;
    else if (error) lastError = error.message;
  }

  // Attempt 3 — match on the authenticated email (RLS still decides visibility).
  if (!row && email) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (data) row = data as Record<string, unknown>;
    else if (error) lastError = error.message;
  }

  if (!row) {
    if (lastError) {
      console.warn("[SubscriptionManager] profile lookup failed:", lastError);
    } else {
      console.warn(
        "[SubscriptionManager] No user_profiles row is visible for the signed-in user. " +
          "Admin/Pro flags cannot be applied until a row exists whose id (or user_id) equals the auth user id."
      );
    }
    // Keep a previously resolved admin/pro profile rather than downgrading on a
    // slow or failed fetch.
    return activeProfile ?? FREE_PROFILE;
  }

  const profile = normalizeProfile(row);
  activeProfile = profile;
  return profile;
}

/** Admins are never quota-limited; this is the number shown as "infinity" in the UI. */
export const ADMIN_TRADE_ALLOWANCE_LIMIT = 1000000;

export interface TradeAllowance {
  allowed: boolean;
  limit: number;
  current: number;
  isPro: boolean;
  isAdmin: boolean;
  reason?: string;
  /** True when the server could not be reached and this is a cached/fallback decision. */
  stale?: boolean;
  /** Non-blocking notice for the UI (shown as a small warning, never a hard error). */
  warning?: string;
}

function normalizeAllowance(raw: Record<string, unknown> | null): TradeAllowance {
  const isAdmin = raw?.isAdmin === true;
  const isPro = raw?.isPro === true || isAdmin;
  const limit = Number(raw?.limit);
  const current = Number(raw?.current);
  return {
    allowed: raw?.allowed === true || isAdmin,
    limit: Number.isFinite(limit) ? limit : FREE_DAILY_MANUAL_TRADE_LIMIT,
    current: Number.isFinite(current) ? current : 0,
    isPro,
    isAdmin,
    reason: typeof raw?.reason === "string" ? raw.reason : undefined,
  };
}

/**
 * Makes sure an access token is present before a quota RPC.
 * An expired session is refreshed silently; a missing refresh token means the user
 * really is signed out.
 */
async function ensureAuthSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) return true;
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) return false;
    return Boolean(refreshed.session);
  } catch {
    return false;
  }
}

/**
 * Server-side quota check. With `consume: true` the server atomically increments
 * today's usage counter and refuses once the tier limit is reached. The returned
 * decision is authoritative — never derive it from cached numbers.
 *
 * Admins short-circuit before any network call: their tooling must never depend on
 * backend latency or availability. Read-only checks (`consume: false`) degrade to the
 * last known allowance instead of blocking the UI when the backend is unreachable;
 * consuming checks always fail closed so a quota cannot be bypassed by an outage.
 */
export async function checkTradeExecutionAllowance(options: { consume?: boolean } = {}): Promise<TradeAllowance> {
  const consume = options.consume !== false;

  // Admin bypass — no session lookup, no RPC, no waiting.
  if (isUserAdmin(activeProfile)) {
    const allowance: TradeAllowance = {
      allowed: true,
      limit: ADMIN_TRADE_ALLOWANCE_LIMIT,
      current: activeQuota?.current ?? 0,
      isPro: true,
      isAdmin: true,
    };
    activeQuota = allowance;
    return allowance;
  }

  const rpc = consume ? "consume_trade_quota" : "get_trade_quota";
  const readQuota = async (): Promise<TradeAllowance | null> => {
    const { data, error } = await supabase.rpc(rpc);
    if (error || !data) return null;
    return normalizeAllowance(data as Record<string, unknown>);
  };

  let failure: string | null = null;
  try {
    if (await ensureAuthSession()) {
      let fresh = await readQuota();
      if (!fresh) {
        // One silent refresh + retry covers a token that expired mid-session.
        const { error } = await supabase.auth.refreshSession();
        if (!error) fresh = await readQuota();
      }
      // The server response also wins when it reports admin (stale client profile).
      if (fresh) {
        activeQuota = fresh;
        return fresh;
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) console.warn("[SubscriptionManager] trade allowance check failed:", failure);

  // Read-only UI counters: keep the last known quota instead of blocking the terminal.
  if (!consume && activeQuota) {
    return {
      ...activeQuota,
      stale: true,
      warning: "Trade allowance could not be refreshed. Showing your last known quota.",
    };
  }

  return {
    allowed: false,
    limit: activeQuota?.limit ?? FREE_DAILY_MANUAL_TRADE_LIMIT,
    current: activeQuota?.current ?? 0,
    isPro: isUserPro(activeProfile),
    isAdmin: false,
    stale: true,
    reason: "Trade allowance could not be verified with the server.",
    warning: "Allowance check unavailable. Sign in again, then retry.",
  };
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
