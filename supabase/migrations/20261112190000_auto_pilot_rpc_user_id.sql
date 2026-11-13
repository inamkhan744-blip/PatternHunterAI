-- ===========================================================================
-- PatternHunter AI — Auto-Pilot toggle: resolve the caller from the JWT subject
--
-- `set_auto_pilot_enabled` used `auth.uid()` alone. When the client key was
-- switched to a publishable key, some calls arrived with `auth.uid()` NULL and
-- the toggle failed with "Authentication required" even though a valid session
-- token was attached. The client now also sends its user id, and this function
-- resolves the caller as COALESCE(auth.uid(), auth.jwt()->>'sub').
--
-- SECURITY: `p_user_id` is a *hint*, never authority. The resolved caller must
-- match it, so a client cannot toggle somebody else's Auto-Pilot by guessing a
-- uuid. If neither auth.uid() nor the JWT subject is available, the call is
-- rejected.
--
-- Idempotent (safe to re-run).
-- ===========================================================================

-- Replace the two-argument signature: keeping both would make 2-arg calls
-- ambiguous (PostgREST error PGRST203).
DROP FUNCTION IF EXISTS public.set_auto_pilot_enabled(boolean, jsonb);

CREATE OR REPLACE FUNCTION public.set_auto_pilot_enabled(
  p_enabled boolean,
  p_config jsonb DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- auth.uid() first; fall back to the JWT subject that Supabase exposes to SQL.
  caller uuid := COALESCE(
    auth.uid(),
    NULLIF(auth.jwt() ->> 'sub', '')::uuid
  );
  target uuid;
  current_enabled boolean;
  current_config jsonb;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required: no valid session token was presented.'
    );
  END IF;

  -- The supplied id must either be absent or match the authenticated caller.
  IF p_user_id IS NOT NULL AND p_user_id <> caller THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Refused: the supplied user id does not match the authenticated session.'
    );
  END IF;

  target := caller;

  IF p_config IS NOT NULL AND jsonb_typeof(p_config) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Config must be a JSON object.');
  END IF;

  SELECT auto_pilot_enabled, auto_pilot_config
    INTO current_enabled, current_config
  FROM public.user_profiles
  WHERE id = target;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found.');
  END IF;

  current_enabled := COALESCE(p_enabled, current_enabled);
  current_config := COALESCE(current_config, '{}'::jsonb) || COALESCE(p_config, '{}'::jsonb);

  UPDATE public.user_profiles
  SET auto_pilot_enabled = current_enabled,
      auto_pilot_config = current_config,
      updated_at = now()
  WHERE id = target;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target,
    'enabled', current_enabled,
    'config', current_config
  );
END;
$$;

COMMENT ON FUNCTION public.set_auto_pilot_enabled(boolean, jsonb, uuid) IS
  'Toggles server-side Auto-Pilot for the caller. p_user_id is a hint that must match the JWT subject; it can never target another account.';

REVOKE ALL ON FUNCTION public.set_auto_pilot_enabled(boolean, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_auto_pilot_enabled(boolean, jsonb, uuid) TO authenticated, service_role;
