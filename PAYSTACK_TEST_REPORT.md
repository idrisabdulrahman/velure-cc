# Paystack payment test report

Date: 2026-10-29. Independent rerun of the existing uncommitted fixes plus the
F7–F12 gap-fix pass.

## Summary

**Overall: INCOMPLETE; automated checks PASS.** Settlement replay, mismatch,
cancellation, rollback, stale-charge, currency-gate, durable-reference and
missed-webhook recovery checks pass against local Postgres/PostgREST. The
recovery job credits only a provider-confirmed success and never releases a
pending slot on a non-success, so it cannot double-credit. Money safety is still
not certified end-to-end: no real paid checkout/webhook delivery was run. No
production database, deployment, push or commit.

## Environment and evidence

- Node v25.8.1, pnpm 10.32.1, existing Vitest 4.1.6.
- Test key read from PAYSTACK_TEST_SECRET_KEY via `.env.test`; test prefix
  verified without printing the key. User confirmed the report's live-prefix
  text was not a live credential. No actual live credential was encountered.
- Read-only Paystack GET `/transaction?perPage=1`: HTTP 200, status true.
  Initial sandbox DNS failure was resolved using approved network access.
- Disposable local QA target: Supabase 127.0.0.1:55421, Postgres
  127.0.0.1:55422. Existing harness rejects non-local hosts, overrides admin
  configuration to test URLs, and deletes fixture workspaces afterward.
- `.env.test` initially was NOT ignored (entry commented out). Fixed;
  `git check-ignore .env.test` now succeeds; file is untracked.
- Test webhook public URL and NGN enablement: human confirmation requested,
  not received at report time. No real webhook delivery claimed.
- Focused boundary regression reproduction: 3 failures, 22 passes before fixes;
  25 passes afterward. Logs: `/tmp/paystack-regression-red.log` and
  `/tmp/paystack-regression-green.log`.
- Expanded real DB handler suite: **19 passed** (`/tmp/paystack-db-expanded.log`).
  Tests invoke the production Request/Response handler and real PostgREST RPC;
  they do not prove HTTP routing through a running application server.
- `pnpm exec vitest run`: **754 passed, 86 skipped**, 90 passed files/10 skipped.
  The Paystack DB suites run against the local QA stack because the gitignored
  `.env.test` sets `PAYSTACK_DB_LIVE=1`; without that file they skip. Existing
  opt-in non-Paystack live suites remain skipped; no skips added.
- Focused Paystack directory run (unit + DB): **64 passed** across 6 files.
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0, **357 warnings**.
- `pnpm exec biome check` on touched TypeScript files: exit 0.
- Load-bearing proof: reverting the durable-reference fix made the F12 test
  fail; forcing unconditional reuse made the F8 stale-charge test fail;
  disabling the currency gate made the F9 test fail. Each was restored.
- Initial DB attempt failed with sandbox EPERM; rerun with localhost access
  passed. This was an environment failure, not repaired by weakening tests.

## Implementation map

| Path | Behavior |
|---|---|
| `src/routes/api/payments/paystack/initialize.ts:10` | Token-only public initialization, rate limits, calls server helper. |
| `src/server/data/paystack-server.ts` `ensurePaystackTransferCharge` | Reads invoice by token, server-derived collection amount, NG workspace capability. F9: requires NGN and sends explicit `NGN`. F8: reuses a pending charge only when amount+currency still match; a stale one is expired and replaced, bounding the one-pending-per-invoice index. |
| `src/server/data/paystack-server.ts` (provider reference) | F12: persists the FINAL `velure-<invoiceId>-<ts>` reference before the `/charge` call, so a webhook that races the response or a failed post-provider update can never leave a paid reference unmatched. No `claim-...` placeholder is written. |
| `src/server/data/paystack-server.ts` (charge call) | POST `/charge` (Pay with Transfer), not hosted checkout. Sends client email, integer kobo via `nairaToKobo`, explicit NGN, bank-transfer expiry, invoiceId/token/invoiceNumber metadata; no callback URL. |
| `src/routes/api/payments/paystack/webhook.ts:31` | HMAC SHA512 and timing-safe comparison, strict 128-character hex validation. |
| `src/routes/api/payments/paystack/webhook.ts:54` | Bounded request body, signature before JSON, validates object/event, ignores unrelated events, forwards charge.success/status success only. F11: one structured `payment_anomaly` event per business rejection. |
| `src/server/data/paystack-server.ts` `confirmPaystackWebhookPayment` | Confirmation wrapper calls the shared atomic service-role RPC with a decimal-string amount. |
| `supabase/migrations/20261028000000_einvoice_paystack_webhook_safety.sql:40` | Locks stored charge/invoice, matches reference/amount/currency, checks cancellation/balance, records transaction and invoice in one transaction. Structured review rejections; unique provider/reference transaction index backs idempotency. |
| `src/server/data/paystack-server.ts` `reconcilePendingPaystackCharges` | F7: verifies charges past expiry (15 min grace, 7 day window) via `GET /transaction/verify/:reference`; credits ONLY a confirmed success through the same idempotent RPC. A non-success/unverifiable reply never changes charge state, so the pending slot is not released early. |
| `src/routes/api/payments/paystack/reconcile.ts` | Scheduler-secret (`INVOICE_SCHEDULER_SECRET`) trigger for the recovery job; no session/tenant id. |
| `src/server/data/payments.ts:237` | Derived paid/partially-paid status. Existing schema stores decimal numeric naira; integer kobo is used at provider boundary. |
| `src/server/data/money.ts:19` | Parses decimal number representation with bigint to convert naira to safe integer kobo. Reverse conversion returns decimal text. Upstream invoice calculation still needs a wider decimal-money audit. |
| Verify/callback/reconciliation | Server-side verify/reconciliation now exists (F7). Browser redirect still cannot settle this flow; recovery depends on the scheduler being wired and `PAYSTACK_SECRET_KEY` being present. |

Trust boundary: public token locates stored invoice; webhook metadata does not
select ownership. Settlement ownership comes from stored charge/workspace.
Service-role RPC is server-only; local tests exercise it, not a full RLS audit.
No schema/auth/tenancy changes made during this rerun. ProductStrategy.md,
Architecture.md, migration-plan.md and prompts/TEMPLATE.md are absent in this
checkout; infrastructure phase cannot be independently established from them.
No Midday port or architecture redesign attempted.

## Test results

### Unit cases (4.1)

| Case | Result | Evidence |
|---|---|---|
| Valid signature; altered byte; wrong key; missing header | PASS | -webhook.test.ts |
| Different length/non-hex signature | PASS | -webhook.test.ts |
| Valid digest plus garbage | PASS after reproduced failure | Boundary regression |
| 1500, 1500.5, 0.01, 19.99, large money conversions | PASS | money.test.ts |
| Negative, NaN, excess decimals, unsafe integer rejection | PASS | money.test.ts |
| Reverse conversion and round trip | PASS | money.test.ts |
| Reference uniqueness over many generations | NOT RUN | Timestamp generator inline; DB index alone does not prove generator uniqueness. |

### Webhook integration cases (4.2)

All cases below ran through handler + local DB, with fixtures cleaned up.

| # | Case | Result / evidence |
|---|---|---|
| 1 | Correct success | PASS, paid once, one transaction |
| 2 | Sequential duplicate | PASS, duplicate result, one credit |
| 3 | 10 concurrent deliveries | PASS, all 200, exactly one credit |
| 4 | Invalid signature | PASS, 401 and invoice/charge unchanged |
| 5 | Missing signature | PASS, 401 and invoice/charge unchanged |
| 6 | Tampered body | PASS, 401 and invoice/charge unchanged |
| 7 | Underpayment | PASS with policy caveat: charge amount 400 on invoice 1500 becomes partially-paid; amount differing from stored charge is rejected in separate case. This does not establish human approval of partial-payment policy. |
| 8 | Over balance | PASS, manual_review, zero transactions |
| 9 | Wrong currency / wrong amount | PASS, no credit |
| 10 | Unknown reference | PASS, 200 rejection; no fixture-wide DB snapshot assertion |
| 11 | Already-paid invoice, fresh event | PASS, no new credit |
| 12 | Non-success status | PASS, 200, DB unchanged |
| 13 | Unhandled event | PASS, 200, DB unchanged; unrelated non-payment shape covered in unit test |
| 14 | Signed malformed JSON | PASS, 400, DB unchanged |
| 15 | Canceled invoice | PASS, no credit |
| 16 | Injected DB failure | PASS, transaction rolled back; direct handler throws (actual wire HTTP 500 not tested) |
| 17 | Retry after failure | PASS, one credit |
| Extra | Optional provider ID/email absent | PASS, legitimate event settles; prior F10 failure claim NOT reproduced |
| Extra | Second remainder payment | PASS, first reference retained, two transaction rows |

### Initialization and reconciliation cases (4.5)

All cases below ran through the production helpers and real PostgREST/RPC;
provider HTTP is mocked, Supabase traffic passes through.

| # | Case | Result / evidence |
|---|---|---|
| 1 | F12: final reference persisted and equal to the `/charge` request reference | PASS (`-initialize-db.integration.test.ts`) |
| 2 | F12: a failed provider call still leaves the final reference durable | PASS; fails on the old `claim-...` placeholder (load-bearing) |
| 3 | F8: matching pending charge reused with no provider call | PASS |
| 4 | F8: stale pending charge expired, fresh correct charge issued | PASS; fails if unconditional reuse is restored |
| 5 | F9: non-NGN invoice refused, provider untouched | PASS; fails if the currency gate is removed |
| 6 | F7: missed success discovered by verify credited exactly once | PASS (`-reconcile-db.integration.test.ts`) |
| 7 | F7: a second reconcile run is a no-op, no double credit | PASS |
| 8 | F7: abandoned/non-success verify leaves charge `pending`, zero credit | PASS |
| 9 | F7: canceled invoice is flagged `manual_review`, never credited | PASS |
| 10 | F7: charge older than the recovery window is ignored | PASS |
| 11 | F7: no secret key fails closed, verification never runs | PASS |
| 12 | F11: one structured `payment_anomaly` line per checked charge | PASS |
| 13 | Reconcile route: 401 without/with wrong secret, 200 with summary, 500 on throw | PASS (`-reconcile.test.ts`) |

### Real Paystack and reconciliation (4.3–4.4)

| Step | Result / reason |
|---|---|
| Key read-only verification | PASS, HTTP 200/status true |
| Create app invoice and initialize real Paystack payment | NOT RUN in this rerun |
| Verify pending/abandoned before payment | NOT RUN in this rerun; previous report evidence not treated as fresh proof |
| Complete successful checkout/card or charge API | NOT RUN; app uses transfer flow, no public test webhook URL confirmed |
| Poll for real webhook; assert real settled amount/currency | NOT RUN, public tunnel/dashboard configuration missing |
| Callback double-credit test | NOT RUN, no callback in app flow |
| Abandoned invoice stays payable | NOT RUN end-to-end |
| Declined card stays payable | NOT RUN, app has no card checkout path |
| Missed-webhook recovery | GAP, no verify/reconciliation implementation |
| Verify alone settles after webhook loss | NOT RUN, no fallback exists |

## Findings and changes

| ID | Severity | Root cause | Change / evidence |
|---|---|---|---|
| R1 | Medium | webhook.ts:37 decoded hex before validating syntax; Buffer ignores trailing garbage after a correct digest. This is noncanonical signature acceptance, not a demonstrated forgery without the key. | Enforce exactly 128 hex characters; regression failed then passed. |
| R2 | Medium | webhook.ts cast parsed JSON to object and accessed null.data (old line 97). | Reject null/primitive/array JSON with 400; regression failed then passed. |
| R3 | Medium | webhook.ts validated payment fields before filtering unrelated events. | Filter recognized event type after signed envelope validation; regression failed then passed. |
| R4 | High hygiene risk | .gitignore had commented .env.test entry. | Restore ignore; git check-ignore verifies. No secret copied. |
| F1–F6 from prior work | Previously fixed, rerun confirms tested behavior | Existing cancellation/mismatch RPC guards, full raw JSON storage, money conversion and currency requirement. | Preserved existing work; DB and unit suites green. Historical red tests were not rerun by reverting SQL this time. |
| F7 | High, closed | No Paystack verify fallback anywhere in app. | Added `reconcilePendingPaystackCharges` + scheduler-secret `POST /api/payments/paystack/reconcile`. Verifies expired pending charges via `GET /transaction/verify/:reference`; credits ONLY a confirmed success through the same idempotent RPC. Non-success never changes charge state, so no early slot release/double-pay. Tested with real PostgREST/RPC. |
| F8 | High, closed | Pending charge was reused without comparing the current amount/currency. | User-confirmed policy: expire stale, issue fresh. `canReuseCollectionSession` now gates reuse; a mismatched/expired pending charge is marked `expired` before a fresh charge is claimed. Old behavior reproduced as a failing test, then green. |
| F9 | Medium, closed | The path forwarded the invoice currency; the workspace gate only checked country. | User-confirmed policy: NGN only. Non-NGN invoices are refused before any provider call; the `/charge` body sends explicit `NGN`. Failing test then green. |
| F10 | Not a defect / closed | Earlier report claimed absent optional RPC args fail resolution. | Reproduced against real PostgREST: both omitted (`case` optional-args test) and provided (`case 1`, with id + email) resolve. No speculative null-argument change made. |
| F11 | Medium, closed (sink still infra) | Rejection handling only used ad-hoc `console` logs; no structured signal. | Added one `payment_anomaly` structured JSON event (`logPaymentAnomaly`) wired into webhook rejections and reconciliation decisions; asserted in tests. A durable external alert sink (Sentry/pager) remains an infrastructure gap, flagged below. |
| F12 | High, closed | Persisted a `claim-...` reference and only wrote the provider reference after the network response. | The FINAL `velure-<invoiceId>-<ts>` reference is now inserted before `/charge`, so a racing webhook or failed post-provider update cannot leave a paid reference unmatched. Regression test fails on the old placeholder behavior. |

Existing migration `20261028000000_einvoice_paystack_webhook_safety.sql` was
already present and active in the local stack. No migration applied/reverted
or schema changed by this rerun (only temporary rollback-test trigger, removed
in finally). Its commented down path was not executed; reversibility remains
unverified here. No production correction/backfill attempted.

## Open questions and next steps

1. Supply the configured public test webhook URL and confirm NGN enablement;
   then run a real paid test-mode transfer end to end (not run here).
2. Confirm the remaining money policies before changing them: partial/deposit
   settlement, overpayment handling and refunds. (Stale-charge replacement and
   NGN-only charging were confirmed and are implemented.)
3. Restore any missing governing documents before migration/architecture work.
   Durable provider-reference initialization (F12) and reconciliation (F7) are
   now implemented and tested locally.
4. Wire `POST /api/payments/paystack/reconcile` to a real scheduler and set
   `INVOICE_SCHEDULER_SECRET`; recovery is inert until the job actually runs.
5. Add a durable alert sink for the `payment_anomaly` events (F11) — structured
   logs exist, but no external pager/Sentry sink is wired.
6. Audit upstream decimal amount calculations and sensitive raw-event
   retention. Current full-body persistence is not a privacy audit.

Do not use this report as go-live approval. Go-live actions remain human-only.
