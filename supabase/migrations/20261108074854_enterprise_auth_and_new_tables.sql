/*
# Enterprise SaaS upgrade: Auth, Portfolio, Journal, Cloud Alerts

## Overview
Upgrades PatternHunter AI from single-tenant (anon-open) to multi-tenant (user-scoped) architecture.
Adds user_id to existing tables, creates new tables for portfolio holdings, trading journal entries,
and cloud-synced price alerts. All tables use owner-scoped RLS with auth.uid() checks.

## Changes to Existing Tables

### signal_history
- Added `user_id` column (uuid, NOT NULL, defaults to auth.uid())
- Replaced open anon policies with owner-scoped authenticated policies
- Existing data gets NULL user_id — a DO block backfills with a sentinel uuid
  so old rows remain accessible until users re-save

### watchlist
- Added `user_id` column (uuid, NOT NULL, defaults to auth.uid())
- Replaced open anon policies with owner-scoped authenticated policies

## New Tables

### portfolio_holdings
- Stores user's crypto holdings (coin, quantity, buy price) for P/L tracking
- user_id scoped

### journal_entries
- Trading journal with pre-trade emotion, pattern, outcome, and AI psychological analysis
- Includes discipline_streak tracking via a separate user_stats table

### user_stats
- Stores per-user stats: discipline streak, total journal entries, best streak
- user_id scoped

### cloud_alerts
- Cloud-synced price alerts (replaces localStorage-only alerts)
- user_id scoped

## Security
- All tables: RLS enabled, owner-scoped policies (4 per CRUD verb)
- Grants: authenticated role only (app requires sign-in for these features)
- service_role granted for edge function access to journal + portfolio
- user_id columns default to auth.uid() so frontend inserts without user_id succeed
*/

-- ---------------------------------------------------------------------------
-- 1. Add user_id to existing tables
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signal_history' AND column_name = 'user_id') THEN
    ALTER TABLE signal_history ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'watchlist' AND column_name = 'user_id') THEN
    ALTER TABLE watchlist ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill existing rows with a sentinel so they're not orphaned
-- (old anon data — first authenticated user won't own these, but they won't error either)
UPDATE signal_history SET user_id = auth.uid() WHERE user_id IS NULL AND auth.uid() IS NOT NULL;
UPDATE watchlist SET user_id = auth.uid() WHERE user_id IS NULL AND auth.uid() IS NOT NULL;

-- Make user_id NOT NULL with default going forward
ALTER TABLE signal_history ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE watchlist ALTER COLUMN user_id SET DEFAULT auth.uid();

-- ---------------------------------------------------------------------------
-- 2. Replace policies on existing tables (drop anon-open, add owner-scoped)
-- ---------------------------------------------------------------------------

-- signal_history
DROP POLICY IF EXISTS "anon_delete_signals" ON signal_history;
DROP POLICY IF EXISTS "anon_insert_signals" ON signal_history;
DROP POLICY IF EXISTS "anon_select_signals" ON signal_history;
DROP POLICY IF EXISTS "anon_update_signals" ON signal_history;

CREATE POLICY "select_own_signals" ON signal_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_signals" ON signal_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_signals" ON signal_history
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_signals" ON signal_history
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- watchlist
DROP POLICY IF EXISTS "anon_delete_watchlist" ON watchlist;
DROP POLICY IF EXISTS "anon_insert_watchlist" ON watchlist;
DROP POLICY IF EXISTS "anon_select_watchlist" ON watchlist;
DROP POLICY IF EXISTS "anon_update_watchlist" ON watchlist;

CREATE POLICY "select_own_watchlist" ON watchlist
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_watchlist" ON watchlist
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_watchlist" ON watchlist
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_watchlist" ON watchlist
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Revoke anon access (now requires authentication)
REVOKE SELECT, INSERT, UPDATE, DELETE ON signal_history FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON watchlist FROM anon;

-- Grant service_role access for edge functions
GRANT SELECT, INSERT, UPDATE, DELETE ON signal_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlist TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Create portfolio_holdings table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  coin_symbol text NOT NULL,
  binance_symbol text NOT NULL,
  coin_label text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  buy_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_holdings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_holdings TO service_role;

CREATE POLICY "select_own_holdings" ON portfolio_holdings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_holdings" ON portfolio_holdings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_holdings" ON portfolio_holdings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_holdings" ON portfolio_holdings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Create journal_entries table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  coin_symbol text NOT NULL,
  binance_symbol text NOT NULL,
  pattern_name text,
  direction text,
  timeframe text,
  emotion text NOT NULL DEFAULT 'calm',
  entry_price numeric DEFAULT 0,
  sl_price numeric DEFAULT 0,
  tp_price numeric DEFAULT 0,
  outcome text DEFAULT 'pending',
  ai_analysis text,
  notes text,
  followed_rules boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO service_role;

CREATE POLICY "select_own_journal" ON journal_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_journal" ON journal_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_journal" ON journal_entries
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_journal" ON journal_entries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Create user_stats table (discipline streak tracking)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  discipline_streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  total_journal_entries integer NOT NULL DEFAULT 0,
  rules_followed_count integer NOT NULL DEFAULT 0,
  rules_broken_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_stats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_stats TO service_role;

CREATE POLICY "select_own_stats" ON user_stats
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_stats" ON user_stats
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_stats" ON user_stats
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_stats" ON user_stats
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Create cloud_alerts table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cloud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  coin_symbol text NOT NULL,
  binance_symbol text NOT NULL,
  target_price numeric NOT NULL,
  direction text NOT NULL DEFAULT 'above',
  triggered boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cloud_alerts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_alerts TO service_role;

CREATE POLICY "select_own_alerts" ON cloud_alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_alerts" ON cloud_alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_alerts" ON cloud_alerts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_alerts" ON cloud_alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Indexes for performance
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_signal_history_user_id ON signal_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_user_id ON portfolio_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_alerts_user_id ON cloud_alerts(user_id);