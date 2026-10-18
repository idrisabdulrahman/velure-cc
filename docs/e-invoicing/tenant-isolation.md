# Tenant isolation — WP3 coverage summary (spec fix H1)

Status: landed on `einv/wp3`. No cross-tenant leaks were found in the app
layer; every probe below passes against a **no-RLS** client, so the
app-layer filters alone are load-bearing. RLS is proven as
defense-in-depth (and as the primary gate for `rls-only` functions) by the
A10_LIVE-gated matrix.

## Enforcement model

Two mechanisms, two proof layers (repo convention):

1. **App-layer scoping** — server routes derive identity from the verified
   session; data functions resolve the active workspace (or owner id) from
   that session and add it as a query predicate. Proven in the DEFAULT
   vitest suite (no DB) by running every function against an in-memory
   Supabase double with RLS OFF (`src/server/data/testing/fake-db.ts`) and
   workspace-B credentials attacking workspace-A handles.
2. **Postgres RLS** — the browser's user-scoped JWT client talks to
   PostgREST directly, so RLS is the enforcement boundary for tables and
   for the handful of `rls-only` functions. Proven by
   `src/server/data/tenant-isolation.live.test.ts` via
   `pnpm test:wp3-tenant-isolation-live` (against a linked project; skipped
   by default).

## Suite files

| File | Role |
| --- | --- |
| `src/server/data/testing/fake-db.ts` | In-memory, deliberately RLS-less Supabase double; throws loudly on unknown tables/queries so new query shapes cannot pass vacuously |
| `src/server/data/tenant-isolation.test.ts` | App-layer cross-tenant probes: workspace B vs workspace A on every non-`rls-only` data function (ids, tokens, FKs, bulk id lists, forged payload ids) |
| `src/server/data/tenant-isolation-coverage.test.ts` | Enumeration guard: every export of `src/server/data/*.ts`, of the two server repositories (`src/server/invoice-repository.ts`, `src/server/public-invoice-repository.ts`) and every handler under `src/routes/api/**` must declare its isolation mechanism; unclassified, stale, or unresolvable export forms fail |
| `src/server/data/tenant-isolation.live.test.ts` | RLS matrix: SELECT/PATCH/DELETE probes for every tenant table with real minted JWTs, cross-tenant INSERT probes, server-only table lockouts (`A10_LIVE=1`) |
| `src/routes/api/-tenant-isolation.test.ts` | Route-level IDOR probes: id/token-bearing handlers fail closed on a cross-tenant miss, resolve resources only via session-scoped/token-scoped lookups, never take identity from the body |

## Per-resource coverage

| Resource | App-layer proof (default suite) | Enforcement verified | RLS matrix (live) |
| --- | --- | --- | --- |
| Workspaces, settings, supplier profile | `resolveActiveWorkspaceId`, `listWorkspaces`, `getInvoiceWorkspaceSettings`, `getWorkspaceSettings`, `upsertWorkspaceSettings` (forged `workspaceId`/`id`/`ownerId` in payload ignored — whitelist schema, session-resolved target) | app-scoped | `workspaces`, `workspace_members`, `active_workspaces` + forged-active-workspace probe |
| Clients / customers | list/get/update/archive/remove/favorite/create/intelligence/CSV import; per-workspace email uniqueness | app-scoped | `clients` |
| Products | list/search/get/update/archive/duplicate/create/analytics | app-scoped | `products` |
| Invoices + line items | all list surfaces, `getById`, `getByToken`, lifecycle, draft create/autosave/save, status, draft settings, template defaults, cancel/reschedule, hard-delete refusal, bulk cleanup, renumber, empty-draft sweep, duplicate, convert, CSV import, `markInvoiceSent`, `recordDeliveryEvent`; forged `customerId` FK refused | app-scoped | `invoices`, `invoice_delivery_events` |
| Public invoice token access | `getPublicByToken`: public fields only (no internal notes, owner hint, customer id, workspace id, reminder/sync state); revoked/canceled/deleted refusal; unknown token → null | public-token (token-scoped, intentionally unauthenticated) | server-only RPC `public_invoice_by_token` |
| Payments | `recordPayment` (foreign invoice refused), `listInvoicePayments`; public payment context keyed by share token | app-scoped (private), public-token (public context) | `payment_transactions`, `payment_charges` |
| Paystack | initialize route token-keyed + rate-limited; webhook signature-verified | server-admin / public-token | n/a (no browser-tenant table) |
| Recurring schedules | list/create/update/end/delete | app-scoped | `recurring_invoice_schedules`, `recurring_invoice_runs` |
| Reminders & collections | overview, timeline, pause/resume, manual exception, queue event (all gated on the scoped invoice read), batch scan and queue drain scoped to B | app-scoped (invoice-keyed), `rls-only` (settings read/save, `markReminderEventStatus`) | `reminder_rules`, `reminder_runs`, `reminder_events`, `collections_cases` |
| Reminder send-queue route | 401 without session; drain receives only the session client + user (body `userId`/`workspaceId` ignored) | session | n/a |
| Compliance exports | history/retry (foreign id refused), export content contains only B's invoices, dashboard | app-scoped | `invoice_exports` |
| Tax profiles | list/save (foreign id refused) | app-scoped | `tax_profiles` |
| Integrations & connections | list/secret read/token rotation/disconnect/upsert/sync-job writes/sync state (foreign invoice refused); `listSyncJobs`/`listLogs`/`retrySyncJob` are `rls-only` | app-scoped + `rls-only` | `integration_sync_jobs`, `integration_logs`, `integration_connections` (server-only) |
| Audit log + audit endpoint | `POST /api/invoice/audit` derives actor and workspace from the verified session; forged `actor`/`actorId`/`workspaceId`/`userId` in the body are dropped (`-audit.test.ts`) | session + server-admin write path | `invoice_audit_log`, `audit_logs` server-only: even the owning member's browser token cannot INSERT/SELECT |
| Email events, job runs | n/a (no app-layer read surface) | server-admin | `email_events`; `job_runs` invisible to every browser token |

Route-level probes additionally pin the HTTP boundary: `POST
/api/invoice/send/$id` answers 404 with zero provider side effects when the
session-scoped lookup misses a foreign invoice id and resolves only through
path id + session context; `GET /api/invoice/download/$id` 404s on an
unknown token and depends on the share token alone.

## Gaps and limitations

- `rls-only` functions (`getReminderSettings`, `saveReminderSettings`,
  `markReminderEventStatus`, `listSyncJobs`, `listLogs`, `retrySyncJob`)
  carry no app-layer tenant filter by design; their isolation cannot be
  proven in the default no-DB suite and rests on RLS alone. The live matrix
  covers their tables, but `A10_LIVE=1` requires a linked Supabase
  project and was **not executed** in this environment — run
  `pnpm test:wp3-tenant-isolation-live`
  against a linked project (CI) to close this gap.
- The fake client supports the query shapes the data layer uses today; a
  new unsupported shape throws rather than passing silently. Extend it
  when the data layer grows new shapes.
- Route-level probes mock the repository seam; the scoping inside those
  repository/data functions is proven separately by the data-layer suite
  and the live RLS matrix.
- `prompts/wp3-tenant-isolation-suite.md` holds the task trail (goal,
  inspected code, acceptance criteria).
