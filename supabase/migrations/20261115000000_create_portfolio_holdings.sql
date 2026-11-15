/*
# Portfolio holdings table

## Overview
Adds a `portfolio_holdings` table to persist user portfolio positions in Supabase.
Each row belongs to a single user (auth.users). Row-Level Security ensures users
can only manage their own rows.

## Table Structure
- id: uuid primary key
- user_id: uuid referencing auth.users(id) on delete cascade
- coin: text (coin/binance symbol)
- quantity: numeric
- buy_price: numeric
- created_at: timestamptz
*/

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  coin text NOT NULL,
  quantity numeric NOT NULL,
  buy_price numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_holdings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_holdings TO service_role;

DROP POLICY IF EXISTS "select_own_portfolio_holdings" ON portfolio_holdings;
DROP POLICY IF EXISTS "insert_own_portfolio_holdings" ON portfolio_holdings;
DROP POLICY IF EXISTS "update_own_portfolio_holdings" ON portfolio_holdings;
DROP POLICY IF EXISTS "delete_own_portfolio_holdings" ON portfolio_holdings;

CREATE POLICY "select_own_portfolio_holdings"
  ON portfolio_holdings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_portfolio_holdings"
  ON portfolio_holdings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_portfolio_holdings"
  ON portfolio_holdings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_portfolio_holdings"
  ON portfolio_holdings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_user_id ON portfolio_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_created_at ON portfolio_holdings(created_at DESC);