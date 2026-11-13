-- ============================================================================
-- Schedule the Auto-Pilot worker
--
-- The worker existed but nothing invoked it: the schedule in
-- `20261112180000_server_auto_pilot.sql` was only a comment. Server Auto-Pilot
-- therefore never ran. This migration schedules it when the deployment has the
-- prerequisites, and otherwise leaves a notice instead of failing the migration.
--
-- Prerequisites (Supabase dashboard → Project Settings → Vault):
--   project_url  = https://<project-ref>.supabase.co
--   secret_key   = the project's service-role / secret key
--
-- The URL and key are read from Vault inside the cron command, so neither is
-- written into this migration, the job table, or version control.
-- ============================================================================

DO $$
DECLARE
  has_cron boolean;
  has_net boolean;
  has_vault boolean;
  has_url boolean;
  has_key boolean;
  job_command text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_cron;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO has_net;
  SELECT to_regclass('vault.decrypted_secrets') IS NOT NULL INTO has_vault;

  IF NOT has_cron OR NOT has_net THEN
    RAISE NOTICE 'Auto-Pilot schedule skipped: enable the pg_cron and pg_net extensions first.';
    RETURN;
  END IF;

  IF NOT has_vault THEN
    RAISE NOTICE 'Auto-Pilot schedule skipped: Supabase Vault is unavailable.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1
  ) INTO has_url;
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'secret_key' LIMIT 1
  ) INTO has_key;

  IF NOT has_url OR NOT has_key THEN
    RAISE NOTICE
      'Auto-Pilot schedule skipped: add Vault secrets "project_url" and "secret_key", then re-run this migration.';
    RETURN;
  END IF;

  job_command := $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
             || '/functions/v1/auto-trade-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'secret_key'),
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'secret_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cron$;

  -- Replace an older definition instead of creating a duplicate job.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'patternhunter-auto-pilot';

  PERFORM cron.schedule('patternhunter-auto-pilot', '* * * * *', job_command);

  RAISE NOTICE 'Auto-Pilot worker scheduled every minute.';
END;
$$;
