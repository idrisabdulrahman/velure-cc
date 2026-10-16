# `src/features/tax` — pure tax math (e-invoicing spec fix E2)

Integer-only VAT/WHT calculation for invoices. Pure module: no DB, no env, no
network, no imports from `src/server/`. Safe on client and server.

## Money and units

- All amounts are **integer minor units (kobo)**. Floats are rejected at the
  boundary (`RangeError` on any non-safe-integer input).
- Rates are **basis points (bps)**: `750` = 7.5%, `500` = 5%.

## Rounding rule (explicit, single implementation in `applyBps`)

**Round half away from zero, applied per line to the line VAT amount and once
per invoice to the WHT amount. Invoice totals are exact integer sums of the
already-rounded line values; sums are never re-rounded.**

Consequences (covered by tests):

- `₦0.20` at 7.5% = 1.5 kobo → `2` kobo per line; two such lines total `4`
  kobo, while one `₦0.40` line totals `3` kobo — per-line rounding is
  deliberate, so per-line tax matches any submitted payload exactly
  (spec E3).
- Negative amounts (credit lines) round away from zero symmetrically
  (`−1.5 → −2`).
- The invariant `grandTotalMinor === Σ lineTotalMinor` and
  `totalVatMinor === Σ lineTax.vatMinor` holds by construction and is
  additionally asserted at runtime in `computeInvoiceTotals`.

## VAT categories

Only `standard` / `zero_rated` / `exempt` (spec §8 flags unconfirmed treatment
nuances beyond these). Zero-rated and exempt lines contribute 0 VAT but always
appear in `vatBreakdown`, which always contains all three categories in fixed
order.

`VAT_RATE_BPS_SPEC_DEFAULT = 750` (7.5%) is a named constant — **rate per
spec, unconfirmed**. Callers may override per invoice (`vatRateBps`) or per
line.

## WHT

- The rate is always **supplied by the caller** in bps; this module bakes in
  no WHT schedule because exact current rates are unverified (spec §8).
- WHT is deducted by the payer: computed on the **VAT-inclusive grand total**
  (consistent with `src/features/compliance/calculate.ts`), reported as
  `totalWhtMinor`, and `netPayableMinor = grandTotalMinor − totalWhtMinor`.

## Relationship to existing code

`src/features/compliance/calculate.ts` performs float-based math on major-unit
numbers for the legacy compliance snapshot and is left untouched. This module
supersedes it as the integer-money source for e-invoicing tax math (WP7/WP12
should call this module, converting stored amounts to minor units at the
persistence boundary).
