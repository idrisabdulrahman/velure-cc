-- H2: encrypted, workspace-owned credentials. Authenticated clients have no
-- grants or policies; only server code using the service role can access rows.
create table public.einvoice_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  encrypted_bundle text not null check (btrim(encrypted_bundle) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider_key),
  unique (id, workspace_id)
);

alter table public.einvoice_provider_credentials enable row level security;
revoke all on public.einvoice_provider_credentials from anon, authenticated;
grant select, insert, update, delete on public.einvoice_provider_credentials to service_role;

-- Rollback: drop table public.einvoice_provider_credentials;
