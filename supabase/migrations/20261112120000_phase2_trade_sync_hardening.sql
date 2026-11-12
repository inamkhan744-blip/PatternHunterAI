/*
# Phase 2: trade / watchlist / signal cross-device sync hardening

Non-destructive. This migration adds nothing that overwrites or deletes user data:
it only ensures the columns, policies, indexes and Realtime publication required by
the Phase 2 sync layer exist on every deployment, including databases created before
the `trades` table migration ran.

## What it guarantees
- `trades` exists with all columns the client reads/writes (idempotent ADD COLUMN).
- `is_paper` is non-null so PAPER and REAL history can never be confused.
- RLS owner policies exist for SELECT / INSERT / UPDATE / DELETE.
- Realtime publication includes `trades` and `watchlist` (idempotent).
- A per-user (user_id, created_at) index keeps trade-history loads fast.
- `watchlist` has the per-user uniqueness the client upserts against.
*/

-- ---------------------------------------------------------------------------
-- 1. Ensure the trades table and every column used by the sync client exist
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trades (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS exit_price numeric;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS pnl numeric NOT NULL DEFAULT 0;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS pnl_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS leverage numeric NOT NULL DEFAULT 1;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS market_type text NOT NULL DEFAULT 'Spot';
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS stop_loss_price numeric;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS take_profit_price numeric;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS exit_reason text;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS is_paper boolean NOT NULL DEFAULT false;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Existing rows without a paper flag were live trades recorded before the flag existed.
UPDATE public.trades SET is_paper = false WHERE is_paper IS NULL;

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Owner-scoped policies (recreated idempotently, never widened)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "select_own_trades" ON public.trades;
CREATE POLICY "select_own_trades" ON public.trades
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_trades" ON public.trades;
CREATE POLICY "insert_own_trades" ON public.trades
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_trades" ON public.trades;
CREATE POLICY "update_own_trades" ON public.trades
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_trades" ON public.trades;
CREATE POLICY "delete_own_trades" ON public.trades
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO service_role;

DROP POLICY IF EXISTS "select_own_watchlist" ON public.watchlist;
CREATE POLICY "select_own_watchlist" ON public.watchlist
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_watchlist" ON public.watchlist;
CREATE POLICY "insert_own_watchlist" ON public.watchlist
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_watchlist" ON public.watchlist;
CREATE POLICY "update_own_watchlist" ON public.watchlist
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_watchlist" ON public.watchlist;
CREATE POLICY "delete_own_watchlist" ON public.watchlist
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Indexes for sync reads and the watchlist upsert conflict target
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON public.trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_user_paper ON public.trades(user_id, is_paper);
CREATE INDEX IF NOT EXISTS idx_trades_user_created ON public.trades(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_symbol ON public.trades(user_id, symbol);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_watchlist_user_symbol
  ON public.watchlist (user_id, binance_symbol);
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON public.watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_signal_history_user_id ON public.signal_history(user_id);

-- ---------------------------------------------------------------------------
-- 4. Realtime publication (cross-device updates)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'watchlist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.watchlist;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'signal_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_history;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN duplicate_object THEN
    NULL;
END $$;

COMMENT ON COLUMN public.trades.is_paper IS
  'true = paper/simulated position. Live and paper records are never mixed; clients filter on this flag.';
