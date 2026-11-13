-- ===========================================================================
-- PatternHunter AI — `toggle_auto_pilot(p_user_id, p_enabled)`
--
-- The browser calls this RPC with exactly two named arguments:
--   supabase.rpc('toggle_auto_pilot', { p_user_id: user.id, p_enabled: newValue })
--
-- It exists because `set_auto_pilot_enabled` takes a third (config) argument, and
-- the client was failing when its argument list did not match the function that
-- the project had deployed.
--
-- SECURITY: `p_user_id` is a hint, never authority. The caller is resolved as
-- COALESCE(auth.uid(), auth.jwt()->>'sub') — the JWT-subject fallback is what
-- keeps this working when the project is called with a publishable key and
-- auth.uid() comes back NULL. A mismatched id is refused, so a client can never
-- flip another account's flag.
--
-- Existing `auto_pilot_config` values are left untouched; this RPC only changes
-- the flag. Idempotent (safe to re-run).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.toggle_auto_pilot(
  p_user_id uuid,
  p_enabled boolean
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
  current_enabled boolean;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Authentication required: no valid session token was presented.'
    );
  END IF;

  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_enabled is required.');
  END IF;

  -- The supplied id must be absent or match the authenticated caller.
  IF p_user_id IS NOT NULL AND p_user_id <> caller THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Refused: the supplied user id does not match the authenticated session.'
    );
  END IF;

  UPDATE public.user_profiles
  SET auto_pilot_enabled = p_enabled,
      updated_at = now()
  WHERE id = caller
  RETURNING auto_pilot_enabled INTO current_enabled;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', caller,
    'enabled', current_enabled
  );
END;
$$;

COMMENT ON FUNCTION public.toggle_auto_pilot(uuid, boolean) IS
  'Sets Auto-Pilot for the caller. p_user_id must match the JWT subject and can never target another account.';

REVOKE ALL ON FUNCTION public.toggle_auto_pilot(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_auto_pilot(uuid, boolean) TO authenticated, service_role;
