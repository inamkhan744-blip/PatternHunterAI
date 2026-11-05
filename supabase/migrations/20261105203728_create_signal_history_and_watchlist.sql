/*
# Create signal_history and watchlist tables (single-tenant, no auth)

1. New Tables
- `signal_history`: stores past trading signals with their outcome (TP/SL hit).
  - id (uuid PK)
  - created_at (timestamptz, default now())
  - coin_symbol (text, e.g. "BTC")
  - coin_label (text, e.g. "Bitcoin")
  - binance_symbol (text, e.g. "BTCUSDT")
  - pattern_name (text, e.g. "Double Top")
  - pattern_type (text, e.g. "double_top")
  - direction (text, "bullish" or "bearish")
  - timeframe (text, e.g. "1h")
  - entry_price (numeric)
  - sl_price (numeric)
  - tp_price (numeric)
  - outcome (text: 'pending', 'hit_tp', 'hit_sl')

- `watchlist`: stores user's starred coins.
  - id (uuid PK)
  - created_at (timestamptz, default now())
  - coin_symbol (text)
  - coin_label (text)
  - binance_symbol (text, unique)

2. Security
- Enable RLS on both tables.
- Grant CRUD to anon + authenticated (no-auth single-tenant app).
- Allow anon + authenticated full CRUD since data is intentionally shared/public.
*/

CREATE TABLE IF NOT EXISTS signal_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  coin_symbol text NOT NULL,
  coin_label text NOT NULL,
  binance_symbol text NOT NULL,
  pattern_name text NOT NULL,
  pattern_type text NOT NULL,
  direction text NOT NULL DEFAULT 'bullish',
  timeframe text NOT NULL DEFAULT '1h',
  entry_price numeric NOT NULL DEFAULT 0,
  sl_price numeric NOT NULL DEFAULT 0,
  tp_price numeric NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  coin_symbol text NOT NULL,
  coin_label text NOT NULL,
  binance_symbol text NOT NULL UNIQUE
);

ALTER TABLE signal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON signal_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlist TO anon, authenticated;

-- signal_history policies
DROP POLICY IF EXISTS "anon_select_signals" ON signal_history;
CREATE POLICY "anon_select_signals" ON signal_history FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_signals" ON signal_history;
CREATE POLICY "anon_insert_signals" ON signal_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_signals" ON signal_history;
CREATE POLICY "anon_update_signals" ON signal_history FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_signals" ON signal_history;
CREATE POLICY "anon_delete_signals" ON signal_history FOR DELETE
  TO anon, authenticated USING (true);

-- watchlist policies
DROP POLICY IF EXISTS "anon_select_watchlist" ON watchlist;
CREATE POLICY "anon_select_watchlist" ON watchlist FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_watchlist" ON watchlist;
CREATE POLICY "anon_insert_watchlist" ON watchlist FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_watchlist" ON watchlist;
CREATE POLICY "anon_update_watchlist" ON watchlist FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_watchlist" ON watchlist;
CREATE POLICY "anon_delete_watchlist" ON watchlist FOR DELETE
  TO anon, authenticated USING (true);
