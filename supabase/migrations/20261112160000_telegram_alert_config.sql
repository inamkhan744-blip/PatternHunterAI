-- ---------------------------------------------------------------------------
-- Telegram alert configuration (server-side, encrypted)
--
-- The bot token used to live in localStorage and be called directly from the
-- browser, which both leaked it to any XSS and could not work at all because the
-- Telegram Bot API sends no CORS headers. It now lives here, encrypted with the
-- same AES-256-GCM key the exchange vault uses, and is only ever decrypted inside
-- the `telegram-alert` edge function.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_telegram_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  token_ciphertext text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_telegram_config ENABLE ROW LEVEL SECURITY;

-- No client role may read the ciphertext or write the row directly.
REVOKE ALL ON public.user_telegram_config FROM anon, authenticated;
GRANT ALL ON public.user_telegram_config TO service_role;

COMMENT ON TABLE public.user_telegram_config IS
  'Telegram bot token encrypted with AES-256-GCM by the telegram-alert edge function. Accessible only via service_role.';
