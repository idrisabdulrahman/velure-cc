-- WP16: allow one explicitly mock-only clearance snapshot and make it write-once.
alter table public.invoice_submission_attempts
  drop constraint invoice_submission_attempts_outcome_check;
alter table public.invoice_submission_attempts
  add constraint invoice_submission_attempts_outcome_check
  check (outcome in ('started','accepted','cleared','rejected','timeout','duplicate','interrupted','error'));

create or replace function public.guard_mock_clearance_artifacts() returns trigger
language plpgsql as $$
begin
  if new.fiscalization is distinct from old.fiscalization then
    if old.fiscalization ->> 'status' = 'mock_cleared' then
      raise exception 'mock clearance artifacts are immutable';
    end if;

    if new.fiscalization ->> 'status' = 'mock_cleared' then
      if coalesce(auth.role(), '') <> 'service_role'
        or new.fiscalization ->> 'provider' is distinct from 'mock'
        or new.fiscalization ->> 'environment' is distinct from 'sandbox'
        or new.fiscalization ->> 'mock' is distinct from 'true'
        or coalesce(new.fiscalization ->> 'mockIrn', '') not like 'MOCK-IRN-%'
        or coalesce(new.fiscalization ->> 'qrCodePayload', '') not like 'MOCK-SANDBOX|NOT-NRS-CLEARED|%'
      then
        raise exception 'only the server may write visibly mock clearance artifacts';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_mock_clearance_immutable
  before update of fiscalization on public.invoices
  for each row execute function public.guard_mock_clearance_artifacts();

-- Rollback:
-- drop trigger if exists invoices_mock_clearance_immutable on public.invoices;
-- drop function if exists public.guard_mock_clearance_artifacts();
-- alter table public.invoice_submission_attempts drop constraint invoice_submission_attempts_outcome_check;
-- alter table public.invoice_submission_attempts add constraint invoice_submission_attempts_outcome_check
--   check (outcome in ('started','accepted','rejected','timeout','duplicate','interrupted','error'));
