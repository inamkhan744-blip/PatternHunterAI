/*
# Trades table for cross-device sync & Realtime tracking

## Overview
Adds a centralized `trades` table to persist active positions and closed trade history
in Supabase across devices and browser sessions. Supports real vs paper trading isolation
via `is_paper` flag, and enables Supabase Realtime broadcast for instant desktop/mobile synchronization.

## Table Structure
- `id`: text primary key (supports client-generated trade IDs e.g. TRD-1700000000-123 or UUIDs)
- `user_id`: uuid referencing auth.users(id) on delete cascade
- `symbol`: text NOT NULL (e.g. BTCUSDT)
- `direction`: text NOT NULL (LONG | SHORT)
- `entry_price`: numeric NOT NULL
- `exit_price`: numeric
- `status`: text NOT NULL DEFAULT 'OPEN' (OPEN | CLOSED)
- `pnl`: numeric NOT NULL DEFAULT 0
- `pnl_percent`: numeric NOT NULL DEFAULT 0
- `quantity`: numeric NOT NULL DEFAULT 0
- `leverage`: numeric NOT NULL DEFAULT 1
- `market_type`: text NOT NULL DEFAULT 'Spot' (Spot | Futures)
- `stop_loss_price`: numeric
- `take_profit_price`: numeric
- `exit_reason`: text (MANUAL | TP | SL | KILL_SWITCH)
- `source`: text NOT NULL DEFAULT 'MANUAL' (MANUAL | AUTO-PILOT)
- `is_paper`: boolean NOT NULL DEFAULT false
- `created_at`: timestamptz DEFAULT now()
- `closed_at`: timestamptz

## Security & Realtime
- Row-Level Security (RLS) enabled
- Authenticated user policies for SELECT, INSERT, UPDATE, DELETE matching auth.uid() = user_id
- Realtime publication added for instant cross-device updates
*/

CREATE TABLE IF NOT EXISTS trades (
  id text PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric,
  status text NOT NULL DEFAULT 'OPEN',
  pnl numeric NOT NULL DEFAULT 0,
  pnl_percent numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  leverage numeric NOT NULL DEFAULT 1,
  market_type text NOT NULL DEFAULT 'Spot',
  stop_loss_price numeric,
  take_profit_price numeric,
  exit_reason text,
  source text NOT NULL DEFAULT 'MANUAL',
  is_paper boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON trades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON trades TO service_role;

DROP POLICY IF EXISTS "select_own_trades" ON trades;
DROP POLICY IF EXISTS "insert_own_trades" ON trades;
DROP POLICY IF EXISTS "update_own_trades" ON trades;
DROP POLICY IF EXISTS "delete_own_trades" ON trades;

CREATE POLICY "select_own_trades" ON trades
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_trades" ON trades
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_trades" ON trades
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_trades" ON trades
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_user_symbol ON trades(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_user_paper ON trades(user_id, is_paper);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

-- Enable Supabase Realtime broadcast on the trades table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trades;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;
