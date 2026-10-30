# Bank-transfer reconciliation options

Task: **T9** of `Task List.md` (Phase 3). Docs-only memo — **no code was
written.** Written 2026-10-30.

> Read with the audit's honesty rules: this is not financial or tax advice, and
> nothing here claims a payment provider relationship Velure does not have.

## 1. Why this exists

T9 asks: why is money reconciled by **manual entry plus Paystack only**, and
what are the realistic alternatives? The deliverable is a comparison with costs
and effort, plus a decision for the user. No code until the user chooses.

The three options:

| # | Option | Status today |
| --- | --- | --- |
| A | Manual payment recording | **Built** |
| B | Virtual account per invoice (Paystack) | **Partly built** — Pay-with-Transfer already creates a per-invoice account |
| C | Bank-statement CSV import with auto-matching | **Not built** |
| D | Customer pays into the workspace's **own** bank account (See **§9**, added 2026-10-30) | **Not built** — and it is a new product domain, gated on product-strategy approval |

## 2. The question we cannot answer from the repo

> **How do your customers actually pay you?** What share pay by bank transfer
> rather than card/Paystack? Is there a bank account every customer pays into,
> or many? Do you already reconcile against a bank statement download (CSV,
> Excel, PDF) — and from which banks?

Everything below is sized assuming bank transfer matters. If most money arrives
by card, Option A is already sufficient and B/C are not worth building.

## 3. Option A — manual recording (what exists)

**Mechanism.** The user opens the invoice, clicks record payment, and enters the
amount. `recordPayment` (`src/server/data/payments.ts:452`) writes a
`payment_transactions` row with `source: "manual"`, applies it to the invoice
snapshot via `applyPaymentToSnapshot` (so partial payments and over/underpayment
behaviour are already handled), and runs the same customer gate as every other
leave-Draft path.

**Already handled well.**

- Duplicate protection: a supplied `reference` short-circuits a repeat insert
  (`payments.ts:465-474`).
- Tenancy: the function takes a **user-scoped** client and derives the workspace
  from the verified session (`resolveActiveWorkspaceId`), never a caller-supplied
  id. RLS decides visibility (`payments.ts:483`).
- Audit: settlement changes flow through the existing audit path.

**Gap.**

- It tells the app what the user *believes* happened, not what the bank says.
  Nothing checks the two against each other, so a missed payment, a wrong amount,
  or a payment into the wrong account is only found by a human noticing.
- At any real volume it is the single most tedious task in the product, which is
  exactly the complaint T9 is about.

**Cost.** Zero.

**Effort.** Zero.

**Risk.** Low. It is the current baseline and it is not wrong, just manual.

**Tenancy / audit.** Already correct.

## 4. Option B — virtual account per invoice (Paystack)

**Important correction to the task's premise.** This option is **not** a new
build. `ensurePaystackTransferCharge` (`src/server/data/paystack-server.ts:113`)
already creates a **dedicated virtual account per invoice** through Paystack
`POST /charge` with `bank_transfer`:

- one account number per invoice, tied to the exact collectible amount;
- an **8-hour expiry** (`account_expires_at`, `paystack-server.ts:213`);
- a persisted, deterministic reference `velure-<invoiceId>-<epochMs>`
  (`paystack-server.ts:171`) so a webhook that races the response still resolves;
- a **one-pending-charge-per-invoice** claim (`paystack-server.ts:173`), with
  reuse while the amount and currency still match (`findReusableCharge`);
- confirmation via webhook (`confirmPaystackWebhookPayment`, idempotent on
  reference) **and** a missed-webhook recovery sweep
  (`reconcilePendingPaystackCharges`) triggered by the secret-guarded scheduler
  route `POST /api/payments/paystack/reconcile`.

What is missing is not the mechanism — it is the **general case**:

- **Gating.** Automatic bank transfer is enabled only for `country_code = "NG"`
  (`src/features/payments/capabilities.ts:6`) and refuses any non-NGN invoice
  (`paystack-server.ts:137`). Fine for the current product boundary, but it means
  Option B cannot cover a non-NGN or non-Nigerian workspace.
- **Expiry.** An 8-hour window means a customer who pays "the invoice in my
  inbox" two days later pays a **dead account**. That is a support burden and a
  reconciliation hole, not a payment.
- **Per invoice, not per customer.** A customer with three invoices gets three
  accounts. A Paystack *customer-level* dedicated virtual account (one permanent
  account per customer) is a **different Paystack product** and is not
  implemented here.
- **Fee class is unconfirmed.** Paystack publishes **Virtual Accounts at 1% per
  transaction, capped at ₦300**, while the flow used here is Paystack's
  *Pay-with-Transfer* charge. Whether `/charge` with `bank_transfer` is billed as
  a virtual account or as a transfer must be **confirmed with Paystack**
  (UNKNOWN). Do not quote a fee to customers until it is.

**Cost.** Provider fee per successful collection (published rate above; the
exact class is UNKNOWN). No build cost for the per-invoice case.

**Effort if extended.** Small (`S`): lift expiry or auto-reissue for a late
payer; per-customer accounts and the fee confirmation are the larger parts.

**Risk.** Medium.

- Paystack availability becomes a dependency for a money-in path that currently
  degrades to "customer pays the old-fashioned way and the user records it".
- A dead virtual account is worse than no virtual account, because the customer
  believes they have paid.

**Tenancy / audit.** The whole path runs on the service-role client
server-side — correct for a public payer page, and already gated by
scheduler-secret / webhook signature. Any extension must keep confirmation
server-side and keep actor/workspace/resource/result/timestamp logging.

## 5. Option C — bank-statement CSV import with auto-matching

**Mechanism.** The user exports a statement from their bank (CSV/Excel), uploads
it, and Velure proposes matches between statement credits and open invoices. The
user confirms; confirmed matches call the same `recordPayment` settlement path.

**Nothing exists.** The only CSV reader in the repo is the invoice/customer
importer (`src/features/invoices/import-spreadsheet.ts`); there is no statement
parser, no matching engine, and no review UI. `payment_means[]` is also absent
from the canonical invoice model (`docs/EINVOICE-GAP-ANALYSIS.md` §5.5), so this
is purely an internal reconciliation feature, not an e-invoicing one.

**What it needs.**

1. A statement parser per bank layout. Nigerian bank exports differ in column
   names, date format, and debit/credit sign convention — every layout is a new
   parser, so this is **open-ended**, not one-off.
2. A matcher: candidate scoring on amount (integer kobo), date proximity, and a
   token in the narration (invoice number or customer name), with an explicit
   **ambiguous / no-match** bucket rather than a forced guess.
3. A review screen: accept, reject, or split a credit across invoices, plus
   "ignore this line" so re-uploading the same statement is idempotent.
4. Idempotency: a deterministic reference per statement line
   (`bank:<account>:<date>:<amount>:<narration-hash>`) so `recordPayment`'s
   existing duplicate short-circuit (`payments.ts:465`) makes a re-import a
   no-op.
5. A statement-file trust boundary: the uploaded file is third-party data
   (other people's names and amounts). It must never be public, must be
   workspace-scoped, and the stored file must not outlive the import unless the
   user asks.

**Cost.** Zero provider cost. The real cost is the ongoing parser maintenance.

**Effort.** Large (`L`) and **unbounded by bank count**. A useful v1 that supports
**one** bank layout plus manual confirm is Medium (`M`); every additional bank is
a new slice.

**Risk.** High.

- **Wrong auto-matches are money errors.** Crediting the wrong invoice makes a
  customer look paid when they are not, or hides a shortfall. This is why the
  matcher must propose and a human must confirm, and why nothing may be
  auto-committed on a low-confidence score.
- Parser drift: banks change exports silently.
- Statement files are sensitive personal data.

**Tenancy / audit.** Every match confirmation must be a user-scoped action
deriving the workspace from the session; the import and each confirmation are
material workflows and need audit entries. Never accept a workspace id from the
upload request.

## 6. Comparison

| | A — Manual | B — Virtual account per invoice | C — Statement CSV + auto-match |
| --- | --- | --- | --- |
| Built today | Yes | **Mostly** (per-invoice PWT) | No |
| Covers | Anything | NGN Paystack payers | Any bank credit, if a parser exists |
| Freshest data | Human memory | Real-time webhook (seconds) | As fresh as the last statement upload |
| Matches to the right invoice | By hand | Automatically (amount + reference) | Requires scoring; needs human confirm |
| Provider cost | ₦0 | Per published rate (1%; class UNKNOWN) | ₦0 |
| Build effort | 0 | `S` to extend; `M` for per-customer | `M` for one bank, `L`+ open-ended |
| Main risk | Human error, tedium | Dead/expired accounts; provider dependency | **Wrong match = money error**; parser drift |
| Works outside NG/NGN | Yes (manually) | No | Yes |
| New sensitive data | No | No (bank account per invoice, already stored) | **Yes** — statement files |

### Recommendation

**Default to A + B, and only add C when a real user brings a real statement.**

- B already exists per invoice. The two things worth doing before relying on it
  are cheap and honest: **confirm the Paystack fee class in writing**, and decide
  whether a customer can pay an invoice **after** the 8-hour account expires
  (reissue on the payer page rather than leaving a dead account).
- C is the only option that closes the loop for money that arrived **outside**
  Paystack, but it is large, fragile, and the only option whose failure mode is a
  wrong financial match. It is not worth building speculatively.
- A stays as the universal fallback in every option. It is never removed.

What would change this: if the user's own experience is "most customers pay by
transfer to one account and reconciling by hand already costs me hours a week",
then a **single-bank** v1 of C (Medium) jumps ahead of any further B work,
because it removes the human memory step that B does not cover.

## 7. What I need from you

1. **How do your customers pay today** — card, Paystack transfer, or a plain
   bank transfer to one account? Rough mix is enough.
2. **Do you reconcile against a bank statement**, and if so which bank(s) and in
   what format (CSV/Excel/PDF)?
3. **Choose the next step:**
   - (a) leave A+B as they are (recommended baseline),
   - (b) harden B (fee-class confirmation + late-payer handling),
   - (c) build C v1 for **one** named bank, or
   - (d) none of these yet.

Anything other than (a) will get its own prompt with acceptance criteria before
any code.

## 8. Checks

- Docs-only change; no code, schema, route, or migration touched.
- `pnpm test`, `pnpm typecheck`, `pnpm check` run once; see the task prompt for
  results. Expected: unchanged from baseline.

---

## 9. Addendum (2026-10-30) — Option D: the workspace's own bank account

Raised by the user after reading §1–§8: *"what if the user wants to use their
own bank account … and if it's going to their own account and not the generated
invoice virtual account, how do we verify it — or do we take inspiration from
Midday, where they connect their bank and automatically check it?"*

**This is a new product domain.** `AGENTS.md` §3 requires explicit
product-strategy approval before implementing banking (and Magic Inbox). The
user asking whether it is worth considering is **not** that approval, so nothing
below is built. This section is research and a recommendation only.

### 9.1 The end destination barely changes; the *friction* does

A Paystack virtual account is not a Velure account. Collected money settles
**T+1 into the workspace's own settlement bank account**. So "customer pays into
our own account" changes **how the credit arrives and who can see it**, not
where the money finally lands. What actually differs:

| | Paystack per-invoice virtual account (B) | Workspace's own account (D) |
| --- | --- | --- |
| Who sees the credit | Velure (webhook) + the workspace | Only the workspace's bank |
| Matched automatically | Yes — reference is generated per invoice | **No** — something must read the bank |
| Dead-account risk | 8-hour expiry | None — the account always works |
| Extra data needed | None | A bank feed or a statement file |
| Customer friction | New account number per invoice | One familiar account number |

### 9.2 How verification can work — three data sources, in order of trust

1. **Aggregator feed (a real bank connection).** The workspace connects its bank
   once; the provider returns transactions. Provider-attested, near-real-time,
   and no file handling. This is what Midday does (§9.3).
2. **Statement file (Option C, bank = the workspace's own account).** Same
   matcher, but the credit comes from a user upload. Trust is at the *member*
   level: a workspace member could upload anything, so this is evidence for the
   workspace's own records, not an independent attestation.
3. **Payer-supplied reference only.** The app instructs the payer to put the
   invoice number in the transfer narration, and the member confirms. Cheapest,
   weakest, and needs no new data at all.

In every case the **matching signals are the same three**: exact reference
(invoice number in the narration), amount (integer kobo, exact or tolerance),
and date proximity. The source changes only how much you trust them.

### 9.3 What Midday actually does (local checkout, inspected 2026-10-30)

Absolute source: `/home/asys/JS-TS/apps/projects/midday-main`.

| Behaviour | Midday source (absolute) | Classification for Velure |
| --- | --- | --- |
| Provider-agnostic bank adapter (plaid, teller, gocardless, enablebanking) | `apps/engine/src/providers/index.ts`, `apps/engine/src/providers/types.ts` | **adapt** the *shape* (one interface, swappable provider); **reject** the provider *set* — none of the four operates in Nigeria |
| Connection + account + transaction tables, team-scoped | `packages/db/src/schema.ts:1056` (`bank_connections`), `:603` (`bank_accounts`), `:290` (`transactions`) | **adapt** (tenant-scoped, one row per connection). **reject** storing the provider `accessToken` in the row (`schema.ts:1068`) — use a secret store; a SELECT-scoped RLS policy is not a secret boundary |
| Cursor/paged sync jobs, reconnect, scheduler | `packages/jobs/src/tasks/bank/sync/account.ts`, `sync/connection.ts`, `setup/initial.ts`, `scheduler/bank-scheduler.ts`, `tasks/reconnect/connection.ts` | **adapt** (idempotent upsert keyed by provider transaction id; retry/backoff; `errorRetries` in `schema.ts`) |
| Matching engine (embedding thresholds, amount tolerance tiers, calibration from user confirm/decline) | `packages/db/src/utils/transaction-matching.ts` (388 lines), `packages/db/src/queries/transaction-matching.ts` (2,180 lines) | **reject for v1** — far too heavy for one bank/one currency. **adapt one idea**: keep an explicit `auto_matched | high_confidence | suggested` distinction and never auto-commit a low-confidence match |
| Match types + suggestions surfaced for human confirmation | `queries/transaction-matching.ts:52,67,81,95` | **adapt** — matches are proposals the user confirms |
| RLS policies scoped to team membership | `schema.ts:1102` (`pgPolicy("Bank Connections can be selected by a member of the team")`, `private.get_teams_for_authenticated_user()`) | **adapt** — the right tenancy shape; Velure's Phase-A equivalent is workspace membership |

Key finding: **Midday's "connect your bank" is real, but it is US/EU only.**
Plaid, Teller, GoCardless and EnableBanking do not cover Nigerian banks, so the
Midday approach cannot be ported as-is. A Nigerian equivalent needs a local
aggregator (for example Mono, Okra, OnePipe or Stitch — named as market options,
**not** evaluated or endorsed here) or the statement-import path.

Also note Midday's connection flow needs a **per-team onboarding + OAuth-like
consent** step, and its provider tokens must be treated as high-value secrets.

### 9.4 Honest risks of Option D

- **A bank feed is a new, high-value secret and a new tenancy surface.** One
  connection = read access to the workspace's whole bank history, not just
  invoices. That is a much bigger blast radius than reading its invoices, and it
  makes token storage, revocation, and audit the hard part.
- **Consent and liability.** The workspace would be granting Velure (or an
  aggregator) ongoing read access to its account. That needs real terms, not a
  checkbox.
- **Aggregator cost is unknown here.** Nigerian aggregator pricing is not
  published in a form this memo could verify → **UNKNOWN**; confirm per provider.
- **Wrong match = money error** (same as Option C).
- **Cross-border and FX**: an own-account credit can arrive in another currency
  at a different amount than invoiced. Matching must then be explicit, never
  guessed.

### 9.5 Recommendation for Option D

**Do not build the bank connection now.** The honest sequencing is:

1. **Cheapest real improvement:** generate a **payment reference** (the invoice
   number) into every invoice's payment instructions and the public payer page,
   so own-account payers *can* be matched exactly. This needs no new provider,
   no new data, and helps Options A, C and D equally. It is the single highest
   value-per-effort item in this whole memo.
2. Decide Option C (statement import) for the workspace's **own** account before
   any bank-connection work — it delivers most of the reconciliation value with
   none of the secret/consent/aggregator risk.
3. Only if statement import proves too manual, evaluate **one** Nigerian
   aggregator against §9.4, as its own prompt with product-strategy approval.

What would change this: if most customers pay into one account *and* the user
will not upload statements, then an aggregator connection is the only path that
removes the human step, and the secret/consent cost becomes justified.

### 9.6 Decision questions (added)

1. When customers pay into your own account, do they **put the invoice number in
   the narration** today? If not, would you be willing to ask them to?
2. Would you rather **upload a statement**, or **connect the bank** and accept
   the consent/secret implications in §9.4?
3. Is "customer pays into one familiar account number" a **requirement** from
   your customers, or a description of what they do because there is no
   alternative?

