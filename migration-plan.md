# Velure Migration Plan: Convex → Supabase with Better Auth retained

Status: pre-implementation. Written to satisfy `AGENTS.md` → Mandatory
Deliverables. Governing docs: `AGENTS.md` (process and skill discipline),
`Architecture.md` (layers and rules), `ProductStrategy.md` (positioning and
domain boundaries). Read those; this file does not restate them.

Approved scope: port the database Convex → Supabase Postgres while Better Auth
keeps running against Postgres. Schema, RLS, sessions, and Velure-managed
workspace membership stabilise together; there is no second auth-provider
cutover.

---

## 1. Product Scope Validation

**Why this belongs in Velure.** It adds no product surface. It replaces the
storage and identity substrate underneath the surfaces Velure already has:
invoices, clients, products, payments, compliance, reminders. `AGENTS.md`,
`Architecture.md`, and `ProductStrategy.md` already describe Velure as running
on Supabase with Better Auth-scoped RLS and Velure workspaces. The
code runs on Convex with better-auth and application-layer tenancy checks in
`convex/rls.ts`. This work reconciles the code with the documented
architecture; skipping it means every future feature is designed against docs
the runtime contradicts.

**Which workflow it improves.** All private workflows, by one mechanism:
tenant isolation moves from application code into the database. Today a query
that forgets to call `requireWorkspace` returns another workspace's rows and
nothing stops it. After Phase A, a forgotten check returns zero rows because
Postgres refuses. That is the difference between correct-by-convention and
correct-by-construction on invoices, clients, products, payment transactions,
and integration credentials.

**Why no ERP-style complexity.** No new table, no new domain, no new user-facing
concept. The 24 existing Convex tables translate to 24 Postgres tables (plus
enums). Nothing in this plan adds warehouse, procurement, manufacturing,
payroll, HR, CRM, or workflow-engine behaviour. The one place the plan
*reduces* scope is the duplicate `NG`/`NGN` jurisdiction values, collapsed to
one.

---

## 2. Product Strategy Review

Complies with `ProductStrategy.md` and `Architecture.md` Rule 8.

**Customer segment.** Primary — the Nigerian-first small-to-mid-sized business
segment named in the Positioning Decision. No segment shifts. Note the Primary
Customer Profile has not been formally accepted; per `ProductStrategy.md` this
work documents its assumed segment rather than expanding roadmap on an
unaccepted profile, which it can do safely because it adds no roadmap surface.

**Which outcome improves.** Trust in the multi-tenant boundary, which underpins
every billing, payment, and compliance outcome. Concretely: VAT/WHT/TIN/RC
compliance snapshots, Paystack transactions, and bank payment details currently
sit in tables whose isolation depends on every developer remembering a helper
call. Database-enforced isolation is the precondition for shipping the
Customer Portal and Reporting items in the Candidate Feature Backlog without
each one re-litigating tenancy.

**North Star.** No final metric is accepted, so this uses a candidate outcome:
*active payment collection through Velure*. The port must not regress it —
Paystack initialization, public invoice pages, payment webhooks, and reminder
delivery all keep working across both phases. It improves it indirectly by
unblocking the payment-collection backlog items that assume Supabase + RLS.

**Permanent Non-Goals.** Not violated. Velure does not become ERP, warehouse,
procurement, manufacturing, supply-chain, CRM, HR, payroll, or a general
business operating system. The change is a substrate swap: zero new domains,
zero new nouns.

**Why more valuable than competing roadmap items.** Every backlog item
(Customer Portal, Recurring Billing, Client Intelligence, Product Intelligence,
Reporting, Compliance Dashboard, Reminder Improvements, Paystack Collection) is
specified against Supabase RLS and workspace membership. Building any of them
on Convex means writing the persistence layer twice. This is the unblocking dependency,
not a competitor to those items.

**Creep risk.** None. The plan adds no table that did not already exist, and
removes one duplicate enum value.

---

## 3. Data Flow

Complies with `Architecture.md` Rule 0. Source of truth for the table
inventory is `convex/schema.ts` (24 tables); source of truth for the current
tenancy predicates is `convex/rls.ts`.

### 3.1 Target schema

One Postgres schema, `public`, exposed through the Supabase API. All 24 tables
translate 1:1. Convex `_id` becomes `uuid primary key default gen_random_uuid()`;
Convex `_creationTime` and epoch-ms `v.number()` timestamps become `timestamptz`;
nested object validators become `jsonb`; the JSON-in-string columns
(`metadata`, `rawEvent`, `rawResponse`, `resultJson`, `configJson`,
`requestPayload`, `responsePayload`, `meta`) become `jsonb`; ISO-date strings
become `date`.

Union validators become named Postgres enums where the value set is closed and
shared (`invoice_status`, `workspace_role`, `tax_treatment`,
`withholding_category`, `reminder_stage`, `provider`, `payment_source`,
`recurring_frequency`, `job_status`, `email_event_type`, and the rest of the ~24
listed in `convex/schema.ts`). Single-use two- or three-value sets stay as
`text` with a `CHECK`.

`jurisdictions` keeps its own row-per-code table rather than an enum, because
it carries columns (`defaultTaxLabel`, `supportsVat`, `supportsReverseCharge`).
`jurisdictionValidator` currently contains both `NG` and `NGN` — a country code
and a currency code in the same union. The migration collapses `NGN` → `NG` in
a data step and the enum ships without `NGN`.

### 3.2 Tenant key

The tenant key is `workspace_id`, and `workspaces` is the tenant root.
`workspaces.owner_id` and `workspace_members.user_id` hold the Better Auth user
id (text). Workspace identity remains Velure-managed, per `Architecture.md`
Rule 4.

Both are written server-side from the verified session. Neither is ever
accepted from a request body.

### 3.3 How the key is enforced

Enforced by RLS, never assumed by the client. Two helper functions, both
`STABLE`, form the whole enforcement surface:

- `app.current_user_id()` — reads the verified identity from the Better Auth
  request token (`auth.jwt() ->> 'sub'`).
- `app.is_workspace_member(ws uuid)` — `exists (select 1 from workspace_members
  where workspace_id = ws and user_id = app.current_user_id())`.

`app.is_workspace_member` is `SECURITY DEFINER` because `workspace_members` is
itself RLS-protected and a policy that queries it would recurse. That bypass is
justified in §4.

Every policy is written against these two helpers. Client code never sends a
workspace id for authorization; it may send one as a filter, and RLS still
decides.

### 3.4 Per-table tenancy

Four families, from `convex/schema.ts`.

**A. `workspace_id not null` — 8 tables.** `products`, `invoices`,
`recurring_invoice_schedules`, `recurring_invoice_runs`,
`invoice_delivery_events`, `payment_transactions`, `payment_charges`, and
`workspace_members` itself. Policy shape: `using
(app.is_workspace_member(workspace_id))`, plus the identical `with check` on
insert/update so a row cannot be moved into another workspace. Write policies on
`products`, `invoices`, `clients` additionally require role in
(`owner`,`member`) — the current `WRITE_ROLES` set in `convex/rls.ts`.

**B. `workspace_id` nullable — 5 tables.** `clients` (both `workspace_id` and
`owner_id` nullable), `audit_logs`, `email_events`, `invoice_exports`,
`job_runs`. These hold legacy rows and system/webhook rows written before
correlation. NULL is not treated as public: the policy is
`app.is_workspace_member(workspace_id)` for non-NULL, `or owner_id =
app.current_user_id()` where the table has `owner_id`, and nothing else — so a
row with both NULL is invisible to every client and reachable only via the
service role. A backfill migration attaches orphaned `clients` rows to their
owner's workspace before the policy lands; rows that cannot be attributed stay
invisible rather than shared.

**C. `owner_id` only, no workspace column — 10 tables.** `tax_profiles`,
`reminder_rules`, `reminder_runs`, `reminder_events`, `collections_cases`,
`integration_connections`, `integration_sync_jobs`, `integration_logs`,
`integration_webhooks`, `active_workspaces`. Policy: `owner_id =
app.current_user_id()`. These stay user-scoped rather than gaining a
`workspace_id` — widening them to workspace scope would newly expose one
member's OAuth tokens and webhook secrets to their co-members, which is a
behaviour change, not a port.

`integration_connections` (`access_token`, `refresh_token`, `config_json`) and
`integration_webhooks` (`secret`) get **no** client-facing select policy at all.
They are service-role-only; the browser never reads a credential column. Same
for `payment_charges` bank account fields, which are exposed to the client only
through a view that omits them.

**D. Global reference — 1 table.** `jurisdictions`: RLS enabled, `select` to
`authenticated`, no client insert/update/delete. Seeded by migration.

That is 8 + 5 + 10 + 1 = 24, plus `workspaces` itself, whose select policy is
`app.is_workspace_member(id)` and whose update policy additionally requires the
`owner` role.

### 3.5 Public flow

`Architecture.md` Rule 2 public paths — public invoice page, public PDF, public
payment initialization — are keyed today by `invoices.token`
(`.index("by_token")`). RLS cannot see a token, so the public path does **not**
get a public select policy on `invoices`. Instead a single `SECURITY DEFINER`
function `public_invoice_by_token(token text)` returns one invoice's
presentation fields (never `internal notes`, never `owner_id`, never the client
list) for an exact token match, and returns nothing for a non-match. Justified
in §4. The private path continues to go through the member policies. The two
paths share no policy, per Rule 2.

### 3.6 Background flow

`recurring_invoice_schedules.by_nextRunDate_and_status` is a cross-workspace
scan: the scheduler must see every workspace's due rows. Per
`Architecture.md` Rule 3 it runs from a server-only entrypoint with the
service-role client, deriving scope from the due date, never from a
client-supplied id. Same for reminder runs, email/Paystack webhook ingestion
(`by_providerMessageId`, `by_reference`), and `job_runs`.

### 3.7 Write-time identity

Every row carrying `owner_id` or `workspace_id` has that column set server-side
from the verified session at
insert time. The `with check` clauses make a forged value fail rather than
merely be ignored.

---

## 4. Security Review

Complies with `Architecture.md` Rule 6. Skill packs consulted:
`.agents/skills/supabase/SKILL.md` and
`.agents/skills/supabase-postgres-best-practices/SKILL.md` and
`.agents/skills/better-auth-best-practices/SKILL.md`. Nothing here relies on
memory for a Better Auth or Supabase API specific; each is checked against its pack
at implementation time. No skill-pack guidance conflicts with `AGENTS.md` or
`Architecture.md` so far; if one does, those two win and the conflict gets
flagged, not silently resolved.

**Authorization review.** Authorization moves from application code
(`convex/rls.ts` helpers, callable but skippable) to Postgres policies, which
are not skippable. Role gating (`owner`/`member` write, `viewer` read) moves
into the `with check` clause of each write policy rather than staying a
TypeScript constant.

**Multi-tenant review.** Every one of the 24 tables plus `workspaces` gets
`alter table … enable row level security` and at least one policy in the same
migration file that creates it. RLS on with no policy denies everything
silently, and RLS off is a security bug — neither state ships. The policy
inventory is §3.4; the migration is rejected in review if the count of
`enable row level security` statements does not equal the count of created
tables.

**Public exposure review.** One public surface: an invoice fetched by its
share token. It is not a policy but a narrow `SECURITY DEFINER` function
returning a fixed presentation column list for an exact token match (§3.5).
`invoices` itself has no `anon` policy, so the public and private paths cannot
converge. Per Rule 2, inventory and product operations are private-only and
get no public function. Token comparison happens on an indexed exact match with
no `like`, no prefix, no partial return on near-miss.

**Data ownership review.** Ownership columns are written server-side from the
verified session (§3.7). The `with check` clause on every insert and update
means a forged `workspace_id` or `owner_id` in a request body fails the write
rather than being silently overwritten — a failure is louder than a fixup and
easier to catch in tests.

**Secret handling review.** `integration_connections.access_token` /
`refresh_token`, `integration_webhooks.secret`, and `payment_charges` bank
details have no client-facing select policy at all; they are readable only
through the service-role client from server-only code. The Supabase secret /
service-role key lives in server-only env (never `VITE_`-prefixed, never
imported into a route component, never reachable from a browser bundle). A
build-time check greps the client bundle for the key name; Phase A does not
ship without it passing.

**Row Level Security policy review.** Every touched table — all 24 plus
`workspaces` — gets RLS enabled and at least one tenant-scoped policy, per the
four families in §3.4. Specific traps checked at review:

- `update` policies carry **both** `using` and `with check`. A `using`-only
  update policy lets a visible row be rewritten into another tenant.
- Any view over a tenant table is created `with (security_invoker = true)`.
  A default view runs as its owner and silently bypasses the underlying
  policies. This applies to the `payment_charges` view that omits bank fields
  (§3.4C) — without `security_invoker` it would expose every workspace's rows.
- No policy reads `auth.jwt() -> 'user_metadata'`. That claim is
  client-writable; authorization reads only the server-issued `sub`.
- Policies are per-command (`select`/`insert`/`update`/`delete`) rather than
  `for all`, so read access and write access can differ by role.
- `app.current_user_id()` and `app.is_workspace_member()` are `stable`, and
  the member lookup is indexed on `(workspace_id, user_id)` — the existing
  `by_workspaceId_and_userId` index. An unindexed policy predicate is a
  full-scan on every row of every query.

**Better Auth session verification review.** Authorization derives from a
verified session at every layer, never from client input.

- Phase A: the token is better-auth-issued and verified by Postgres before
  `auth.jwt()` returns anything. `app.current_user_id()` reads `sub` only.
- The Route layer verifies the session server-side before the Domain layer
  runs — this is the fix for the current client-only guard in
  `DashboardLayout.tsx`, which returns `null` for an unauthenticated user
  instead of redirecting and performs no server-side check at all.
- Better Auth's server-side hooks bootstrap and maintain the user's initial
  workspace membership before any domain write.
- No code path accepts `workspaceId` or `orgId` from a request body as
  authorization. Where the client sends one it is a filter applied *after*
  the policy, never instead of it.

**RLS bypasses — the complete list.** Three, each named here as
`Architecture.md` Rule 3 requires:

1. `app.is_workspace_member(ws uuid)`, `SECURITY DEFINER`. Necessary:
   `workspace_members` is itself RLS-protected, and a policy that queries it
   through RLS recurses infinitely. Bounded: takes one `uuid`, returns
   `boolean`, reads one indexed row, leaks nothing but a yes/no about the
   caller's own membership. `search_path` pinned, `revoke execute from public`,
   granted to `authenticated` only.
2. `public_invoice_by_token(token text)`, `SECURITY DEFINER`. Necessary: RLS
   predicates cannot see a URL token, and the alternative — an `anon` select
   policy on `invoices` — would put the public and private paths on the same
   policy, which Rule 2 prohibits. Bounded: exact-match lookup, fixed
   presentation column list, no client rows, no `owner_id`, no internal notes,
   returns empty on miss. Granted to `anon`.
3. The service-role client, used only from server-only entrypoints: the
   recurring-invoice and reminder schedulers, email and Paystack webhook
   ingestion, `job_runs`, and reads of credential columns
   (`integration_connections`, `integration_webhooks`). Necessary: these are
   cross-workspace by definition and run with no session (Rule 3). Bounded:
   scope derives from the job's own parameters — due date, provider message
   id, payment reference — never from a client-supplied id, and the key never
   reaches a browser-reachable module (§4 secret handling).

No other `SECURITY DEFINER` function and no other service-role call site
ships in either phase. A new one is a Security Review item, not an
implementation detail.

---

## 5. Architecture Impact

Complies with `Architecture.md`. This is a substrate swap, so the layer
boundaries in Rule 1 do not move — what changes is which library sits inside
each one. Mapped layer by layer.

**UI layer.** Components keep the Better Auth surface and read the same shapes
through the same hooks; only the persistence transport underneath differs. The
UI layer continues to make no authorization decision — with RLS in place, a UI
mistake yields zero rows rather than someone else's.

**Route layer.** The largest structural change, and it is an addition rather
than a swap: there is no server-side route protection today.
`DashboardLayout.tsx:230` returns `null` when `!session?.user` — a client-side
render decision, not a guard. The migration adds Better Auth session validation at
the route boundary for every `/dashboard`-class route, redirecting to `/auth`
with the existing sanitized `redirectTo` behaviour from
`src/routes/auth.lazy.tsx:130`. Public `/i/` invoice routes stay
unauthenticated and are explicitly excluded, per Rule 2. Better Auth's
`src/routes/api/auth/$.ts` endpoint remains.

**Domain layer.** Invoice, client, product, compliance, and reminder rules are
unchanged in substance — they are the reason for the port, not its subject.
What changes: functions currently in `convex/*.ts` become server functions that
take a Supabase client instead of a Convex `ctx`, and the tenancy assertions
from `convex/rls.ts` stop being the enforcement mechanism. They remain as
early, legible failures — a 403 at the boundary reads better than an empty
result set — but correctness no longer depends on remembering to call them.
`convex/rls.ts` itself is not ported; its logic becomes the policy set in §3.4.

**Persistence layer.** Replaced wholesale. `convex/schema.ts` becomes SQL
migration files under `supabase/migrations/` (the directory does not exist
yet); Convex indexes become Postgres indexes; the generated `DataModel` type
becomes `supabase gen types typescript` output, committed. Every table lands
with `enable row level security` and its policies in the same migration that
creates it. Reads and writes go through the generated types, per Rule 1. The
service-role client is confined to the three bypasses in §4.

**Integration layer.** Paystack, Resend, QuickBooks, Xero webhook handlers
keep their shape and change only their write target. Better Auth's existing
`databaseHooks.user.create.after` bootstrap in `convex/auth.ts:144`, which calls
`ensureWorkspaceForAuth`, moves to the Postgres adapter.

**Rule 5 observability.** `audit_logs` survives the port as a table with
nullable `workspace_id` (§3.4B), and the existing event vocabulary
(`invoice.created`, `invoice.sent`, `invoice.paid`, `client.created`,
`inventory.adjusted`) is unchanged. Two additions, both because a new failure
mode appears: a policy denial is now a distinguishable outcome, so
permission-denied and unexpectedly-empty results are logged as
authorization failures rather than surfacing as empty UI — per the
`AGENTS.md` guardrail that treats them as failed RLS, not a frontend bug.

**Rule 0.** This document is the data flow document (§3), reviewed before
implementation begins.

**Rule 7.** No new domain. Invoicing, billing, payments, clients, compliance,
products, and invoicing-support inventory are exactly the domains present
before the port.

---

## 6. Implementation Plan

Ordered. Each step is independently reviewable and leaves the app running.

### Phase A — Convex → Supabase

**A0. Read the packs.** `.agents/skills/supabase/SKILL.md` and
`.agents/skills/supabase-postgres-best-practices/SKILL.md` before writing any
SQL, per `AGENTS.md` and `Architecture.md` Rule 1 (Persistence).

**A1. Project scaffold.** `supabase init` (no `supabase/` directory exists
yet). Add `@supabase/supabase-js` and `@supabase/ssr` at exact pinned
versions. Two clients: a browser client using the publishable key, and a
server-only client using the secret key, in a module that cannot be imported
from a route component. Env keys added to `.env.example`; the secret key is
never `VITE_`-prefixed.

**A2. Enums and reference data.** Migration 1: the ~24 named enums from §3.1,
plus `jurisdictions` with its seed rows. `NGN` is absent from the jurisdiction
enum; the seed contains `NG`.

**A3. Tenancy core.** Migration 2: `workspaces`, `workspace_members`,
`active_workspaces`, with RLS enabled and policies in the same file. The
`workspaces.default_tax_profile_id` FK is **not** created here — it targets
`tax_profiles`, which does not exist yet. The column is added nullable in A5.

**A4. Helper functions.** Migration 3: `app.current_user_id()` and
`app.is_workspace_member(uuid)` per §3.3, with `search_path` pinned,
`revoke execute from public`, and grants to `authenticated` only.

**A5. Domain tables.** Migrations 4–n, grouped by family from §3.4, each with
RLS and policies in the same file. `tax_profiles` lands before the
`workspaces.default_tax_profile_id` column is added, resolving the circular FK
by ordering rather than by a deferrable constraint. Indexes mirror the Convex
index list, including `(workspace_id, user_id)` on `workspace_members` which
the policy predicate depends on.

**A6. Bypass functions.** Migration n+1: `public_invoice_by_token(text)` and
the `security_invoker` view over `payment_charges`. Both justified in §4.

**A7. Types.** `supabase gen types typescript` → commit. Add
`guard:supabase-schema` alongside the existing `guard:convex-api` script so
drift between migrations and committed types fails a check rather than a
runtime query.

**A8. Data migration.** A one-shot export/import script, run with the service
role: Convex documents → Postgres rows, `_id` → `uuid` with an id map applied
to every FK, epoch-ms → `timestamptz`, JSON strings → `jsonb`, `NGN` → `NG`.
Orphaned `clients` rows are attached to their owner's workspace; rows that
cannot be attributed are left with NULL tenancy and are therefore invisible to
clients by design (§3.4B), not deleted. The script is idempotent and reports
per-table counts so a partial run is visible.

**A9. Repoint better-auth.** better-auth moves from
`@convex-dev/better-auth`'s adapter to its Postgres adapter against the same
database. Session/user/account tables live in their own schema, not exposed
through the API. The signup hook keeps calling `ensureWorkspaceForAuth`, now
writing to Postgres. Google OAuth, rate limiting, cookie cache, and account
linking settings from `convex/auth.ts` carry over unchanged.

**A10. Port the data layer.** Convex queries/mutations → server functions
using the typed Supabase client, one domain at a time (workspaces → clients →
products → invoices → payments → reminders → integrations), keeping
`@convex-dev/react-query` call sites compiling until each domain is cut over.
Verify per domain that a cross-workspace read returns zero rows.

**A11. Remove Convex.** Delete `convex/`, drop `convex`,
`@convex-dev/better-auth`, `@convex-dev/react-query`, and the `convex:sync`
and `guard:convex-api` scripts once nothing references them.

---

## 7. Testing Plan

Existing runner is `vitest` (`pnpm test`); `pnpm build` runs on pre-push via
`.githooks`. Both gates stay.

**Migration tests (Phase A, blocking).**

- A schema assertion that every table in the exposed schema has
  `relrowsecurity = true` **and** at least one row in `pg_policies`. RLS on
  with no policy denies silently; RLS off is a security bug. This is the
  mechanical form of the §4 count check, and it fails the build rather than a
  review.
- A test that every `update` policy has a non-null `with_check`.
- A test that every view over a tenant table has `security_invoker = on`.
- `supabase db lint` plus the security advisors from the Supabase pack, run
  after the final migration; any advisor finding is triaged, not ignored.
- Round-trip test on the A8 data migration: per-table row counts match
  Convex, and a sample of FKs resolves under the id map.

**Tenancy tests (the core of the suite).** Two seeded workspaces,
W1 and W2, each with an owner, a member, and a viewer, plus one user in
neither. For every table in §3.4:

- W1's member reads W1's rows and gets **zero** W2 rows — not an error, zero
  rows, which is what a correct policy produces.
- W1's viewer cannot insert, update, or delete where `WRITE_ROLES` applies.
- An insert with a forged `workspace_id` or `owner_id` **fails** rather than
  being silently rewritten (§3.7).
- An update attempting to move a row from W1 to W2 fails the `with check`.
- The unaffiliated user reads zero rows everywhere.
- The doubly-NULL `clients` rows from §3.4B are invisible to all four users.

**Secret exposure tests.**

- `integration_connections.access_token` / `refresh_token`,
  `integration_webhooks.secret`, and `payment_charges` bank fields return
  nothing to an authenticated client — including the row's own owner.
- A build-time grep of the client bundle for the service-role key name and for
  `SUPABASE_SECRET`-class identifiers. Phase A does not ship if it matches.

**Public path tests.**

- `public_invoice_by_token` with a valid token returns exactly the
  presentation columns, and never `owner_id`, internal notes, or client rows.
- An invalid or near-miss token returns empty, not a partial row and not an
  error that distinguishes "wrong token" from "no such invoice".
- An `anon` role selecting `invoices` directly gets zero rows — the public
  path exists only through the function.
- Product and inventory operations have no public entrypoint (Rule 2).

**Better Auth verification tests.**

- A request with no session, an expired token, and a token signed by the wrong
  key each reach zero rows and a redirect — none reaches the Domain layer.
- A request body carrying someone else's `workspaceId` does not widen access.
- Server-side route guards redirect an unauthenticated request to `/auth`
  before any dashboard route renders — the regression test for the
  `DashboardLayout.tsx:230` gap.

**Regression tests (the North Star guard).** Paystack initialization and
webhook, public invoice page and PDF, reminder delivery, and recurring-invoice
scheduling all pass after the migration. Active payment collection must
not regress across the port (§2).

**Manual checks before the migration merges.** Sign in, create an invoice, send
it, open the public link in a logged-out browser, pay it, confirm status and
`audit_logs`. Then repeat as a second workspace's member and confirm the first
workspace is invisible.

## 8. Identity remap plan (A8 → A9/A10, audited 2026-08-17)

### Executive finding: no user-id remap is required

The pre-flip assumption was that A8 rows carry "legacy Convex-era ids" that RLS
would not resolve after the flip. A live audit against `velure-cc` disproves it:
**the identity is continuous by construction**, and the bridge path resolves
every real user's existing rows. One secondary data surface
(`audit_logs.resource_id`) holds stale Convex resource ids and should be
handled, but nothing user-facing breaks.

### 1. Id formats in the live data (counts from velure-cc)

Every user-bearing column holds uniform 32-char Convex ids (`k5...`), zero
UUIDs, zero mixed formats:

| Table.column | rows | convex `k5...` | uuid | empty |
|---|---|---|---|---|
| reminder_runs.owner_id | 80,851 | 80,851 | 0 | 0 |
| audit_logs.actor_id | 228 | 160 | 0 | 68 (system actions, no actor) |
| workspaces.owner_id | 87 | 87 | 0 | 0 |
| workspace_members.user_id | 87 | 87 | 0 | 0 |
| active_workspaces.user_id | 87 | 87 | 0 | 0 |
| invoices.user_id | 42 | 42 | 0 | 0 |
| invoice_delivery_events.owner_id | 4 | 4 | 0 | 0 |
| clients.owner_id | 3 | 3 | 0 | 0 |
| invoice_exports.owner_id | 2 | 2 | 0 | 0 |
| reminder_events.owner_id | 2 | 2 | 0 | 0 |
| collections_cases.owner_id | 1 | 1 | 0 | 0 |
| payment_transactions.owner_id | 1 | 1 | 0 | 0 |
| recurring_invoice_schedules.owner_id | 1 | 1 | 0 | 0 |
| (7 more tables, 0 rows) | 0 | — | — | — |

Orphan check: every user-bearing id also appears as a workspace `owner_id` —
zero orphans across workspace_members, active_workspaces, clients, invoices,
reminder_runs. `auth.identities` currently has **0** `custom:velure` rows;
`auth.users` has **0** rows. No legacy GoTrue identities exist.

### 2. Why no remap is needed — the identity chain

1. The app's Better Auth runs **over Convex** (`convexBetterAuthReactStart`);
   the Convex adapter maps `id ↔ _id` with id generation **disabled**
   (`@convex-dev/better-auth/dist/client/adapter.js`), so better-auth's
   `user.id` **is** the Convex document `_id` — the `k5...` string.
2. `convex/rls.ts` keys everything by `viewer._id` — the same id.
3. The A8 importer (`scripts/migrate-convex-to-supabase.mjs`) passes
   `ownerId`/`userId` through **unchanged** (only row `_id`s are
   UUID-mapped), so Supabase `owner_id`/`user_id` == Convex `_id`.
4. The A10 bridge provisions the issuer with `session.user.id` (same
   `k5...` id) and the custom access token hook copies the issuer `sub`
   into `velure_user_id`. So the minted JWT's `velure_user_id` == the id
   stored in every `owner_id`/`user_id` row.

**Live proof (2026-08-17):** provisioned a real owner id
(`k5791h17d88vvksx17ttjhymqn88y110` — "Fr35No Inc.") at the issuer, signed in
through the real `/sign-in/email`, drove GoTrue authorize → minted JWT with
`velure_user_id` == that exact id, and RLS returned the user's **real** rows:
1 workspace, 1 membership, 1 active_workspace, 3 clients. All proof artifacts
removed afterwards (better_auth users, auth.users, identities, provider).

### 3. The one data surface to handle: `audit_logs.resource_id`

228 audit rows reference resources by their **Convex** ids (`j57...`
invoice-prefix ids) because the A8 importer UUID-mapped `_id`s but did not
rewrite `resource_id`. This is **write-only** today (no UI/API consumer
joins on it), so it is cosmetic, not a flip blocker. Recommended:

- Option A (cheapest, recommended): leave as-is; document that
  `audit_logs.resource_id` is a non-joinable audit note post-migration.
- Option B: backfill a mapping table `old_convex_id → new_uuid` during a
  future import run and rewrite `resource_id` where it resolves.

### 4. What actually needs doing before the flip

1. **Nothing in the data layer** — no `UPDATE` rewrites of owner/user ids.
   The A8 rows resolve through RLS as-is (proven above).
2. **Keep the pre-flip guard**: no future code path may write a GoTrue
   `sub` (uuid) into `owner_id`/`user_id` — only the app's Convex id. The
   RLS helper already prefers `velure_user_id` over `sub`, but a CI guard
   (like `guard-anon-privileges`) can assert all user-bearing columns
   contain only `k5...`-shaped ids.
3. **Sequencing**: cut over domains in A10 order (workspaces → clients →
   products → invoices → payments → reminders → integrations). Each port's
   live gate already exercises the minted JWT against real RLS — that IS
   the per-domain identity check.
4. **Rollback**: because no data is rewritten, rollback is simply
   switching a domain's reads back to Convex. Nothing to reverse.

### 5. Verification gate (run before the flip goes live)

- The A10 live gates (workspaces 5/5, clients 6/6) already prove
  velure_user_id == provisioned id == existing rows for scratch users.
- Add one script (`scripts/bridge-proof/identity-continuity.mjs`) that
  picks the oldest real owner, provisions, signs in, and asserts RLS
  returns their real rows (the exact steps used in the live proof above),
  then cleans up. Gate CI on it before any domain cutover.
