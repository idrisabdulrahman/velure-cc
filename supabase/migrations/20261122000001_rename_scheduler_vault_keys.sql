-- Invoicly rename (2026-11-22): the scheduler Vault keys.
--
-- The cron's HTTP trigger read `velure_scheduler_url` / `velure_scheduler_secret`
-- from Vault (20261029000000). This migration repoints it at the renamed keys
-- `invoicly_scheduler_url` / `invoicly_scheduler_secret`.
--
-- OPERATOR STEPS (before or right after applying — the function tolerates a
-- missing key by skipping the tick with a NOTICE, so the safe order is):
--   1. Create the new Vault secrets with the same values as the old ones:
--        select vault.create_secret('<url>', 'invoicly_scheduler_url');
--        select vault.create_secret('<secret>', 'invoicly_scheduler_secret');
--      (The secret value equals `INVOICE_SCHEDULER_SECRET` on the Worker.)
--   2. Apply this migration.
--   3. Verify one tick, then drop the legacy keys:
--        select vault.remove_secret((select id from vault.secrets
--          where name = 'velure_scheduler_url'));
--        select vault.remove_secret((select id from vault.secrets
--          where name = 'velure_scheduler_secret'));
--
-- REVERSIBLE: recreate 20261029000000's function body (it reads the legacy
-- key names) and, if the legacy keys were already dropped, re-create them
-- from the new keys' values before rolling back.
--
-- Also (applied live 2026-11-22 alongside this file): the pg_cron job itself
-- was renamed `velure-scheduler-tick` → `invoicly-scheduler-tick`:
--   select cron.unschedule('velure-scheduler-tick');
--   select cron.schedule('invoicly-scheduler-tick', '*/10 * * * *',
--     $$select public.invoke_scheduler_tick()$$);
-- Rollback mirrors it with the names swapped.

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
   where name = 'invoicly_scheduler_url';

  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where name = 'invoicly_scheduler_secret';

  if v_url is null or btrim(v_url) = '' or v_secret is null or btrim(v_secret) = '' then
    raise notice 'Invoicly scheduler: vault secrets invoicly_scheduler_url / invoicly_scheduler_secret are not configured; skipping tick.';
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_scheduler_tick() from public;
revoke all on function public.invoke_scheduler_tick() from anon;
revoke all on function public.invoke_scheduler_tick() from authenticated;
