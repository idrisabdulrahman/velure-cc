-- Close the cross-tenant WRITE hole on every workspace-nullable owner-anchored
-- table: clients, email_events, invoice_exports (INSERT *and* UPDATE).
--
-- `20260815190830_phase_a9_activate_rls_policies.sql` gave these tables write
-- predicates of the form:
--
--   (workspace_id is not null and <caller is owner/member of workspace_id>)
--   or (owner_id is not null and owner_id = app.current_user_id())
--
-- Because the branches are OR'd and the owner branch never constrains
-- workspace_id, anchoring owner_id to yourself satisfies the check even when
-- workspace_id names SOMEONE ELSE'S workspace. A10 has the browser call
-- PostgREST directly (ADR-0001: browser-supplied identifiers are "filters
-- only"), so RLS is the sole tenancy enforcement. The planted row then passes
-- the workspace-membership arm of the SELECT policy and renders in the victim's
-- list.
--
-- Fixing INSERT alone is insufficient: the same write is reachable in two hops
-- via UPDATE — insert owner-anchored with workspace_id null (legitimate, 201),
-- then PATCH workspace_id to the victim's workspace, where the UPDATE
-- with-check's unguarded owner branch admits it. Verified live before this fix:
-- hop 1 -> 201, hop 2 -> 200, victim saw the row.
--
-- Fix: on every INSERT/UPDATE *with-check*, the owner branch may only admit
-- rows that name NO workspace. Rows naming a workspace must satisfy the
-- membership branch.
--
--   * Preserves the owner-anchored-with-no-workspace insert that
--     scripts/bridge-proof/a9-live-tenancy.mjs:413 asserts (201).
--   * Keeps no-anchor inserts rejected (403).
--   * Still permits a legitimate "claim into my own workspace" PATCH, because
--     the membership branch admits it when the caller is a member.
--   * UPDATE *using* clauses keep their owner branch, so an owner retains
--     access to their own unanchored rows (dropping it there would orphan them).
--
-- invoices_insert, products_insert and the other workspace_id-NOT-NULL tables
-- require membership outright and are unaffected. audit_logs and job_runs grant
-- writes to `authenticated` but declare no permissive write policy, so RLS
-- denies by default.
--
-- Live data at time of writing: 0 unanchored rows and 0 rows whose owner_id is
-- not a member of the row's own workspace, across all three tables — no
-- evidence of exploitation, no backfill required.
--
-- APPLIED to velure-cc (kbexydkmmfabfutgkbxn) 2026-08-24.
-- Regression gate: pnpm test:a10-tenancy-live
-- (src/server/data/rls-tenancy.live.test.ts) — covers all three tables across
-- INSERT, the two-hop UPDATE bypass, and the legitimate claim path.

-- ---------------------------------------------------------------- clients
drop policy if exists clients_insert on public.clients;

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
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );

drop policy if exists clients_update on public.clients;

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
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );

-- ----------------------------------------------------------- email_events
drop policy if exists email_events_insert on public.email_events;

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
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );

drop policy if exists email_events_update on public.email_events;

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
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );

-- -------------------------------------------------------- invoice_exports
-- This table's owner branch was weaker still: a bare
-- `or owner_id = app.current_user_id()` with no `is not null` guard.
drop policy if exists invoice_exports_insert on public.invoice_exports;

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
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );

drop policy if exists invoice_exports_update on public.invoice_exports;

create policy invoice_exports_update
  on public.invoice_exports
  for update
  to authenticated
  using (
    (workspace_id is not null and app.is_workspace_member(workspace_id))
    or (owner_id is not null and owner_id = app.current_user_id())
  )
  with check (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.invoice_exports.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    ))
    or (
      workspace_id is null
      and owner_id is not null
      and owner_id = app.current_user_id()
    )
  );
