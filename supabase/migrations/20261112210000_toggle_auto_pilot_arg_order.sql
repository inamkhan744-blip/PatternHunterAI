-- ===========================================================================
-- PatternHunter AI — `toggle_auto_pilot(p_enabled boolean, p_user_id uuid)`
--
-- Aligns the function with the deployed signature. Postgres cannot reorder
-- input parameters with CREATE OR REPLACE, so the two-argument form is dropped
-- and recreated in the new order. PostgREST resolves named arguments, so the
-- previous `(p_user_id, p_enabled)` calls stay valid against this definition,
-- but the stored signature now matches what the client sends.
--
-- SECURITY: `p_user_id` is a hint, never authority. The caller is resolved as
-- COALESCE(auth.uid(), auth.jwt()->>'sub') and a mismatched id is refused, so a
-- client can never flip another account's flag. `auto_pilot_config` is left
-- untouched; this RPC only changes the boolean.
--
-- Idempotent (safe to re-run).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.toggle_auto_pilot(uuid, boolean);

CREATE OR REPLACE FUNCTION public.toggle_auto_pilot(
  p_enabled boolean,
  p_user_id uuid
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

COMMENT ON FUNCTION public.toggle_auto_pilot(boolean, uuid) IS
  'Sets Auto-Pilot for the caller. p_user_id must match the JWT subject and can never target another account.';

REVOKE ALL ON FUNCTION public.toggle_auto_pilot(boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_auto_pilot(boolean, uuid) TO authenticated, service_role;
