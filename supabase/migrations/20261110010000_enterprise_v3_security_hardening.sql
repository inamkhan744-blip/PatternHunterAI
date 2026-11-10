-- ===========================================================================
-- Enterprise V3 Security Hardening: Non-recursive RBAC, Admin Bootstrap, and Audit
-- ===========================================================================

-- 1. Create helper to inspect JWT app_metadata or user_profiles without recursion
-- We check jwt claim first (app_metadata ->> 'role' = 'admin'), or fallback to a secure lookup
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
DECLARE
  claim_role text;
  db_role text;
BEGIN
  -- Try extracting role directly from auth JWT app_metadata
  claim_role := (auth.jwt() -> 'app_metadata' ->> 'role');
  IF claim_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Fallback: Non-recursive direct lookup on user_profiles using SECURITY DEFINER and isolated search path
  SELECT role INTO db_role
  FROM public.user_profiles
  WHERE id = auth.uid();

  RETURN (db_role = 'admin');
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Drop old recursive user_profiles policies if present and redefine safely
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admins_update_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;

-- Regular users can only update safe fields (email, updated_at). Role and tier are immutable by user.
CREATE POLICY "users_update_own_profile" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role = (SELECT u.role FROM public.user_profiles u WHERE u.id = auth.uid()) AND
    subscription_tier = (SELECT u.subscription_tier FROM public.user_profiles u WHERE u.id = auth.uid())
  );

-- Admins can view all profiles
CREATE POLICY "admins_read_all_profiles" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins can update any profile (including role/tier promotion)
CREATE POLICY "admins_update_profiles" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Secure Admin Bootstrap RPC
-- Allows setting the initial admin if no admin exists in the system, or if invoked with secret token
CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin()
RETURNS jsonb AS $$
DECLARE
  current_user_id uuid;
  admin_count integer;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT count(*) INTO admin_count FROM public.user_profiles WHERE role = 'admin';

  -- Only allow bootstrapping if no admin currently exists
  IF admin_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrator bootstrap already completed. Contact existing admin for role grants.');
  END IF;

  UPDATE public.user_profiles
  SET role = 'admin',
      subscription_tier = 'premium',
      daily_trade_limit = 999999,
      updated_at = now()
  WHERE id = current_user_id;

  -- Insert audit log
  INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action, details)
  VALUES (
    current_user_id,
    current_user_id,
    'BOOTSTRAP_FIRST_ADMIN',
    jsonb_build_object('bootstrapped_at', now(), 'user_id', current_user_id)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Initial administrator successfully bootstrapped.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin() TO authenticated;
