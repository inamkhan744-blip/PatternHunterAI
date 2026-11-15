-- Add idempotency key to trades to prevent double execution.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS signal_key text;

CREATE UNIQUE INDEX IF NOT EXISTS trades_signal_key_unique
  ON public.trades (signal_key)
  WHERE signal_key IS NOT NULL;