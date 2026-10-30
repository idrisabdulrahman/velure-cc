# T9 addendum — the workspace's own bank account (research only)

Status: done
Task: follow-up to T9 of `Task List.md`. **Docs-only; no code.**
Raised by the user 2026-10-30 while reviewing `docs/BANK-RECONCILIATION-OPTIONS.md`.

## Goal

Answer the user's question: if a workspace wants customers to pay into **its own
bank account** rather than a generated per-invoice virtual account, how would
Velure verify the payment — or should it copy Midday's "connect your bank and
check automatically" approach?

Deliverable: an addendum (**§9**) in `docs/BANK-RECONCILIATION-OPTIONS.md`,
grounded in the Midday source checkout, with a match/adapt/reject classification
and a recommendation. No code, because banking is a **new product domain** that
`AGENTS.md` §3 gates on explicit product-strategy approval.

## Decisions / assumptions (confirmed with user)

- **T9 answer (user, 2026-10-30):** keep manual + per-invoice virtual accounts
  (no new code), *and* investigate the own-bank-account case. Recorded as Q-I in
  `docs/DECISIONS.md`.
- **Payment mix (user, 2026-10-30):** **mixed** — this is why statement import
  and own-account verification are worth researching rather than dismissing.
- **Assumption, stated in the addendum, not assumed silently:** a Paystack
  virtual account settles into the workspace's own settlement bank, so Option D
  changes collection friction and visibility, not the final destination.
- **Gate:** the user asking about it is not product-strategy approval. Nothing is
  built.

## Skills read

- **Gap recorded (required by `AGENTS.md` §7):** the banking skills that
  `AGENTS.md` §7 names — `/home/asys/.agents/skills/plaid-fintech/SKILL.md`
  (critical) and `/home/asys/.agents/skills/bank-sync/SKILL.md` — are **not
  installed** at those paths or anywhere under `/home/asys`. `plaid-fintech` is
  only listed in `/home/asys/.agents/skills/CATALOG.md:798`; `bank-sync` is not
  in the catalog either. No substitute skill was loaded; this addendum cites the
  Midday source and provider facts directly instead, and flags aggregator
  pricing as UNKNOWN.
- `repo-governance` (`AGENTS.md` §3 Midday parity rule, §7 banking row, §8
  tenancy floor) applied by hand.

## Existing code inspected (Velure)

- `docs/BANK-RECONCILIATION-OPTIONS.md` §1–§8 (the parent memo).
- `src/features/payments/capabilities.ts:6` — `PAYSTACK_PWT_COUNTRIES = ["NG"]`.
- `src/server/data/paystack-server.ts:113-285` — per-invoice Paystack
  Pay-with-Transfer charge (the thing Option D is an alternative to).
- `src/server/data/payments.ts:452-520` — `recordPayment`, the single settlement
  path every option must funnel through.
- `src/features/invoices/import-spreadsheet.ts` — the only CSV parser in the repo.

## Midday parity record (source: `/home/asys/JS-TS/apps/projects/midday-main`)

| Behaviour | Midday source (absolute) | Classification |
| --- | --- | --- |
| Provider-agnostic bank adapter (plaid, teller, gocardless, enablebanking) | `apps/engine/src/providers/index.ts`, `apps/engine/src/providers/types.ts` | **adapt** shape; **reject** the provider set (none operate in Nigeria) |
| `bank_connections` / `bank_accounts` / `transactions` schema | `packages/db/src/schema.ts:1056`, `:603`, `:290` | **adapt** tenant scoping; **reject** provider token in a row (`schema.ts:1068`) |
| Sync / reconnect / scheduler jobs | `packages/jobs/src/tasks/bank/sync/account.ts`, `sync/connection.ts`, `setup/initial.ts`, `scheduler/bank-scheduler.ts`, `tasks/reconnect/connection.ts` | **adapt** as idempotent upsert + retry/backoff design |
| Matching engine (embeddings + tolerance tiers + calibration) | `packages/db/src/utils/transaction-matching.ts`, `packages/db/src/queries/transaction-matching.ts` | **reject for v1**; **adapt** only the explicit match-tier idea (`queries/transaction-matching.ts:52`) |
| Team-scoped RLS on connections | `packages/db/src/schema.ts:1102` | **adapt** to workspace membership in Phase A |

Deviations to record: Velure has no bank-domain schema and no aggregator
contract, and payers' accounts are irrelevant — only the credit to the
workspace's account matters.

## Files likely to change or be added

- `docs/BANK-RECONCILIATION-OPTIONS.md` — add §9 (and a pointer row in §1).
- `docs/DECISIONS.md` — resolve Q-I, add Q-J.
- This prompt.

## Implementation requirements

1. No code, schema, migration, or route.
2. Every Midday claim carries an absolute path and a match/adapt/reject label.
3. State the destination-of-funds point honestly (T+1 settlement) instead of
   implying Option D keeps money elsewhere.
4. Keep the tenancy/secret boundary explicit: a bank feed is read access to the
   workspace's whole bank history, not just invoices.
5. Mark Nigerian aggregator pricing **UNKNOWN**; do not endorse a vendor.
6. Recommendation must name the cheapest real improvement first.

## Acceptance criteria

1. §9 exists and answers "how would we verify it" with the three data sources
   (aggregator feed, statement file, payer reference) in trust order. ✅
2. §9 states that Midday's four providers do not cover Nigeria, with source. ✅
3. §9 records the token-in-row defect to **not** copy, with a path and line. ✅
4. §9 marks aggregator pricing UNKNOWN and names no endorsed vendor. ✅
5. §9 recommends the payment-reference step before any connection work, and
   product-strategy approval before implementation. ✅
6. Q-J added to `docs/DECISIONS.md`; Q-I moved to Resolved with the user's
   answer and the "mixed" payment mix. ✅
7. No code file modified. ✅

## Checks to run

- Docs-only: `pnpm test`, `pnpm typecheck`, `pnpm check` once each.

## Checks run (2026-10-30)

- `pnpm test` → **823 passed / 86 skipped** (unchanged; docs-only).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0, 359 pre-existing warnings.
- No code file modified.

## Scope changes (append-only)

- 2026-10-30: Prompt created for the own-bank-account research addendum.
- 2026-10-30: Research complete. Recommended sequencing: payment reference →
  statement import for the workspace's own account → only then evaluate one
  Nigerian aggregator, with product-strategy approval. Nothing built; the
  `plaid-fintech` / `bank-sync` skill gap is recorded above.
