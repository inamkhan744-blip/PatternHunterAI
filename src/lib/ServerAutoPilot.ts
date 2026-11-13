/**
 * Server-side Auto-Pilot client.
 *
 * The execution loop lives in the `auto-trade-worker` edge function and runs
 * every minute regardless of whether any device is online. The browser only:
 *   1. reads `user_profiles.auto_pilot_enabled` (its own row, via RLS), and
 *   2. toggles it through the `toggle_auto_pilot` RPC.
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
 * The identity is re-read from Supabase Auth here rather than taken from a
 * React prop, so the RPC always receives the session's real user id. The id is
 * sent as `p_user_id` because `auth.uid()` can resolve to NULL when the project
 * is called with a publishable key; the database treats it as a hint, resolves
 * the caller from the JWT subject, and refuses a mismatch.
 *
 * Resolves only after the database confirms the write, and throws on failure so
 * a caller can never render a state the server does not have.
 */
export async function setServerAutoPilotEnabled(enabled: boolean): Promise<true> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    console.error("[ServerAutoPilot] toggle blocked: no signed-in user", authError);
    throw new Error(authError?.message ?? "You must be signed in to change Auto-Pilot.");
  }

  console.log("[ServerAutoPilot] rpc toggle_auto_pilot ->", {
    p_enabled: enabled,
    p_user_id: user.id,
  });

  try {
    const { data, error } = await supabase.rpc("toggle_auto_pilot", {
      p_enabled: enabled,
      p_user_id: user.id,
    });

    if (error) {
      console.error("RPC Error:", error);
      throw new Error(error.message);
    }

    const result = data as { success?: boolean; error?: string; enabled?: boolean } | null;
    // The function reports refusals in-band as { success: false, error }.
    if (result && result.success === false) {
      console.error("RPC Error:", result.error ?? result);
      throw new Error(result.error ?? "The Auto-Pilot toggle was refused.");
    }

    console.log("[ServerAutoPilot] rpc toggle_auto_pilot succeeded:", result);
    return true;
  } catch (err) {
    console.error("RPC Error:", err);
    throw err instanceof Error ? err : new Error(String(err));
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
      // Throws if the write fails; local state is only touched afterwards.
      await setServerAutoPilotEnabled(enabled);
      setState((prev) => ({
        enabled,
        config: { ...prev.config, ...(config ?? {}) },
      }));
      return true;
    },
    []
  );

  return { enabled: state.enabled, config: state.config, loading, refresh, setEnabled };
}
