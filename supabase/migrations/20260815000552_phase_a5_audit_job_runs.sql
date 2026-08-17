-- Velure Phase A5: nullable-workspace audit logs and job runs.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_id text,
  actor_type text not null check (actor_type in ('user', 'system')),
  action public.audit_action not null,
  resource_type text not null check (btrim(resource_type) <> ''),
  resource_id text,
  result public.audit_result not null,
  message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_workspace_idx on public.audit_logs (workspace_id);
create index audit_logs_workspace_created_idx on public.audit_logs (workspace_id, created_at);
create index audit_logs_action_idx on public.audit_logs (action);
create index audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  job_name text not null check (btrim(job_name) <> ''),
  status public.job_status not null,
  duration_ms bigint not null check (duration_ms >= 0),
  retries integer not null check (retries >= 0),
  error text,
  result_json jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (completed_at >= started_at)
);
create index job_runs_workspace_idx on public.job_runs (workspace_id);
create index job_runs_name_idx on public.job_runs (job_name);
create index job_runs_created_idx on public.job_runs (created_at);

alter table public.audit_logs enable row level security;
alter table public.job_runs enable row level security;
revoke all on table public.audit_logs, public.job_runs from anon, authenticated;
grant select, insert, update, delete on table public.audit_logs, public.job_runs to authenticated;
create policy audit_logs_pending_verified_identity on public.audit_logs for all to authenticated using (false) with check (false);
create policy job_runs_pending_verified_identity on public.job_runs for all to authenticated using (false) with check (false);
