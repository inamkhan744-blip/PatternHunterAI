-- ===========================================================================
-- PatternHunter AI — Global AI configuration vault
--
-- Replaces the `ai-chat` edge function's server-side GEMINI_API_KEY with an
-- admin-managed multi-provider configuration that the browser reads directly.
--
-- Access model:
--   * SELECT  — any authenticated user (the client calls providers directly,
--               so the keys must be readable by the signed-in browser).
--   * INSERT/UPDATE — admins only (public.is_admin()).
--   * DELETE  — nobody through the API (service_role only).
--
-- Idempotent: safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.global_settings (
  id text PRIMARY KEY,
  active_provider text NOT NULL DEFAULT 'gemini',
  gemini_api_key text,
  gemini_model text DEFAULT 'gemini-2.0-flash',
  deepseek_api_key text,
  deepseek_model text DEFAULT 'deepseek-chat',
  groq_api_key text,
  groq_model text DEFAULT 'llama-3.3-70b-versatile',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Singleton row guard + provider allow-list (kept idempotent for re-runs).
ALTER TABLE public.global_settings
  DROP CONSTRAINT IF EXISTS global_settings_singleton_row;
ALTER TABLE public.global_settings
  ADD CONSTRAINT global_settings_singleton_row CHECK (id = 'global_config');

ALTER TABLE public.global_settings
  DROP CONSTRAINT IF EXISTS global_settings_active_provider_check;
ALTER TABLE public.global_settings
  ADD CONSTRAINT global_settings_active_provider_check
  CHECK (active_provider IN ('gemini', 'deepseek', 'groq'));

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_settings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.global_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.global_settings TO authenticated;
GRANT ALL ON public.global_settings TO service_role;

DROP POLICY IF EXISTS "authenticated_read_global_settings" ON public.global_settings;
CREATE POLICY "authenticated_read_global_settings"
  ON public.global_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_insert_global_settings" ON public.global_settings;
CREATE POLICY "admin_insert_global_settings"
  ON public.global_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_global_settings" ON public.global_settings;
CREATE POLICY "admin_update_global_settings"
  ON public.global_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Keep updated_at/updated_by authoritative on every write.
CREATE OR REPLACE FUNCTION public.touch_global_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS global_settings_touch ON public.global_settings;
CREATE TRIGGER global_settings_touch
  BEFORE INSERT OR UPDATE ON public.global_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_global_settings();
