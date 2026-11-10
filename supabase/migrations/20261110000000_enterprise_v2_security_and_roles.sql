-- ===========================================================================
-- Enterprise V2 Security, Role-Based Access Control, and Audit Logging
-- ===========================================================================

-- 1. Create user_profiles table with roles and subscription tiers
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin')),
  subscription_tier text NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'premium')),
  subscription_status text NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing')),
  subscription_expires_at timestamptz,
  daily_trade_limit integer NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON user_profiles TO authenticated;
GRANT ALL ON user_profiles TO service_role;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- Users can update their own non-privileged preferences
CREATE POLICY "users_update_own_profile" ON user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role = (SELECT role FROM user_profiles WHERE id = auth.uid()) AND
    subscription_tier = (SELECT subscription_tier FROM user_profiles WHERE id = auth.uid())
  );

-- Helper security functions
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admins can read all profiles
CREATE POLICY "admins_read_all_profiles" ON user_profiles
  FOR SELECT TO authenticated USING (is_admin());

-- Admins can update any profile (role/tier changes)
CREATE POLICY "admins_update_profiles" ON user_profiles
  FOR UPDATE TO authenticated USING (is_admin());

-- 2. Create trading_audit_logs table
CREATE TABLE IF NOT EXISTS trading_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL,
  symbol text NOT NULL,
  action text NOT NULL,
  order_type text NOT NULL,
  side text NOT NULL,
  quantity numeric NOT NULL,
  price numeric,
  leverage integer DEFAULT 1,
  execution_mode text NOT NULL DEFAULT 'PAPER',
  status text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trading_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON trading_audit_logs TO authenticated;
GRANT ALL ON trading_audit_logs TO service_role;

CREATE POLICY "users_read_own_trading_audit" ON trading_audit_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_trading_audit" ON trading_audit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 3. Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON admin_audit_logs TO authenticated;
GRANT ALL ON admin_audit_logs TO service_role;

CREATE POLICY "admins_read_admin_audit" ON admin_audit_logs
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admins_insert_admin_audit" ON admin_audit_logs
  FOR INSERT TO authenticated WITH CHECK (is_admin());

-- 4. Automatically provision user_profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role, subscription_tier)
  VALUES (
    new.id,
    new.email,
    'user',
    'free'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_subscription_tier ON user_profiles(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_trading_audit_logs_user_id ON trading_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_audit_logs_created_at ON trading_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
