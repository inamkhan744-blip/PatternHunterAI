-- ============================================================================
-- PatternHunter AI — Super Admin Panel
--
-- Adds:
--   * user_profiles.is_banned            → banned users get the "You are banned" screen
--   * global_settings system flags       → maintenance mode, broadcast, feature toggles
--   * auto_pilot_runs.last_candle_by_symbol → per-symbol candle cursors so one entry
--     on BTC no longer hides fresh signals on ETH/SOL (multi-trade Auto-Pilot)
--   * public.admin_set_user_ban(uuid, boolean) → SECURITY DEFINER ban/unban RPC
--
-- Admin-only writes are enforced by public.is_admin() and every privileged change
-- is recorded in public.admin_audit_logs. Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. user_profiles.is_banned
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.is_banned IS
  'Set by an admin through admin_set_user_ban(). Banned users are shown a blocking screen by the client.';

-- ---------------------------------------------------------------------------
-- 2. global_settings system controls
-- ---------------------------------------------------------------------------
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS broadcast_message text,
  ADD COLUMN IF NOT EXISTS enable_vision_ai boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_autopilot boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_telegram boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.global_settings.maintenance_mode IS
  'When true the client shows a full-screen maintenance notice to everyone except admins.';
COMMENT ON COLUMN public.global_settings.broadcast_message IS
  'Message shown as a dismissible banner to every signed-in user. Empty/NULL = no banner.';
COMMENT ON COLUMN public.global_settings.enable_vision_ai IS
  'Feature toggle: hides Vision AI entry points when false.';
COMMENT ON COLUMN public.global_settings.enable_autopilot IS
  'Feature toggle: hides Auto-Pilot controls when false.';
COMMENT ON COLUMN public.global_settings.enable_telegram IS
  'Feature toggle: hides Telegram alert settings when false.';

-- Guarantee the singleton row exists so reads/writes always target a real row.
INSERT INTO public.global_settings (id)
VALUES ('global_config')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Auto-Pilot per-symbol candle cursors
-- ---------------------------------------------------------------------------
ALTER TABLE public.auto_pilot_runs
  ADD COLUMN IF NOT EXISTS last_candle_by_symbol jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.auto_pilot_runs.last_candle_by_symbol IS
  'Per-symbol last-evaluated candle time, so one executed symbol does not block fresh signals on other symbols.';

-- ---------------------------------------------------------------------------
-- 4. Ban / unban RPC (clients never UPDATE user_profiles directly)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_ban(p_user_id uuid, p_banned boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot ban their own account' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET is_banned = COALESCE(p_banned, false),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (
    auth.uid(),
    p_user_id,
    CASE WHEN COALESCE(p_banned, false) THEN 'BAN_USER' ELSE 'UNBAN_USER' END,
    jsonb_build_object('is_banned', COALESCE(p_banned, false))
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_ban(uuid, boolean) IS
  'Admin-only ban/unban. Writes user_profiles.is_banned and an admin audit record.';

REVOKE ALL ON FUNCTION public.admin_set_user_ban(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_ban(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dashboard stats RPC (admin-only aggregate, avoids shipping every row just
--    to count them). The panel still lists rows through admin RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_users integer;
  pro_users integer;
  banned_users integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO total_users FROM public.user_profiles;

  SELECT count(*) INTO pro_users
  FROM public.user_profiles
  WHERE subscription_tier IN ('pro', 'premium')
    AND subscription_status IN ('active', 'trialing')
    AND (subscription_expires_at IS NULL OR subscription_expires_at > now());

  SELECT count(*) INTO banned_users
  FROM public.user_profiles
  WHERE is_banned = true;

  RETURN jsonb_build_object(
    'total_users', total_users,
    'pro_users', pro_users,
    'banned_users', banned_users,
    'estimated_revenue', pro_users * 10
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO authenticated;

