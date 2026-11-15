-- ===========================================================================
-- PatternHunter AI — safe global settings read + admin-only AI secret read
--
-- Requirement: normal authenticated users must be able to SELECT the platform
-- settings row, while INSERT/UPDATE stay admin-only. The AI provider keys live in
-- the same row, so a plain table-wide SELECT would re-expose them to every user.
--
-- This migration therefore restores an authenticated SELECT policy but limits the
-- column grants to non-secret fields. Admins read the key columns through the
-- SECURITY DEFINER `get_global_ai_config()` RPC; every other AI call goes through
-- the `ai-chat` edge function, which reads secrets with the service role.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS "authenticated_read_global_settings" ON public.global_settings;
CREATE POLICY "authenticated_read_global_settings"
  ON public.global_settings
  FOR SELECT TO authenticated
  USING (true);

-- Column-level SELECT: settings flags/models are public to signed-in users,
-- provider secrets are not.
REVOKE SELECT ON public.global_settings FROM authenticated;
GRANT SELECT (
  id,
  active_provider,
  gemini_model,
  deepseek_model,
  groq_model,
  maintenance_mode,
  broadcast_message,
  enable_vision_ai,
  enable_autopilot,
  enable_telegram,
  updated_at,
  updated_by
) ON public.global_settings TO authenticated;

-- Admin-only read of the full row (including provider keys) for the Settings UI.
CREATE OR REPLACE FUNCTION public.get_global_ai_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.global_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can read AI provider credentials.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO cfg
  FROM public.global_settings
  WHERE id = 'global_config';

  IF cfg.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', cfg.id,
    'active_provider', cfg.active_provider,
    'gemini_api_key', cfg.gemini_api_key,
    'gemini_model', cfg.gemini_model,
    'deepseek_api_key', cfg.deepseek_api_key,
    'deepseek_model', cfg.deepseek_model,
    'groq_api_key', cfg.groq_api_key,
    'groq_model', cfg.groq_model
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_global_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_ai_config() TO authenticated;

COMMENT ON POLICY "authenticated_read_global_settings" ON public.global_settings IS
  'Signed-in users may read platform flags; provider secrets are protected by column grants and served only through ai-chat.';

COMMENT ON FUNCTION public.get_global_ai_config() IS
  'Admin-only full AI configuration read. Non-admin users must use the ai-chat edge function.';

COMMIT;
