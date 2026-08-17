\set ON_ERROR_STOP on
-- cleanup any leftover fixture rows from prior runs
TRUNCATE public.invoice_exports, public.job_runs, public.audit_logs, public.payment_charges,
  public.clients, public.invoices, public.tax_profiles, public.products,
  public.active_workspaces, public.workspace_members, public.workspaces CASCADE;
-- ============ fixtures (postgres; table owner bypasses RLS) ============
insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled)
values ('u1','Acme','NG','NGN',true);
insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled)
values ('u5','Globex','NG','NGN',true);

insert into public.workspace_members (workspace_id, user_id, role)
select id, 'u1', 'owner' from public.workspaces where name = 'Acme';
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'u2', 'member' from public.workspaces where name = 'Acme';
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'u3', 'viewer' from public.workspaces where name = 'Acme';
insert into public.workspace_members (workspace_id, user_id, role)
select id, 'u5', 'owner' from public.workspaces where name = 'Globex';

insert into public.active_workspaces (user_id, workspace_id)
select 'u1', id from public.workspaces where name = 'Acme';

insert into public.products (workspace_id, type, name, default_unit_price, is_active)
select id, 'service', 'Consulting', 100, true from public.workspaces where name = 'Acme';

insert into public.invoices (workspace_id, user_id, token, invoice_number, customer_name, currency, issue_date, due_date, line_items)
select id, 'u1', 'tok1', 'INV-001', 'Acme Client', 'NGN', current_date, current_date+30, '[]'::jsonb
from public.workspaces where name = 'Acme';

insert into public.clients (workspace_id, owner_id, name, email, currency, payment_terms, contact, favorite, status)
select id, 'u1', 'Client A', 'a@x.com', 'NGN', 'net30', '{}'::jsonb, false, 'active'
from public.workspaces where name = 'Acme';

insert into public.tax_profiles (owner_id, name, jurisdiction_code, tax_treatment, rate, label)
values ('u1','Default NG','NG','exclusive_rate',7.5,'VAT');

insert into public.payment_charges (workspace_id, invoice_id, reference, status, amount, currency, expires_at)
select w.id, i.id, 'ref-1', 'pending', 1000, 'NGN', now()+interval '1 day'
from public.workspaces w join public.invoices i on i.workspace_id = w.id
where w.name = 'Acme';

insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, result)
select id, 'u1', 'user', 'invoice.created', 'invoice', 'success' from public.workspaces where name = 'Acme';

insert into public.job_runs (workspace_id, job_name, status, duration_ms, retries, started_at, completed_at)
select id, 'reminders', 'success', 10, 0, now(), now() from public.workspaces where name = 'Acme';

insert into public.invoice_exports (owner_id, workspace_id, kind, status, file_name, content)
select 'u1', id, 'invoices_csv', 'ready', 'f.csv', 'data' from public.workspaces where name = 'Acme';

-- ============ Scenario A: member u2 in ws1 ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspaces) <> 1 then raise exception 'A1: member sees wrong workspace count'; end if;
  if (select count(*) from public.workspaces where name = 'Acme') <> 1 then raise exception 'A2: member cannot see own workspace'; end if;
  if (select count(*) from public.products) <> 1 then raise exception 'A3: member sees wrong product count'; end if;
  if (select count(*) from public.invoices) <> 1 then raise exception 'A4: member sees wrong invoice count'; end if;
  if (select count(*) from public.clients) <> 1 then raise exception 'A5: member sees wrong client count'; end if;
  if (select count(*) from public.workspace_members) <> 3 then raise exception 'A6: member roster wrong'; end if;
  if (select count(*) from public.audit_logs) <> 1 then raise exception 'A7: member cannot read audit trail'; end if;
  if (select count(*) from public.payment_charges_public) <> 1 then raise exception 'A8: security-invoker view wrong for member'; end if;
  if (select count(*) from public.job_runs) <> 0 then raise exception 'A9: job_runs not server-only'; end if;
  if (select count(*) from public.tax_profiles) <> 0 then raise exception 'A10: member sees owner tax profiles'; end if;
  insert into public.products (workspace_id, type, name, default_unit_price, is_active)
  select id, 'product', 'Gadget', 50, true from public.workspaces where name = 'Acme';
  update public.workspaces set name = 'Acme v2' where name = 'Acme';
  insert into public.active_workspaces (user_id, workspace_id)
  select 'u2', id from public.workspaces where name = 'Acme v2';
end $$;
do $$
declare denied boolean := false; n int;
begin
  begin
    update public.products set workspace_id = (select id from public.workspaces where name = 'Globex')
    where name = 'Consulting';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A11: cross-workspace product move not denied'; end if;
  denied := false;
  -- active_workspaces: foreign target is invisible to the subquery, so the
  -- insert is a silent 0-row no-op (RLS filters before the with check runs)
  insert into public.active_workspaces (user_id, workspace_id)
  select 'u2', id from public.workspaces where name = 'Globex';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A12: foreign active workspace row inserted (%).', n; end if;
  if (select count(*) from public.active_workspaces where user_id = 'u2') <> 1
  then raise exception 'A12b: member active workspace state wrong'; end if;
  -- clients: the with check fires for real -- moving the client to an
  -- invisible workspace nulls workspace_id but leaves the foreign owner_id,
  -- which must fail the tenancy with check
  begin
    update public.clients
    set workspace_id = (select id from public.workspaces where name = 'Globex')
    where name = 'Client A';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A15: client tenancy with check not enforced'; end if;
  denied := false;
  begin
    insert into public.workspace_members (workspace_id, user_id, role)
    select id, 'u9', 'member' from public.workspaces where name = 'Acme v2';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A13: non-self membership insert not denied'; end if;
  denied := false;
  begin
    insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, result)
    select id, 'u2', 'user', 'invoice.created', 'invoice', 'success' from public.workspaces where name = 'Acme v2';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A14: member audit write not denied'; end if;
end $$;
rollback;

-- ============ Scenario B: viewer u3 in ws1 (read-only) ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.products) <> 1 then raise exception 'B1: viewer cannot read'; end if;
  if (select count(*) from public.invoices) <> 1 then raise exception 'B2: viewer cannot read invoices'; end if;
end $$;
do $$
declare denied boolean := false; n int;
begin
  begin
    insert into public.products (workspace_id, type, name, default_unit_price, is_active)
    select id, 'product', 'X', 1, true from public.workspaces where name = 'Acme';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'B3: viewer insert not denied'; end if;
  denied := false;
  begin
    update public.products set name = 'Hacked' where name = 'Consulting';
  exception when others then denied := true;
  end;
  if not denied then raise exception 'B4: viewer update not denied'; end if;
  delete from public.products where name = 'Consulting';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B5: viewer delete not denied'; end if;
end $$;
rollback;

-- ============ Scenario C: outsider u4 (no membership) ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u4","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspaces) <> 0 then raise exception 'C1: outsider sees workspaces'; end if;
  if (select count(*) from public.products) <> 0 then raise exception 'C2: outsider sees products'; end if;
  if (select count(*) from public.invoices) <> 0 then raise exception 'C3: outsider sees invoices'; end if;
  if (select count(*) from public.workspace_members) <> 0 then raise exception 'C4: outsider sees memberships'; end if;
  if (select count(*) from public.payment_charges_public) <> 0 then raise exception 'C5: outsider sees charges'; end if;
end $$;
do $$
declare n int;
begin
  -- the target workspace is invisible to the outsider, so the insert is a
  -- silent 0-row no-op rather than an error
  insert into public.products (workspace_id, type, name, default_unit_price, is_active)
  select id, 'product', 'X', 1, true from public.workspaces where name = 'Acme';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'C6: outsider insert into ws1 succeeded (%).', n; end if;
  if (select count(*) from public.products where name = 'X') <> 0
  then raise exception 'C6b: outsider product row exists'; end if;
end $$;
rollback;

-- ============ Scenario D: owner u5 of ws2 ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u5","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspaces) <> 1 then raise exception 'D1: owner sees wrong workspaces'; end if;
  if (select count(*) from public.workspaces where name = 'Globex') <> 1 then raise exception 'D2: owner cannot see own ws2'; end if;
end $$;
do $$
declare n int;
begin
  delete from public.workspaces where name = 'Globex';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'D3: owner workspace delete failed (%).', n; end if;
  delete from public.workspaces where name = 'Acme';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'D4: owner deleted a foreign workspace'; end if;
end $$;
rollback;

-- ============ Scenario E: owner u1 of ws1 (owner-scoped tables) ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.tax_profiles) <> 1 then raise exception 'E1: owner cannot see own tax profiles'; end if;
  if (select count(*) from public.invoice_exports) <> 1 then raise exception 'E2: owner cannot see own exports'; end if;
  insert into public.tax_profiles (owner_id, name, jurisdiction_code, tax_treatment, rate, label)
  values ('u1','Second','NG','exclusive_rate',5,'WHT');
end $$;
do $$
declare denied boolean := false;
begin
  begin
    insert into public.tax_profiles (owner_id, name, jurisdiction_code, tax_treatment, rate, label)
    values ('u2','Steal','NG','exclusive_rate',5,'WHT');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'E3: foreign owner_id tax profile not denied'; end if;
end $$;
rollback;

-- ============ Scenario F: bootstrap flow for brand-new user u6 ============
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"u6","role":"authenticated"}', true);
do $$
declare new_ws uuid;
begin
  insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled)
  values ('u6','Fresh','NG','NGN',true) returning id into new_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_ws,'u6','owner');
  insert into public.active_workspaces (user_id, workspace_id) values ('u6', new_ws);
  if (select count(*) from public.workspaces where owner_id = 'u6') <> 1 then raise exception 'F1: bootstrap workspace missing'; end if;
  if (select count(*) from public.active_workspaces where user_id = 'u6') <> 1 then raise exception 'F2: bootstrap active missing'; end if;
  if (select count(*) from public.products) <> 0 then raise exception 'F3: fresh user sees Acme products'; end if;
end $$;
rollback;

-- ============ Scenario H: OIDC sub-claim (live finding 2026-08-15) ============
-- GoTrue mints its own UUID as `sub`; the Better Auth user id arrives via the
-- `velure_user_id` claim (custom access token hook). A workspace owned by the
-- Better Auth id must be visible even though `sub` differs.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","velure_user_id":"ba-user-oidc","role":"authenticated"}', true);
insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled)
  values ('ba-user-oidc','OIDC Workspace','NG','NGN',false);
insert into public.workspace_members (workspace_id, user_id, role)
  select id, 'ba-user-oidc', 'owner' from public.workspaces where name = 'OIDC Workspace';
do $$
declare
  seen uuid;
begin
  select id into seen from public.workspaces where name = 'OIDC Workspace';
  if seen is null then raise exception 'H1: owner-anchored row invisible via velure_user_id claim'; end if;
  if (select app.current_user_id()) <> 'ba-user-oidc' then raise exception 'H2: current_user_id did not prefer velure_user_id'; end if;
end $$;
rollback;

-- ============ Scenario G: anon denied ============
begin;
set local role anon;
select set_config('request.jwt.claims','{}', true);
do $$
declare denied boolean := false;
begin
  begin
    perform count(*) from public.workspaces;
  exception when others then denied := true;
  end;
  if not denied then raise exception 'G1: anon can read workspaces'; end if;
  denied := false;
  begin
    perform count(*) from public.jurisdictions;
  exception when others then denied := true;
  end;
  if not denied then raise exception 'G2: anon can read jurisdictions'; end if;
end $$;
rollback;

-- ============ no-pending-policies audit ============
do $$ begin
  if exists (
    select 1 from pg_policies where policyname like '%pending_verified_identity%'
  ) then raise exception 'P1: a pending_verified_identity policy still exists'; end if;
  if (select count(*) from pg_policies
      where policyname like '%_select%' or policyname like '%_insert%'
         or policyname like '%_update%' or policyname like '%_delete%'
         or policyname like '%_owner_access%' or policyname like '%_self_insert%'
         or policyname like '%_member_select%' or policyname like '%_server_only%'
         or policyname like '%authenticated users can read%') < 40
  then raise exception 'P2: fewer than 40 real policies in place'; end if;
end $$;

select 'ALL RLS ASSERTIONS PASSED' as result;
