import { useCallback, useEffect, useMemo, useState } from "react";
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
 * The values come from `user_profiles` (RLS-protected) and are re-read on every
 * auth change. Nothing here grants access on its own — the server re-checks.
 */
export function useSubscription(user: User | null): SubscriptionState {
  const [profile, setProfile] = useState<UserSubscriptionProfile>(FREE_PROFILE);
  const [loading, setLoading] = useState<boolean>(Boolean(user));

  const refresh = useCallback(async () => {
    if (!user?.id) {
      clearSubscriptionCache();
      clearCredentialCache();
      setProfile(FREE_PROFILE);
      setLoading(false);
      return;
    }
    setLoading(true);
    const next = await fetchUserProfile(user.id);
    setProfile(next);
    // Warm the credential-status cache so live/paper badges are correct on first paint.
    void refreshCredentialStatus();
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPro = useMemo(() => profileIsPro(profile), [profile]);
  const isAdmin = useMemo(() => profileIsAdmin(profile), [profile]);

  return { profile, isAdmin, isPro, loading, refresh };
}
