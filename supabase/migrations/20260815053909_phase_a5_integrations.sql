-- Velure Phase A5: owner-scoped integration records and server-only secrets.

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  provider public.provider not null,
  status text not null check (status in ('disconnected', 'connected', 'error')),
  auth_type text not null check (auth_type in ('oauth', 'webhook', 'api_key', 'manual')),
  external_account_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  webhook_url text,
  default_revenue_account text,
  default_tax_code text,
  config_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index integration_connections_owner_idx on public.integration_connections (owner_id);
create index integration_connections_owner_provider_idx
  on public.integration_connections (owner_id, provider);

create table public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  provider public.provider not null,
  entity_type text not null check (entity_type in ('invoice', 'client', 'export')),
  entity_id text not null check (btrim(entity_id) <> ''),
  direction text not null check (direction = 'push'),
  status public.sync_status not null check (status <> 'idle'),
  request_payload jsonb,
  response_payload jsonb,
  error text,
  retry_count integer not null check (retry_count >= 0),
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index integration_sync_jobs_owner_idx on public.integration_sync_jobs (owner_id);

create table public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  provider public.provider not null,
  level text not null check (level in ('info', 'error')),
  message text not null check (btrim(message) <> ''),
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now()
);
create index integration_logs_owner_idx on public.integration_logs (owner_id);

create table public.integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  provider public.provider not null,
  endpoint text not null check (btrim(endpoint) <> ''),
  secret text,
  active boolean not null,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index integration_webhooks_owner_idx on public.integration_webhooks (owner_id);

alter table public.integration_connections enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_logs enable row level security;
alter table public.integration_webhooks enable row level security;

revoke all on table
  public.integration_connections,
  public.integration_sync_jobs,
  public.integration_logs,
  public.integration_webhooks
from anon, authenticated;

grant select, insert, update, delete on table
  public.integration_sync_jobs,
  public.integration_logs
to authenticated;

create policy integration_sync_jobs_pending_verified_identity on public.integration_sync_jobs
  for all to authenticated using (false) with check (false);
create policy integration_logs_pending_verified_identity on public.integration_logs
  for all to authenticated using (false) with check (false);
