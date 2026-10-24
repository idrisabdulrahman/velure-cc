-- Keep invoice fiscalization snapshots server-owned on both insert and update.
create or replace function public.guard_mock_clearance_artifacts() returns trigger
language plpgsql as $$
declare
  is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
  is_valid_mock_clearance boolean := coalesce((
    new.fiscalization ->> 'status' = 'mock_cleared'
    and new.fiscalization ->> 'provider' = 'mock'
    and new.fiscalization ->> 'environment' = 'sandbox'
    and new.fiscalization ->> 'mock' = 'true'
    and coalesce(new.fiscalization ->> 'mockIrn', '') like 'MOCK-IRN-%'
    and coalesce(new.fiscalization ->> 'qrCodePayload', '') like 'MOCK-SANDBOX|NOT-NRS-CLEARED|%'
  ), false);
begin
  if tg_op = 'INSERT' then
    -- Null and this exact object are the only client-safe insert values.
    -- Exact equality disallows every additional field, including uid, sid,
    -- QR payloads, provider metadata, or future artifact keys.
    if new.fiscalization is null
      or new.fiscalization = '{"status":"not_configured"}'::jsonb
    then
      return new;
    end if;
    if is_service_role and is_valid_mock_clearance then
      return new;
    end if;
    raise exception 'invoice fiscalization artifacts are server-owned';
  end if;

  if new.fiscalization is distinct from old.fiscalization then
    if old.fiscalization ->> 'status' = 'mock_cleared' then
      raise exception 'mock clearance artifacts are immutable';
    end if;
    if not is_service_role or not is_valid_mock_clearance then
      raise exception 'invoice fiscalization artifacts are server-owned';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_mock_clearance_immutable on public.invoices;
create trigger invoices_mock_clearance_immutable
  before insert or update on public.invoices
  for each row execute function public.guard_mock_clearance_artifacts();

-- Rollback to the preceding WP16 migration: restores its update-only guard.
-- This intentionally does not alter invoice rows or the append-only attempt
-- history/outcome constraint.
--
-- Down migration:
-- drop trigger if exists invoices_mock_clearance_immutable on public.invoices;
-- create or replace function public.guard_mock_clearance_artifacts() returns trigger
-- language plpgsql as $$
-- begin
--   if new.fiscalization is distinct from old.fiscalization then
--     if old.fiscalization ->> 'status' = 'mock_cleared' then
--       raise exception 'mock clearance artifacts are immutable';
--     end if;
--     if new.fiscalization ->> 'status' = 'mock_cleared' then
--       if coalesce(auth.role(), '') <> 'service_role'
--         or new.fiscalization ->> 'provider' is distinct from 'mock'
--         or new.fiscalization ->> 'environment' is distinct from 'sandbox'
--         or new.fiscalization ->> 'mock' is distinct from 'true'
--         or coalesce(new.fiscalization ->> 'mockIrn', '') not like 'MOCK-IRN-%'
--         or coalesce(new.fiscalization ->> 'qrCodePayload', '') not like 'MOCK-SANDBOX|NOT-NRS-CLEARED|%'
--       then
--         raise exception 'only the server may write visibly mock clearance artifacts';
--       end if;
--     end if;
--   end if;
--   return new;
-- end;
-- $$;
-- create trigger invoices_mock_clearance_immutable
--   before update of fiscalization on public.invoices
--   for each row execute function public.guard_mock_clearance_artifacts();
