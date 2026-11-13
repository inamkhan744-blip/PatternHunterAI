-- ============================================================================
-- PatternHunter AI — Auto-Pilot safety + server-side quotas
--
-- Fixes the audit's highest-risk findings:
--   1. Auto-Pilot config was collected in the browser and thrown away, so the
--      worker always ran on defaults (Futures, 5x, LIVE). Config is now
--      validated and persisted by the toggle RPC.
--   2. Enabling Auto-Pilot is now gated on Pro entitlement, ban state, account
--      expiry, maintenance mode and the global Auto-Pilot flag. Disabling is
--      always allowed, even for a banned/expired account.
--   3. Adds the exchange order IDs, fee fields and idempotency key the worker
--      needs to reconcile positions instead of leaving them `OPEN` forever.
--   4. Adds per-user fairness bookkeeping (`last_worker_run_at`) so the worker
--      cannot starve users past the batch limit.
--   5. Scopes Auto-Pilot event trimming to one user (the old function deleted
--      other users' audit history).
--   6. Adds a server-enforced daily scan quota (it previously lived only in
--      localStorage and could be reset by clearing storage).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trade execution bookkeeping (was missing entirely)
-- ---------------------------------------------------------------------------
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS entry_order_id text,
  ADD COLUMN IF NOT EXISTS sl_order_id text,
  ADD COLUMN IF NOT EXISTS tp_order_id text,
  ADD COLUMN IF NOT EXISTS exchange text NOT NULL DEFAULT 'binance',
  ADD COLUMN IF NOT EXISTS fees numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS funding_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_by text,
  ADD COLUMN IF NOT EXISTS client_order_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.trades.sl_order_id IS
  'Exchange order id for the protective stop. Needed to cancel/reconcile a live position after reload or on another device.';
COMMENT ON COLUMN public.trades.tp_order_id IS
  'Exchange order id for the take-profit (or OCO order list id on Spot).';
COMMENT ON COLUMN public.trades.client_order_id IS
  'Idempotency key supplied by the executor. A retried insert can never create a duplicate position.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_client_order_id
  ON public.trades (user_id, client_order_id)
  WHERE client_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trades_user_status
  ON public.trades (user_id, status, is_paper);

-- ---------------------------------------------------------------------------
-- 2. Worker fairness + Auto-Pilot arm timestamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_worker_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pilot_armed_at timestamptz;

COMMENT ON COLUMN public.user_profiles.last_worker_run_at IS
  'Updated by the worker at the start of a user run. The worker orders by this column so the batch limit rotates fairly.';

CREATE INDEX IF NOT EXISTS idx_user_profiles_worker_fairness
  ON public.user_profiles (last_worker_run_at NULLS FIRST)
  WHERE auto_pilot_enabled = true;

-- ---------------------------------------------------------------------------
-- 3. Strict config validation
--    Returns { ok, config, error }. Unknown keys are dropped, numeric ranges are
--    clamped by rejection (never silently widened), and symbols are normalised.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_auto_pilot_config(p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  syms text[];
  list jsonb;
  num numeric;
  text_value text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'config', out);
  END IF;

  IF jsonb_typeof(p_raw) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Auto-Pilot config must be a JSON object.');
  END IF;

  -- symbols
  IF p_raw ? 'symbols' THEN
    IF jsonb_typeof(p_raw -> 'symbols') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'symbols must be an array.');
    END IF;
    SELECT array_agg(DISTINCT upper(trim(value))) INTO syms
    FROM jsonb_array_elements_text(p_raw -> 'symbols') AS t(value)
    WHERE upper(trim(value)) ~ '^[A-Z0-9]{5,20}$';

    IF syms IS NULL OR cardinality(syms) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'symbols must contain at least one valid Binance symbol.');
    END IF;

    SELECT jsonb_agg(symbol) INTO list
    FROM (SELECT unnest(syms) AS symbol LIMIT 10) AS limited;
    out := out || jsonb_build_object('symbols', list);
  END IF;

  -- timeframe
  IF p_raw ? 'timeframe' THEN
    text_value := lower(trim(p_raw ->> 'timeframe'));
    IF text_value NOT IN ('15m', '30m', '1h', '4h') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'timeframe must be one of 15m, 30m, 1h, 4h.');
    END IF;
    out := out || jsonb_build_object('timeframe', text_value);
  END IF;

  -- marketType
  IF p_raw ? 'marketType' THEN
    text_value := p_raw ->> 'marketType';
    IF lower(text_value) = 'spot' THEN
      out := out || jsonb_build_object('marketType', 'Spot');
    ELSIF lower(text_value) = 'futures' THEN
      out := out || jsonb_build_object('marketType', 'Futures');
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'marketType must be Spot or Futures.');
    END IF;
  END IF;

  -- leverage
  IF p_raw ? 'leverage' THEN
    IF jsonb_typeof(p_raw -> 'leverage') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'leverage must be a number.');
    END IF;
    num := (p_raw ->> 'leverage')::numeric;
    IF num < 1 OR num > 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'leverage must be between 1 and 10.');
    END IF;
    out := out || jsonb_build_object('leverage', floor(num)::int);
  END IF;

  -- riskPercent (matches the UI slider range; the worker sizes risk from it)
  IF p_raw ? 'riskPercent' THEN
    IF jsonb_typeof(p_raw -> 'riskPercent') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'riskPercent must be a number.');
    END IF;
    num := (p_raw ->> 'riskPercent')::numeric;
    IF num < 0.25 OR num > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'riskPercent must be between 0.25 and 5.');
    END IF;
    out := out || jsonb_build_object('riskPercent', num);
  END IF;

  -- maxOpenTrades
  IF p_raw ? 'maxOpenTrades' THEN
    IF jsonb_typeof(p_raw -> 'maxOpenTrades') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxOpenTrades must be a number.');
    END IF;
    num := (p_raw ->> 'maxOpenTrades')::numeric;
    IF num < 1 OR num > 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'maxOpenTrades must be between 1 and 5.');
    END IF;
    out := out || jsonb_build_object('maxOpenTrades', floor(num)::int);
  END IF;

  -- tradeDirectionMode
  IF p_raw ? 'tradeDirectionMode' THEN
    text_value := upper(trim(p_raw ->> 'tradeDirectionMode'));
    IF text_value NOT IN ('BOTH', 'LONG_ONLY', 'SHORT_ONLY') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tradeDirectionMode is invalid.');
    END IF;
    out := out || jsonb_build_object('tradeDirectionMode', text_value);
  END IF;

  -- minScore: never below the server's safety floor.
  IF p_raw ? 'minScore' THEN
    IF jsonb_typeof(p_raw -> 'minScore') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minScore must be a number.');
    END IF;
    num := (p_raw ->> 'minScore')::numeric;
    IF num < 85 OR num > 100 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'minScore must be between 85 and 100.');
    END IF;
    out := out || jsonb_build_object('minScore', round(num)::int);
  END IF;

  -- paperTrading is deliberately strict: only a real boolean can select live.
  IF p_raw ? 'paperTrading' THEN
    IF jsonb_typeof(p_raw -> 'paperTrading') <> 'boolean' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paperTrading must be a boolean.');
    END IF;
    out := out || jsonb_build_object('paperTrading', (p_raw ->> 'paperTrading')::boolean);
  END IF;

  RETURN jsonb_build_object('ok', true, 'config', out);
END;
$$;

COMMENT ON FUNCTION public.validate_auto_pilot_config(jsonb) IS
  'Validates a partial Auto-Pilot config. Unknown keys are dropped; out-of-range values are rejected instead of silently clamped.';

REVOKE ALL ON FUNCTION public.validate_auto_pilot_config(jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Canonical toggle: persists config and enforces entitlement
-- ---------------------------------------------------------------------------
-- Remove every older overload. Leaving an ungated signature callable would be a
-- complete bypass of the checks below.
DROP FUNCTION IF EXISTS public.toggle_auto_pilot(uuid, boolean);
DROP FUNCTION IF EXISTS public.toggle_auto_pilot(boolean, uuid);
DROP FUNCTION IF EXISTS public.set_auto_pilot_enabled(boolean, jsonb);
DROP FUNCTION IF EXISTS public.set_auto_pilot_enabled(boolean, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.toggle_auto_pilot(
  p_enabled boolean,
  p_user_id uuid,
  p_config jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := COALESCE(
    auth.uid(),
    NULLIF(auth.jwt() ->> 'sub', '')::uuid
  );
  profile record;
  maintenance boolean := false;
  autopilot_enabled boolean := true;
  is_pro boolean := false;
  validated jsonb;
  merged jsonb;
  next_enabled boolean;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'AUTH_REQUIRED',
      'error', 'Authentication required: no valid session token was presented.'
    );
  END IF;

  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INPUT', 'error', 'p_enabled is required.');
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> caller THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Refused: the supplied user id does not match the authenticated session.'
    );
  END IF;

  SELECT role, subscription_tier, subscription_status, subscription_expires_at,
         is_banned, auto_pilot_config
    INTO profile
  FROM public.user_profiles
  WHERE id = caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING', 'error', 'Profile not found.');
  END IF;

  -- Disabling must always work: a banned or expired user still has to be able
  -- to stop the worker.
  IF p_enabled = false THEN
    UPDATE public.user_profiles
    SET auto_pilot_enabled = false,
        updated_at = now()
    WHERE id = caller
    RETURNING auto_pilot_enabled INTO next_enabled;

    RETURN jsonb_build_object(
      'success', true,
      'user_id', caller,
      'enabled', COALESCE(next_enabled, false),
      'config', COALESCE(profile.auto_pilot_config, '{}'::jsonb)
    );
  END IF;

  IF COALESCE(profile.is_banned, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BANNED',
      'error', 'This account is suspended and cannot enable Auto-Pilot.'
    );
  END IF;

  is_pro := profile.role = 'admin'
    OR (
      profile.subscription_tier IN ('pro', 'premium')
      AND profile.subscription_status IN ('active', 'trialing')
      AND (profile.subscription_expires_at IS NULL OR profile.subscription_expires_at > now())
    );

  IF NOT is_pro THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PRO_REQUIRED',
      'error', 'Auto-Pilot requires an active Pro subscription.'
    );
  END IF;

  SELECT COALESCE(maintenance_mode, false), COALESCE(enable_autopilot, true)
    INTO maintenance, autopilot_enabled
  FROM public.global_settings
  WHERE id = 'global_config';

  IF profile.role <> 'admin' AND maintenance THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MAINTENANCE',
      'error', 'Auto-Pilot cannot be enabled while the platform is in maintenance mode.'
    );
  END IF;

  IF profile.role <> 'admin' AND autopilot_enabled = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DISABLED',
      'error', 'Auto-Pilot is currently disabled by the platform administrator.'
    );
  END IF;

  validated := public.validate_auto_pilot_config(p_config);
  IF (validated ->> 'ok')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_CONFIG',
      'error', COALESCE(validated ->> 'error', 'Invalid Auto-Pilot configuration.')
    );
  END IF;

  merged := COALESCE(profile.auto_pilot_config, '{}'::jsonb) || (validated -> 'config');

  -- Safety default: enabling without an explicit paper/live choice runs in
  -- paper mode. Live trading must always be an explicit boolean false.
  IF NOT (merged ? 'paperTrading') THEN
    merged := merged || jsonb_build_object('paperTrading', true);
  END IF;

  UPDATE public.user_profiles
  SET auto_pilot_enabled = true,
      auto_pilot_config = merged,
      auto_pilot_armed_at = now(),
      updated_at = now()
  WHERE id = caller
  RETURNING auto_pilot_enabled INTO next_enabled;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', caller,
    'enabled', COALESCE(next_enabled, false),
    'config', merged
  );
END;
$$;

COMMENT ON FUNCTION public.toggle_auto_pilot(boolean, uuid, jsonb) IS
  'Enables/disables Auto-Pilot for the caller and persists a validated config. Enabling requires Pro, a non-banned account, no maintenance mode and the global flag. Disabling is always allowed.';

REVOKE ALL ON FUNCTION public.toggle_auto_pilot(boolean, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_auto_pilot(boolean, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Auto-Pilot event trimming is per user
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.trim_auto_pilot_events(integer);

CREATE OR REPLACE FUNCTION public.trim_auto_pilot_events(
  p_user_id uuid,
  p_keep integer DEFAULT 200
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.auto_pilot_events e
  WHERE e.user_id = p_user_id
    AND e.id NOT IN (
      SELECT id FROM public.auto_pilot_events
      WHERE user_id = p_user_id
      ORDER BY created_at DESC
      LIMIT GREATEST(p_keep, 1)
    );
END;
$$;

COMMENT ON FUNCTION public.trim_auto_pilot_events(uuid, integer) IS
  'Keeps the newest p_keep events for one user. The previous implementation deleted rows globally, erasing other users'' audit history.';

REVOKE ALL ON FUNCTION public.trim_auto_pilot_events(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trim_auto_pilot_events(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Server-side daily scan quota
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scan_daily_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  scan_count integer NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.scan_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scan_daily_usage FROM anon, authenticated;
GRANT ALL ON public.scan_daily_usage TO service_role;
GRANT SELECT ON public.scan_daily_usage TO authenticated;

DROP POLICY IF EXISTS "select_own_scan_usage" ON public.scan_daily_usage;
CREATE POLICY "select_own_scan_usage" ON public.scan_daily_usage
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_scan_quota()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  lim integer;
  pro boolean;
  used integer := 0;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'limit', 0, 'current', 0,
                              'isPro', false, 'isAdmin', false,
                              'reason', 'Authentication required.');
  END IF;

  SELECT role, subscription_tier, subscription_status, subscription_expires_at
    INTO prof
  FROM public.user_profiles
  WHERE id = uid;

  pro := COALESCE(prof.role = 'admin', false)
    OR (
      prof.subscription_tier IN ('pro', 'premium')
      AND prof.subscription_status IN ('active', 'trialing')
      AND (prof.subscription_expires_at IS NULL OR prof.subscription_expires_at > now())
    );

  IF prof.role = 'admin' THEN
    lim := 1000000;
  ELSIF pro THEN
    lim := 1000;
  ELSE
    lim := 3;
  END IF;

  SELECT scan_count INTO used
  FROM public.scan_daily_usage
  WHERE user_id = uid AND usage_date = today;

  RETURN jsonb_build_object(
    'allowed', COALESCE(used, 0) < lim,
    'limit', lim,
    'current', COALESCE(used, 0),
    'isPro', pro,
    'isAdmin', COALESCE(prof.role = 'admin', false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_scan_quota()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  lim integer;
  pro boolean;
  used integer := 0;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'limit', 0, 'current', 0,
                              'isPro', false, 'isAdmin', false,
                              'reason', 'Authentication required.');
  END IF;

  SELECT role, subscription_tier, subscription_status, subscription_expires_at
    INTO prof
  FROM public.user_profiles
  WHERE id = uid;

  pro := COALESCE(prof.role = 'admin', false)
    OR (
      prof.subscription_tier IN ('pro', 'premium')
      AND prof.subscription_status IN ('active', 'trialing')
      AND (prof.subscription_expires_at IS NULL OR prof.subscription_expires_at > now())
    );

  IF prof.role = 'admin' THEN
    lim := 1000000;
  ELSIF pro THEN
    lim := 1000;
  ELSE
    lim := 3;
  END IF;

  -- Serialise concurrent scans for this user/day so the limit cannot be
  -- exceeded by two parallel requests.
  PERFORM pg_advisory_xact_lock(hashtext(uid::text || today::text));

  SELECT scan_count INTO used
  FROM public.scan_daily_usage
  WHERE user_id = uid AND usage_date = today;

  IF COALESCE(used, 0) >= lim THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'limit', lim,
      'current', COALESCE(used, 0),
      'isPro', pro,
      'isAdmin', COALESCE(prof.role = 'admin', false),
      'reason', 'Daily scan limit reached.'
    );
  END IF;

  INSERT INTO public.scan_daily_usage (user_id, usage_date, scan_count)
  VALUES (uid, today, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET scan_count = public.scan_daily_usage.scan_count + 1,
                updated_at = now()
  RETURNING scan_count INTO used;

  RETURN jsonb_build_object(
    'allowed', true,
    'limit', lim,
    'current', used,
    'isPro', pro,
    'isAdmin', COALESCE(prof.role = 'admin', false)
  );
END;
$$;

COMMENT ON FUNCTION public.consume_scan_quota() IS
  'Atomically consumes one daily scan for the caller. Free tier: 3/day, Pro: 1000/day, admin: effectively unlimited.';

REVOKE ALL ON FUNCTION public.get_scan_quota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_scan_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_scan_quota() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_scan_quota() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Global AI keys are no longer world-readable
--    Every signed-in account could SELECT gemini_api_key/deepseek_api_key/
--    groq_api_key. Provider calls now go through `ai-chat` (service role); only
--    admins need the raw settings for the Settings UI.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_read_global_settings" ON public.global_settings;
DROP POLICY IF EXISTS "admin_read_global_settings" ON public.global_settings;
CREATE POLICY "admin_read_global_settings"
  ON public.global_settings
  FOR SELECT TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "admin_read_global_settings" ON public.global_settings IS
  'AI provider keys must never be readable by non-admin accounts; the ai-chat edge function reads them with the service role.';
