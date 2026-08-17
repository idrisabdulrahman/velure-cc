-- Velure Phase A9: activate real tenancy RLS policies.
--
-- APPLIED to velure-cc 2026-08-17 (atomically, BEGIN/COMMIT via the
-- management API) after the identity-bridge gate passed: the custom access
-- token hook is enabled and the live tenancy suite (a9-live-tenancy.mjs)
-- ran 29/29 green against real OIDC JWTs. The gate note below is historical.
--
-- Replaces every `*_pending_verified_identity` deny-all bootstrap policy with
-- membership/owner policies built on the Phase A4 helpers:
--
--     app.current_user_id()        auth.jwt() ->> 'sub'
--     app.is_workspace_member(ws)  membership lookup (security definer)
--
-- GATE (do not apply until verified live): the Better Auth -> Supabase
-- identity bridge must be proven against the project first -- the Supabase JWT
-- `sub` must equal the Better Auth user id the app stores in owner_id/user_id
-- (see scripts/bridge-proof/README.md and the migration memory graph, A9
-- gate). Until that holds, these policies would authorize nobody or the wrong
-- users; the deny-all state must stay in force. This file is written ahead of
-- the gate so the swap is reviewed and ready; applying it is a separate,
-- gated step.
--
-- Semantics mirror the Convex enforcement surface
-- (convex/rls.ts, convex/workspaces.ts, convex/account.ts, convex/audit.ts):
--   * any member can read a workspace's rows (viewer included);
--   * writes require role owner | member -- viewers stay read-only
--     (convex/rls.ts WRITE_ROLES);
--   * the workspace owner can always reach the workspace row itself even when
--     the membership row is missing (getWorkspaceForUserReadOnly fallback);
--   * only the owner can delete a workspace (deleteCurrentAccount);
--   * owner-scoped tables (tax_profiles, reminders, collections cases,
--     integration jobs/logs) are private to the owner;
--   * with check guards force tenancy: a client-inserted/updated row must
--     carry a tenancy anchor (workspace membership or own owner_id); rows
--     with no anchor stay service-role-only;
--   * audit_logs is SELECT-only for members (writes are internal mutations,
--     convex/audit.ts); job_runs and integration connections/webhooks stay
--     server-only.
--
-- CREATE POLICY takes exactly one command, so workspace-scoped tables get one
-- policy per command: read is any-member; insert/update/delete require the
-- write role (owner|member). Owner-scoped tables are a single FOR ALL policy.
--
-- Write-role predicate (no new helper; direct membership lookup):
--   exists (
--     select 1 from public.workspace_members m
--     where m.workspace_id = <ws>
--       and m.user_id = app.current_user_id()
--       and m.role in ('owner', 'member')
--   )
-- It is RLS-safe: the workspace_members SELECT policy admits the actor's own
-- rows, so the subquery sees exactly the caller's own memberships.
--
-- Known limits (accepted; they match the Convex enforcement surface):
--   * a member with a write role can change any column, including owner_id --
--     ownership transfers are server-side flows and not expressible in RLS
--     without triggers;
--   * workspace-scoped tables rely on the membership row; the workspaces row
--     itself keeps the owner fallback, and membership drift self-heals in
--     Convex via ensureOwnerMembership on the next workspace resolution.

-- ---------------------------------------------------------------- workspaces
drop policy if exists workspaces_pending_verified_identity on public.workspaces;

create policy workspaces_select
  on public.workspaces
  for select
  to authenticated
  using (
    app.is_workspace_member(id)
    or owner_id = app.current_user_id()
  );

create policy workspaces_insert
  on public.workspaces
  for insert
  to authenticated
  with check (
    owner_id = app.current_user_id()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.workspaces.id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

create policy workspaces_update
  on public.workspaces
  for update
  to authenticated
  using (
    owner_id = app.current_user_id()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.workspaces.id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  )
  with check (
    owner_id = app.current_user_id()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.workspaces.id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

-- Deleting a workspace is an account-level operation (convex/account.ts
-- deleteCurrentAccount): owner-only, membership not required.
create policy workspaces_delete
  on public.workspaces
  for delete
  to authenticated
  using (owner_id = app.current_user_id());

-- -------------------------------------------------------- workspace_members
drop policy if exists workspace_members_pending_verified_identity on public.workspace_members;

create policy workspace_members_select
  on public.workspace_members
  for select
  to authenticated
  using (
    app.is_workspace_member(workspace_id)
    or user_id = app.current_user_id()
  );

-- Bootstrap + future self-join only: the actor may insert their own
-- membership into a workspace they own (creation order: workspace, then
-- membership) or already belong to. Adding OTHER members is server-side
-- (invites) until a role-aware path exists; the unique (workspace_id,
-- user_id) constraint blocks duplicates.
create policy workspace_members_self_insert
  on public.workspace_members
  for insert
  to authenticated
  with check (
    user_id = app.current_user_id()
    and (
      app.is_workspace_member(workspace_id)
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id
          and w.owner_id = app.current_user_id()
      )
    )
  );

-- No update/delete policies: role changes and removals are server-side
-- (a user must not be able to promote their own role via UPDATE).

-- ------------------------------------------------------- active_workspaces
drop policy if exists active_workspaces_pending_verified_identity on public.active_workspaces;

create policy active_workspaces_owner_access
  on public.active_workspaces
  for all
  to authenticated
  using (user_id = app.current_user_id())
  with check (
    user_id = app.current_user_id()
    and app.is_workspace_member(workspace_id)
  );

-- ------------------------------------------------------------- tax_profiles
drop policy if exists tax_profiles_pending_verified_identity on public.tax_profiles;

create policy tax_profiles_owner_access
  on public.tax_profiles
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ------------------------------------------------------------------ clients
drop policy if exists clients_pending_verified_identity on public.clients;

create policy clients_select
  on public.clients
  for select
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy clients_insert
  on public.clients
  for insert
  to authenticated
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.clients.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy clients_update
  on public.clients
  for update
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or (owner_id is not null and owner_id = app.current_user_id())
  )
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.clients.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy clients_delete
  on public.clients
  for delete
  to authenticated
  using (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.clients.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

-- ----------------------------------------------------------------- products
drop policy if exists products_pending_verified_identity on public.products;

create policy products_select
  on public.products
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy products_insert
  on public.products
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.products.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy products_update
  on public.products
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.products.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy products_delete
  on public.products
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.products.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- ----------------------------------------------------------------- invoices
drop policy if exists invoices_pending_verified_identity on public.invoices;

create policy invoices_select
  on public.invoices
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy invoices_insert
  on public.invoices
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoices.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy invoices_update
  on public.invoices
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoices.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy invoices_delete
  on public.invoices
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoices.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- ------------------------------------------------------ payment_transactions
drop policy if exists payment_transactions_pending_verified_identity on public.payment_transactions;

create policy payment_transactions_select
  on public.payment_transactions
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy payment_transactions_insert
  on public.payment_transactions
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_transactions.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy payment_transactions_update
  on public.payment_transactions
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_transactions.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy payment_transactions_delete
  on public.payment_transactions
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_transactions.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- ------------------------------------------------------------ payment_charges
drop policy if exists payment_charges_pending_verified_identity on public.payment_charges;

create policy payment_charges_select
  on public.payment_charges
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy payment_charges_insert
  on public.payment_charges
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_charges.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy payment_charges_update
  on public.payment_charges
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_charges.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy payment_charges_delete
  on public.payment_charges
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.payment_charges.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- The security_invoker payment_charges_public view inherits these policies.

-- ----------------------------------------------- recurring_invoice_schedules
drop policy if exists recurring_schedules_pending_verified_identity on public.recurring_invoice_schedules;

create policy recurring_schedules_select
  on public.recurring_invoice_schedules
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy recurring_schedules_insert
  on public.recurring_invoice_schedules
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_schedules.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy recurring_schedules_update
  on public.recurring_invoice_schedules
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_schedules.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy recurring_schedules_delete
  on public.recurring_invoice_schedules
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_schedules.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- ---------------------------------------------------- recurring_invoice_runs
drop policy if exists recurring_runs_pending_verified_identity on public.recurring_invoice_runs;

create policy recurring_runs_select
  on public.recurring_invoice_runs
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy recurring_runs_insert
  on public.recurring_invoice_runs
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_runs.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy recurring_runs_update
  on public.recurring_invoice_runs
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_runs.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy recurring_runs_delete
  on public.recurring_invoice_runs
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.recurring_invoice_runs.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- ----------------------------------------------------------- invoice_exports
drop policy if exists invoice_exports_pending_verified_identity on public.invoice_exports;

create policy invoice_exports_select
  on public.invoice_exports
  for select
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or owner_id = app.current_user_id()
  );

create policy invoice_exports_insert
  on public.invoice_exports
  for insert
  to authenticated
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.invoice_exports.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or owner_id = app.current_user_id()
  );

create policy invoice_exports_update
  on public.invoice_exports
  for update
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or owner_id = app.current_user_id()
  )
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.invoice_exports.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or owner_id = app.current_user_id()
  );

create policy invoice_exports_delete
  on public.invoice_exports
  for delete
  to authenticated
  using (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.invoice_exports.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or owner_id = app.current_user_id()
  );

-- ---------------------------------------------------- invoice_delivery_events
drop policy if exists invoice_delivery_pending_verified_identity on public.invoice_delivery_events;

create policy invoice_delivery_select
  on public.invoice_delivery_events
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy invoice_delivery_insert
  on public.invoice_delivery_events
  for insert
  to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoice_delivery_events.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy invoice_delivery_update
  on public.invoice_delivery_events
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoice_delivery_events.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

create policy invoice_delivery_delete
  on public.invoice_delivery_events
  for delete
  to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = public.invoice_delivery_events.workspace_id
      and m.user_id = app.current_user_id()
      and m.role in ('owner', 'member')
  ));

-- -------------------------------------------------------------- email_events
drop policy if exists email_events_pending_verified_identity on public.email_events;

create policy email_events_select
  on public.email_events
  for select
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy email_events_insert
  on public.email_events
  for insert
  to authenticated
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.email_events.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy email_events_update
  on public.email_events
  for update
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or (owner_id is not null and owner_id = app.current_user_id())
  )
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.email_events.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

create policy email_events_delete
  on public.email_events
  for delete
  to authenticated
  using (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.email_events.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (owner_id is not null and owner_id = app.current_user_id())
  );

-- --------------------------------------------------------------- audit_logs
-- Writes are internal mutations only (convex/audit.ts recordAuditLog /
-- logInternal); members read the audit trail of their workspace.
drop policy if exists audit_logs_pending_verified_identity on public.audit_logs;

create policy audit_logs_member_select
  on public.audit_logs
  for select
  to authenticated
  using (
    workspace_id is not null
    and app.is_workspace_member(workspace_id)
  );

-- ---------------------------------------------------------------- job_runs
-- Operational scheduler records stay server-only (service role), correlated
-- or global: no client-visible surface after activation.
drop policy if exists job_runs_pending_verified_identity on public.job_runs;

create policy job_runs_server_only
  on public.job_runs
  for all
  to authenticated
  using (false)
  with check (false);

-- ------------------------------------------------------------ reminder_rules
drop policy if exists reminder_rules_pending_verified_identity on public.reminder_rules;

create policy reminder_rules_owner_access
  on public.reminder_rules
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ------------------------------------------------------------- reminder_runs
drop policy if exists reminder_runs_pending_verified_identity on public.reminder_runs;

create policy reminder_runs_owner_access
  on public.reminder_runs
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ---------------------------------------------------------- reminder_events
drop policy if exists reminder_events_pending_verified_identity on public.reminder_events;

create policy reminder_events_owner_access
  on public.reminder_events
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- --------------------------------------------------------- collections_cases
drop policy if exists collections_cases_pending_verified_identity on public.collections_cases;

create policy collections_cases_owner_access
  on public.collections_cases
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ------------------------------------------------------ integration_sync_jobs
drop policy if exists integration_sync_jobs_pending_verified_identity on public.integration_sync_jobs;

create policy integration_sync_jobs_owner_access
  on public.integration_sync_jobs
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ----------------------------------------------------------- integration_logs
drop policy if exists integration_logs_pending_verified_identity on public.integration_logs;

create policy integration_logs_owner_access
  on public.integration_logs
  for all
  to authenticated
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());

-- ---------------------------------------------------------- unchanged tables
-- jurisdictions, tax_rule_sets, withholding_rates: real authenticated SELECT
-- policies already exist (A2 / A5 tax rule sets); nothing to swap.
-- integration_connections, integration_webhooks: no client grants or policies
-- (server-only by construction); nothing to swap.
-- public.payment_charges_public view: security_invoker, inherits the
-- payment_charges policies.
-- public.public_invoice_by_token(text): service_role only (A6), unchanged.
