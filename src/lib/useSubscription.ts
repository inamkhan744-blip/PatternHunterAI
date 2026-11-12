import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  FREE_PROFILE,
  clearSubscriptionCache,
  fetchUserProfile,
  isUserAdmin as profileIsAdmin,
  isUserPro as profileIsPro,
  type UserSubscriptionProfile,
} from "./SubscriptionManager";
import { clearCredentialCache, refreshCredentialStatus } from "./CredentialVault";

interface SubscriptionState {
  profile: UserSubscriptionProfile;
  isAdmin: boolean;
  isPro: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Single source of truth for role / tier in the UI.
 *
 * The profile is re-read from `user_profiles` on every page load, on every auth
 * change, whenever the tab regains focus and on a 5-minute interval. Nothing is
 * trusted from localStorage and nothing here grants access on its own — the server
 * re-checks every privileged action.
 */
export function useSubscription(user: User | null): SubscriptionState {
  const [profile, setProfile] = useState<UserSubscriptionProfile>(FREE_PROFILE);
  const [loading, setLoading] = useState<boolean>(Boolean(user));
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      clearSubscriptionCache();
      clearCredentialCache();
      setProfile(FREE_PROFILE);
      loadedOnce.current = false;
      setLoading(false);
      return;
    }

    if (!loadedOnce.current) setLoading(true);
    try {
      const next = await fetchUserProfile(user.id, user.email ?? null);
      setProfile(next);
      // Warm the credential-status cache so live/paper badges are correct on first paint.
      void refreshCredentialStatus();
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, [user?.id, user?.email]);

  // Initial load and auth change (login / logout / user switch).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-verify when the tab becomes active again, so an admin change made in the
  // Supabase dashboard takes effect without a hard reload.
  useEffect(() => {
    if (!user?.id || typeof document === "undefined") return;

    const revalidate = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();

    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void refresh(), 5 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh, user?.id]);

  const isPro = useMemo(() => profileIsPro(profile), [profile]);
  const isAdmin = useMemo(() => profileIsAdmin(profile), [profile]);

  return { profile, isAdmin, isPro, loading, refresh };
}
