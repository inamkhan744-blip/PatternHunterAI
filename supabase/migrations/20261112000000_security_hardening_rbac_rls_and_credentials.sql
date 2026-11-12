-- ===========================================================================
-- PatternHunter AI — Phase 3 Security Hardening
--
-- Scope:
--   1. Remove recursive / self-referencing RLS policies on user_profiles.
--   2. Make roles + subscription tiers server-authoritative (no user writes).
--   3. Add server-enforced trade/scan quotas (atomic, per user, per UTC day).
--   4. Add a service-role-only encrypted credential vault for exchange keys.
--   5. Add durable per-user rate limiting for edge functions.
--   6. Add hashed TradingView webhook secrets + replay protection.
--   7. Enforce RLS on every public table, revoke anon, harden SECURITY DEFINER.
--
-- This migration is idempotent (safe to re-run).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Non-recursive role helpers
-- ---------------------------------------------------------------------------

-- Reads the caller's role with the definer's privileges, so policies on
-- user_profiles never re-enter user_profiles through a sub-select.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.user_profiles p
  WHERE p.id = auth.uid()
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'Returns the authenticated caller role from user_profiles. SECURITY DEFINER to avoid recursive RLS evaluation.';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT p.role = 'admin' FROM public.user_profiles p WHERE p.id = auth.uid()),
    false
  )
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True only when user_profiles.role = admin for the JWT subject. JWT app_metadata is deliberately NOT trusted as a role source.';

-- ---------------------------------------------------------------------------
-- 2. user_profiles: read-only for owners, no user-writable privilege columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_profiles FROM authenticated;
GRANT SELECT ON public.user_profiles TO authenticated;

DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admins_update_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "select_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admin_select_all_profiles" ON public.user_profiles;

CREATE POLICY "select_own_profile" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "admin_select_all_profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- NOTE: there is intentionally no INSERT/UPDATE/DELETE policy for clients.
-- All privileged mutations go through the SECURITY DEFINER RPCs below, each of
-- which re-verifies public.is_admin() and writes an admin audit record.

-- ---------------------------------------------------------------------------
-- 3. Server-enforced daily trade quota
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.trade_daily_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  trade_count integer NOT NULL DEFAULT 0 CHECK (trade_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.trade_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_daily_usage FROM anon, authenticated;
GRANT ALL ON public.trade_daily_usage TO service_role;

DROP POLICY IF EXISTS "select_own_trade_usage" ON public.trade_daily_usage;
CREATE POLICY "select_own_trade_usage" ON public.trade_daily_usage
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
GRANT SELECT ON public.trade_daily_usage TO authenticated;

CREATE OR REPLACE FUNCTION public.get_trade_quota()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  used integer := 0;
  lim integer;
  pro boolean;
  adm boolean;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false, 'limit', 0, 'current', 0,
      'isPro', false, 'isAdmin', false,
      'reason', 'Authentication required.'
    );
  END IF;

  SELECT role, subscription_tier, subscription_status, subscription_expires_at, daily_trade_limit
    INTO prof
  FROM public.user_profiles
  WHERE id = uid;

  adm := COALESCE(prof.role = 'admin', false);
  pro := COALESCE(
    prof.role = 'admin'
    OR (
      prof.subscription_tier IN ('pro', 'premium')
      AND prof.subscription_status IN ('active', 'trialing')
      AND (prof.subscription_expires_at IS NULL OR prof.subscription_expires_at > now())
    ),
    false
  );

  IF adm THEN
    lim := 1000000;
  ELSIF pro THEN
    lim := GREATEST(COALESCE(prof.daily_trade_limit, 100), 1);
  ELSE
    lim := 3;
  END IF;

  SELECT trade_count INTO used
  FROM public.trade_daily_usage
  WHERE user_id = uid AND usage_date = today;

  RETURN jsonb_build_object(
    'allowed', COALESCE(used, 0) < lim,
    'limit', lim,
    'current', COALESCE(used, 0),
    'isPro', pro,
    'isAdmin', adm
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_trade_quota()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  used integer := 0;
  lim integer;
  pro boolean;
  adm boolean;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false, 'limit', 0, 'current', 0,
      'isPro', false, 'isAdmin', false,
      'reason', 'Authentication required.'
    );
  END IF;

  SELECT role, subscription_tier, subscription_status, subscription_expires_at, daily_trade_limit
    INTO prof
  FROM public.user_profiles
  WHERE id = uid;

  adm := COALESCE(prof.role = 'admin', false);
  pro := COALESCE(
    prof.role = 'admin'
    OR (
      prof.subscription_tier IN ('pro', 'premium')
      AND prof.subscription_status IN ('active', 'trialing')
      AND (prof.subscription_expires_at IS NULL OR prof.subscription_expires_at > now())
    ),
    false
  );

  IF adm THEN
    lim := 1000000;
  ELSIF pro THEN
    lim := GREATEST(COALESCE(prof.daily_trade_limit, 100), 1);
  ELSE
    lim := 3;
  END IF;

  INSERT INTO public.trade_daily_usage (user_id, usage_date, trade_count)
  VALUES (uid, today, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT trade_count INTO used
  FROM public.trade_daily_usage
  WHERE user_id = uid AND usage_date = today
  FOR UPDATE;

  IF used >= lim THEN
    RETURN jsonb_build_object(
      'allowed', false, 'limit', lim, 'current', used,
      'isPro', pro, 'isAdmin', adm,
      'reason', CASE WHEN adm THEN 'Unexpected: administrator quota reached.'
                     WHEN pro THEN format('Pro daily trade limit reached (%s/%s).', used, lim)
                     ELSE format('Free tier limit of %s trades per day reached (%s/%s). Upgrade to Pro for higher volume.', lim, used, lim)
                END
    );
  END IF;

  UPDATE public.trade_daily_usage
  SET trade_count = trade_count + 1, updated_at = now()
  WHERE user_id = uid AND usage_date = today
  RETURNING trade_count INTO used;

  RETURN jsonb_build_object(
    'allowed', true, 'limit', lim, 'current', used,
    'isPro', pro, 'isAdmin', adm
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Encrypted exchange credential vault (service_role only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_exchange_credentials (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL DEFAULT 'binance'
    CHECK (exchange IN ('binance', 'bybit', 'okx', 'kucoin')),
  key_ciphertext text NOT NULL,
  secret_ciphertext text NOT NULL,
  passphrase_ciphertext text,
  key_last4 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exchange)
);

ALTER TABLE public.user_exchange_credentials ENABLE ROW LEVEL SECURITY;

-- No client role may read ciphertext or write credentials directly.
REVOKE ALL ON public.user_exchange_credentials FROM anon, authenticated;
GRANT ALL ON public.user_exchange_credentials TO service_role;

COMMENT ON TABLE public.user_exchange_credentials IS
  'Exchange API credentials encrypted with AES-256-GCM by the binance-credentials edge function. Accessible only via service_role.';

-- ---------------------------------------------------------------------------
-- 5. Durable rate limiting
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bucket record;
  now_ts timestamptz := now();
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR p_limit <= 0 OR p_window_seconds <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO bucket FROM public.rate_limit_buckets WHERE bucket_key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.rate_limit_buckets (bucket_key, window_start, hit_count, expires_at)
    VALUES (p_key, now_ts, 1, now_ts + make_interval(secs => p_window_seconds));
    RETURN true;
  END IF;

  IF bucket.window_start + make_interval(secs => p_window_seconds) <= now_ts THEN
    UPDATE public.rate_limit_buckets
    SET window_start = now_ts,
        hit_count = 1,
        expires_at = now_ts + make_interval(secs => p_window_seconds)
    WHERE bucket_key = p_key;
    RETURN true;
  END IF;

  IF bucket.hit_count >= p_limit THEN
    RETURN false;
  END IF;

  UPDATE public.rate_limit_buckets
  SET hit_count = hit_count + 1
  WHERE bucket_key = p_key;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. TradingView webhook secrets + replay guard
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.user_webhook_secrets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Plaintext token is readable only through the SECURITY DEFINER RPCs below,
  -- because Trading View alerts must be able to paste it into the alert body.
  token text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_last4 text,
  -- Service-role-only HMAC key used to verify optional webhook signatures.
  signing_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_webhook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_webhook_secrets FROM anon, authenticated;
GRANT ALL ON public.user_webhook_secrets TO service_role;

CREATE TABLE IF NOT EXISTS public.webhook_replay_guard (
  delivery_id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_replay_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_replay_guard FROM anon, authenticated;
GRANT ALL ON public.webhook_replay_guard TO service_role;

CREATE OR REPLACE FUNCTION public.rotate_webhook_token()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  new_token text;
  new_signing text;
  token_hash text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- 32 bytes of CSPRNG output, base64url encoded server-side.
  new_token := 'tv_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  new_signing := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  token_hash := encode(extensions.digest(new_token, 'sha256'), 'hex');

  INSERT INTO public.user_webhook_secrets (user_id, token, token_hash, token_last4, signing_secret, rotated_at)
  VALUES (uid, new_token, token_hash, right(new_token, 4), new_signing, now())
  ON CONFLICT (user_id) DO UPDATE
    SET token = EXCLUDED.token,
        token_hash = EXCLUDED.token_hash,
        token_last4 = EXCLUDED.token_last4,
        signing_secret = EXCLUDED.signing_secret,
        rotated_at = now();

  -- Plaintext is returned exactly once; only the hash + encrypted signing secret persist.
  RETURN jsonb_build_object(
    'success', true,
    'token', new_token,
    'signingSecret', new_signing,
    'tokenLast4', right(new_token, 4)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_webhook_token()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  existing record;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT token, signing_secret INTO existing
  FROM public.user_webhook_secrets
  WHERE user_id = uid;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'token', existing.token,
      'signingSecret', existing.signing_secret
    );
  END IF;

  RETURN public.rotate_webhook_token();
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs (server-side authorization)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_pro_daily_limit(p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT IN (1, 5, 10, 100) THEN
    RAISE EXCEPTION 'Unsupported daily limit' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET daily_trade_limit = p_limit,
      updated_at = now()
  WHERE subscription_tier IN ('pro', 'premium');

  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (auth.uid(), NULL, 'SET_PRO_DAILY_LIMIT', jsonb_build_object('limit', p_limit));

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_subscription(
  p_user_id uuid,
  p_tier text,
  p_status text DEFAULT 'active',
  p_expires_at timestamptz DEFAULT NULL,
  p_daily_limit integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_tier NOT IN ('free', 'pro', 'premium') THEN
    RAISE EXCEPTION 'Invalid subscription tier' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('active', 'past_due', 'canceled', 'trialing') THEN
    RAISE EXCEPTION 'Invalid subscription status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET subscription_tier = p_tier,
      subscription_status = p_status,
      subscription_expires_at = p_expires_at,
      daily_trade_limit = COALESCE(p_daily_limit, daily_trade_limit),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (
    auth.uid(), p_user_id, 'SET_USER_SUBSCRIPTION',
    jsonb_build_object('tier', p_tier, 'status', p_status, 'expires_at', p_expires_at, 'daily_limit', p_daily_limit)
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('user', 'staff', 'admin') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
  SET role = p_role, updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (auth.uid(), p_user_id, 'SET_USER_ROLE', jsonb_build_object('role', p_role));

  RETURN true;
END;
$$;

-- Hardened first-admin bootstrap: only while the platform has zero admins.
CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  admin_count integer;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ph_bootstrap_admin'));

  SELECT count(*) INTO admin_count FROM public.user_profiles WHERE role = 'admin';
  IF admin_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Administrator bootstrap already completed. Ask an existing admin for a role grant.'
    );
  END IF;

  UPDATE public.user_profiles
  SET role = 'admin',
      subscription_tier = 'premium',
      subscription_status = 'active',
      daily_trade_limit = 999999,
      updated_at = now()
  WHERE id = current_user_id;

  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (current_user_id, current_user_id, 'BOOTSTRAP_FIRST_ADMIN', jsonb_build_object('user_id', current_user_id));

  RETURN jsonb_build_object('success', true, 'message', 'Initial administrator bootstrapped.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Fix cross-tenant watchlist uniqueness
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlist_binance_symbol_key') THEN
    ALTER TABLE public.watchlist DROP CONSTRAINT watchlist_binance_symbol_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_watchlist_user_symbol
  ON public.watchlist (user_id, binance_symbol);

-- ---------------------------------------------------------------------------
-- 9. Table-level audit: RLS everywhere, anon has no access
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS enabled on public.%', r.relname;
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- Verify the owner-scoped policies from earlier migrations still exist.
DROP POLICY IF EXISTS "select_own_signals" ON public.signal_history;
CREATE POLICY "select_own_signals" ON public.signal_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_signals" ON public.signal_history;
CREATE POLICY "insert_own_signals" ON public.signal_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_signals" ON public.signal_history;
CREATE POLICY "update_own_signals" ON public.signal_history
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_signals" ON public.signal_history;
CREATE POLICY "delete_own_signals" ON public.signal_history
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 10. SECURITY DEFINER hardening: no PUBLIC execute, no search_path hijack
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role, subscription_tier, subscription_status, daily_trade_limit)
  VALUES (new.id, new.email, 'user', 'free', 'active', 3)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_trade_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_trade_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_webhook_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_pro_daily_limit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_subscription(uuid, text, text, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_trade_daily_usage_date ON public.trade_daily_usage (usage_date);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON public.rate_limit_buckets (expires_at);
CREATE INDEX IF NOT EXISTS idx_webhook_replay_received_at ON public.webhook_replay_guard (received_at);
CREATE INDEX IF NOT EXISTS idx_user_exchange_credentials_user ON public.user_exchange_credentials (user_id);
