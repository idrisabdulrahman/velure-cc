# T6/T7 — e-invoicing gap analysis and provider questions

Status: done

Task source: `Task List.md` (Phase 2+, real e-invoicing groundwork), T6 and T7.
Research/analysis only. No product code, schema, migration, or customer-facing
copy is changed by this task.

## Goal

- **T6:** map Velure's canonical invoice model to the real NRS/MBS schema field
  by field — canonical has it? validator checks it? known rejection codes? —
  without inventing schema detail. Answer where the canonical fields came from,
  why the model is provider-agnostic, and where the 10-digit TIN rule came from.
- **T7:** compile the accredited-provider (SI/APP) landscape from official
  sources where possible (noting sandbox availability), and draft the question
  list for providers and NRS/NITDA. Do not contact anyone.

## Decisions / assumptions (confirmed with user 2026-10-30)

- **T6 source:** public official sources only (official NRS developer portal +
  a certified provider's public docs). No private NITDA/NRS documents supplied;
  uncovered fields are marked **UNKNOWN**.
- **T7 contacts:** no one has spoken to a provider or NRS/NITDA yet.
- **T7 constraints:** none known (no cost ceiling, provider preference, or
  timeline).
- No network calls to NRS, a provider, or any sandbox; desk research only.

## Skills read

- No Midday-port skill applies (this is SPEC-only research, not a Midday parity
  port). Governance: `AGENTS.md` §2/§5/§10 and the E-invoicing work rules.
- `Task List.md` T6/T7 blocks were pasted by the user and read in full.

## Existing code inspected

- `src/features/einvoicing/canonical-invoice.ts:1-308` — canonical model and
  `toCanonicalInvoice` (maps the existing snapshot only).
- `src/features/einvoicing/validate-canonical-invoice.ts:1-447` — WP12
  pre-submission validator (field coverage).
- `src/features/einvoicing/provider-adapter.ts` and `rejection-guidance.ts` —
  mock adapter and the (invented) mock rejection codes.
- `src/features/compliance/supplier-profile.ts:1-90` — `NIGERIA_TIN_PATTERN =
  /^\d{10}$/`, `TODO(tin-checksum)`.
- `prompts/einv-wp10.md`, `prompts/einv-wp13.md` — provenance and mock-only scope.
- `docs/e-invoicing/SPEC.md` §3.1 P6, §5 (D1–D11), §6.2 item 4, §8 — the
  unconfirmed items T6 exists to close.

## Files likely to change or be added

- `docs/EINVOICE-GAP-ANALYSIS.md` — the deliverable.
- `docs/DECISIONS.md` — T6/T7 answers.
- `prompts/t6-t7-einvoice-gap-analysis.md` — this prompt.
- Obsidian handoff note (stopping point).

## Implementation requirements

- For each real NRS field: canonical presence, validator coverage, known
  rejection code. Unknowns marked UNKNOWN, never inferred.
- Provenance answers for the three T6 questions.
- T7 provider list clearly labelled secondary/unverified, with the official
  register named as the authority, and sandbox availability noted.
- T7 provider + NRS/NITDA question list, delivered to the user, no contact made.

## Acceptance criteria

- `docs/EINVOICE-GAP-ANALYSIS.md` exists and is field-by-field.
- Every unknown is labelled UNKNOWN; no schema detail invented.
- Provenance (spec/provider/inference) and the 10-digit TIN origin answered.
- Provider/accreditation question list is present and contact-free.
- User reviews the gap analysis (T6 "done when").

## Checks to run

- `pnpm test`
- `pnpm typecheck`
- `pnpm check`
- Docs-only: no schema/RLS/live check applicable. No provider or NRS call made.

## Scope changes (append-only)

- 2026-10-30: User chose "public official sources only" for T6, "no contact yet"
  and "no constraints" for T7. Doc written against the official NRS developer
  portal plus Etranzact's public docs; provider list marked secondary.

## Results

- `docs/EINVOICE-GAP-ANALYSIS.md` written: provenance answers, ~60-row
  field-by-field gap table across envelope/parties/lines/payment/tax/totals,
  the rejection-code finding (only HTTP codes public; app codes are invented
  mock codes), a secondary/unverified provider list, and 15 provider/NRS
  questions.
- Checks (docs-only change): `pnpm typecheck` clean; `pnpm test` 787 passed /
  86 skipped (no change); `pnpm check` exit 0 (359 warnings, unchanged
  baseline). No schema/RLS/live check applies; no provider or NRS call made.
- T6 "done when" (user reviewed) is pending the user reading the doc.
