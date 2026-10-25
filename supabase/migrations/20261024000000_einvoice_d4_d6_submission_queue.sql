-- D4/D6/D9: durable mock submission queue and append-only attempt snapshots.
-- Writes are server-only; authenticated clients may only read within a workspace.
create table public.invoice_submission_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  idempotency_key uuid not null default gen_random_uuid(),
  submission_snapshot jsonb not null,
  provider text not null default 'mock' check (provider = 'mock'),
  status text not null default 'queued' check (status in ('queued','processing','completed','rejected','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  provider_reference text,
  last_outcome text,
  last_error_code text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, invoice_id),
  unique (workspace_id, idempotency_key),
  foreign key (invoice_id, workspace_id)
    references public.invoices(id, workspace_id) on delete restrict
);
create or replace function public.invoice_submission_queue_identity_immutable() returns trigger
language plpgsql as $$
begin
  if new.workspace_id <> old.workspace_id
    or new.invoice_id <> old.invoice_id
    or new.idempotency_key <> old.idempotency_key
    or new.submission_snapshot <> old.submission_snapshot then
    raise exception 'invoice submission identity and validated snapshot are immutable';
  end if;
  return new;
end;
$$;
create trigger invoice_submission_queue_identity_immutable
  before update on public.invoice_submission_queue
  for each row execute function public.invoice_submission_queue_identity_immutable();
create index invoice_submission_queue_due_idx
  on public.invoice_submission_queue(next_attempt_at)
  where status in ('queued','processing');
create index invoice_submission_queue_workspace_idx
  on public.invoice_submission_queue(workspace_id, created_at desc);

create table public.invoice_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  submission_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  event_type text not null check (event_type in ('started','result')),
  outcome text not null check (outcome in ('started','accepted','rejected','timeout','duplicate','interrupted','error')),
  request_snapshot jsonb not null,
  response_snapshot jsonb,
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (workspace_id, submission_id, attempt_number, event_type),
  foreign key (submission_id, workspace_id)
    references public.invoice_submission_queue(id, workspace_id) on delete cascade
);
create index invoice_submission_attempts_order_idx
  on public.invoice_submission_attempts(workspace_id, submission_id, attempt_number);

alter table public.invoice_submission_queue enable row level security;
alter table public.invoice_submission_attempts enable row level security;
revoke all on public.invoice_submission_queue, public.invoice_submission_attempts from anon, authenticated;
grant select on public.invoice_submission_queue, public.invoice_submission_attempts to authenticated;
create policy invoice_submission_queue_member_select on public.invoice_submission_queue
  for select to authenticated using (app.is_workspace_member(workspace_id));
create policy invoice_submission_attempts_member_select on public.invoice_submission_attempts
  for select to authenticated using (app.is_workspace_member(workspace_id));

create or replace function public.invoice_submission_attempts_append_only() returns trigger
language plpgsql as $$
begin
  -- Like invoice_audit_log, allow only nested FK cascades from account/queue
  -- deletion; direct service-role deletion and TRUNCATE stay prohibited.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'invoice_submission_attempts is append-only; % is not permitted', tg_op;
end;
$$;
create trigger invoice_submission_attempts_no_update
  before update on public.invoice_submission_attempts
  for each row execute function public.invoice_submission_attempts_append_only();
create trigger invoice_submission_attempts_no_delete
  before delete on public.invoice_submission_attempts
  for each row execute function public.invoice_submission_attempts_append_only();
create trigger invoice_submission_attempts_no_truncate
  before truncate on public.invoice_submission_attempts
  for each statement execute function public.invoice_submission_attempts_append_only();

-- Rollback (run only after explicitly deciding to discard queue history):
-- drop trigger if exists invoice_submission_attempts_no_truncate on public.invoice_submission_attempts;
-- drop trigger if exists invoice_submission_queue_identity_immutable on public.invoice_submission_queue;
-- drop trigger if exists invoice_submission_attempts_no_delete on public.invoice_submission_attempts;
-- drop trigger if exists invoice_submission_attempts_no_update on public.invoice_submission_attempts;
-- drop function if exists public.invoice_submission_attempts_append_only();
-- drop function if exists public.invoice_submission_queue_identity_immutable();
-- drop policy if exists invoice_submission_attempts_member_select on public.invoice_submission_attempts;
-- drop policy if exists invoice_submission_queue_member_select on public.invoice_submission_queue;
-- drop table if exists public.invoice_submission_attempts;
-- drop table if exists public.invoice_submission_queue;
