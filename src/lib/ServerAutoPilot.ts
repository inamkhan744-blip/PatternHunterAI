/**
 * Server-side Auto-Pilot client.
 *
 * The execution loop lives in the `auto-trade-worker` edge function and runs
 * every minute regardless of whether any device is online. The browser only:
 *   1. reads `user_profiles.auto_pilot_enabled` (its own row, via RLS), and
 *   2. toggles it through the `set_auto_pilot_enabled` RPC.
 *
 * Clients hold SELECT-only rights on `user_profiles`, which is why the toggle is
 * an RPC rather than a direct UPDATE.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface ServerAutoPilotConfig {
  symbols?: string[];
  timeframe?: "15m" | "30m" | "1h" | "4h";
  marketType?: "Spot" | "Futures";
  leverage?: number;
  riskPercent?: number;
  maxOpenTrades?: number;
  tradeDirectionMode?: "BOTH" | "LONG_ONLY" | "SHORT_ONLY";
  minScore?: number;
  paperTrading?: boolean;
}

export interface ServerAutoPilotState {
  enabled: boolean;
  config: ServerAutoPilotConfig;
}

const DEFAULT_STATE: ServerAutoPilotState = { enabled: false, config: {} };

function normalizeConfig(raw: unknown): ServerAutoPilotConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as ServerAutoPilotConfig;
}

/**
 * Reads the caller's Auto-Pilot flag. The explicit `id` filter matters: admins can
 * see every profile row, so an unfiltered `maybeSingle()` would fail for them.
 */
export async function fetchServerAutoPilotState(userId?: string): Promise<ServerAutoPilotState | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("auto_pilot_enabled, auto_pilot_config")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[ServerAutoPilot] state lookup failed:", error.message);
      return null;
    }
    if (!data) return null;

    return {
      enabled: data.auto_pilot_enabled === true,
      config: normalizeConfig(data.auto_pilot_config),
    };
  } catch (err) {
    console.warn(
      "[ServerAutoPilot] state lookup threw:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Toggles server Auto-Pilot for the signed-in user.
 *
 * `userId` is sent as `p_user_id` because `auth.uid()` can resolve to NULL when
 * the project is called with a publishable key. The RPC treats it purely as a
 * hint: it resolves the caller from the JWT subject and refuses a mismatch, so
 * this can never change another account's flag.
 *
 * Returns false when the RPC refused or failed.
 */
export async function setServerAutoPilotEnabled(
  userId: string | undefined,
  enabled: boolean,
  config?: ServerAutoPilotConfig
): Promise<boolean> {
  if (!userId) {
    console.warn("[ServerAutoPilot] toggle skipped: no authenticated user id");
    return false;
  }
  try {
    const { data, error } = await supabase.rpc("set_auto_pilot_enabled", {
      p_user_id: userId,
      p_enabled: enabled,
      p_config: config ?? null,
    });
    if (error) {
      console.warn("[ServerAutoPilot] toggle failed:", error.message);
      return false;
    }
    const result = data as { success?: boolean; error?: string } | null;
    if (result?.success !== true) {
      console.warn("[ServerAutoPilot] toggle refused:", result?.error ?? "unknown reason");
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      "[ServerAutoPilot] toggle threw:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * Keeps the server flag in sync with the UI. The flag is re-read on mount, when
 * the signed-in user changes, and whenever the tab becomes visible again, so a
 * stale local copy can never silently start a browser-side loop.
 */
export function useServerAutoPilot(user: User | null): {
  enabled: boolean;
  config: ServerAutoPilotConfig;
  loading: boolean;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean, config?: ServerAutoPilotConfig) => Promise<boolean>;
} {
  const [state, setState] = useState<ServerAutoPilotState>(DEFAULT_STATE);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setState(DEFAULT_STATE);
      loadedOnce.current = false;
      setLoading(false);
      return;
    }
    if (!loadedOnce.current) setLoading(true);
    try {
      const next = await fetchServerAutoPilotState(user?.id);
      if (next) setState(next);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.id || typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, user?.id]);

  const setEnabled = useCallback(
    async (enabled: boolean, config?: ServerAutoPilotConfig) => {
      const ok = await setServerAutoPilotEnabled(user?.id, enabled, config);
      if (ok) {
        setState((prev) => ({
          enabled,
          config: { ...prev.config, ...(config ?? {}) },
        }));
      }
      return ok;
    },
    [user?.id]
  );

  return { enabled: state.enabled, config: state.config, loading, refresh, setEnabled };
}
