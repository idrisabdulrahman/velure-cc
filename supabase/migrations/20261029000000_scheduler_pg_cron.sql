-- T1 — the scheduler host: Supabase pg_cron + pg_net, plus the reminder-event
-- idempotency index the sweep relies on.
--
-- Before this migration nothing ran the production jobs: every endpoint needed
-- an operator or a hand-wired pinger, so reminders, scheduled sends, e-invoice
-- sandbox submissions, Paystack recovery and recurring generation were dead in
-- production (docs/AUDIT-2026-10.md §1, verdict Confirmed).
--
-- This migration is deliberately self-contained and heavily guarded:
--   * the reminder-events unique partial index is safe to add — verified
--     against the live project that no duplicate (invoice_id, stage, channel)
--     keys with status <> 'failed' exist;
--   * pg_cron and pg_net are enabled only if the platform allows it; if the
--     extension is unavailable the migration raises a NOTICE and continues
--     instead of failing the whole chain (the tick endpoint is still callable
--     by an external scheduler);
--   * the HTTP trigger reads the endpoint URL and the bearer secret from
--     Supabase Vault, so no secret is ever stored in this file or in git.
--
-- OPERATOR SETUP (once, after applying this migration):
--
--   select vault.create_secret(
--     'https://<your-site>/api/cron/tick', 'velure_scheduler_url'
--   );
--   select vault.create_secret(
--     '<the same value as INVOICE_SCHEDULER_SECRET>', 'velure_scheduler_secret'
--   );
--
-- Re-run the schedule block (bottom of this file) after creating the secrets;
-- the job then fires every 10 minutes. Without the secrets the job logs a
-- NOTICE and does nothing — it never posts an unauthenticated request.
--
-- Fully reversible: see the DOWN section at the bottom. No invoice, reminder,
-- recurring or audit row is modified by this migration.

-- ---------------------------------------------------------- idempotency index
-- One live reminder event per (invoice, stage, channel). A failed attempt may
-- be retried, so `failed` rows are excluded. `queueReminderEvent` already
-- pre-checks this; the index closes the race between two overlapping sweeps
-- (the app treats the resulting 23505 as "already queued", not an error).
create unique index if not exists reminder_events_invoice_stage_channel_unique
  on public.reminder_events (invoice_id, stage, channel)
  where status <> 'failed';

-- ------------------------------------------------------------- pg_cron + pg_net
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- Supabase installs pg_cron's objects outside the public schema; the
      -- extension itself always creates the `cron` schema that `cron.schedule`
      -- lives in.
      create extension pg_cron with schema pg_catalog;
    exception
      when others then
        raise notice 'Velure scheduler: pg_cron could not be enabled (%). Enable it from Dashboard -> Integrations -> Cron and re-run the schedule block.', sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net with schema extensions;
    exception
      when others then
        raise notice 'Velure scheduler: pg_net could not be enabled (%). Enable it from Dashboard -> Database -> Extensions and re-run the schedule block.', sqlerrm;
    end;
  end if;
end
$do$;

-- --------------------------------------------------------- HTTP trigger helper
-- SECURITY DEFINER is required so the cron job can read Vault and call net.http_post
-- without granting either to normal roles. It only POSTs to the URL stored in
-- Vault and never returns secret material. Execute is revoked from every client
-- role below; only the database scheduler (postgres) runs it.
create or replace function public.invoke_scheduler_tick()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_url
    from vault.decrypted_secrets
   where name = 'velure_scheduler_url';

  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where name = 'velure_scheduler_secret';

  if v_url is null or btrim(v_url) = '' or v_secret is null or btrim(v_secret) = '' then
    raise notice 'Velure scheduler: vault secrets velure_scheduler_url / velure_scheduler_secret are not configured; skipping tick.';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_scheduler_tick() from public;
revoke all on function public.invoke_scheduler_tick() from anon;
revoke all on function public.invoke_scheduler_tick() from authenticated;

-- ---------------------------------------------------------------- schedule job
-- 10 minutes: frequent enough for scheduled sends and the 15-minute Paystack
-- grace window, cheap enough that the per-workspace reminder scan stays a
-- small transaction. Every job inside the tick is idempotent.
do $do$
begin
  -- Schedule only when BOTH halves exist: pg_cron to fire, pg_net to post.
  -- Otherwise every tick would fail on a missing `net.http_post` and spam
  -- cron.job_run_details.
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
  then
    if exists (select 1 from cron.job where jobname = 'velure-scheduler-tick') then
      perform cron.unschedule('velure-scheduler-tick');
    end if;
    perform cron.schedule(
      'velure-scheduler-tick',
      '*/10 * * * *',
      'select public.invoke_scheduler_tick()'
    );
  else
    raise notice 'Velure scheduler: pg_cron and pg_net are not both available, so the tick must be triggered externally (POST /api/cron/tick with a Bearer INVOICE_SCHEDULER_SECRET).';
  end if;
end
$do$;

-- ---------------------------------------------------------------------- DOWN
-- Run manually to reverse this migration:
--
--   do $do$
--   begin
--     if exists (select 1 from pg_extension where extname = 'pg_cron')
--        and exists (select 1 from pg_namespace where nspname = 'cron')
--        and exists (select 1 from cron.job where jobname = 'velure-scheduler-tick')
--     then
--       perform cron.unschedule('velure-scheduler-tick');
--     end if;
--   end
--   $do$;
--   drop function if exists public.invoke_scheduler_tick();
--   drop index if exists public.reminder_events_invoice_stage_channel_unique;
--   -- Only if nothing else uses them:
--   drop extension if exists pg_net;
--   drop extension if exists pg_cron;