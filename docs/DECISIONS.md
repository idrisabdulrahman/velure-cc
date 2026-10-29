# Velure decisions ledger

Future agents read this before asking again. One entry per decision: date,
question, answer, task ID. Append-only.

---

## Open questions (awaiting the user)

These block work that depends on the answer. Unattended runs must stop here.

| ID | Question | Why it blocks | Default if forced |
| --- | --- | --- | --- |
| Q-A | **Branch strategy.** Should `V2` be renamed to `development` (as literally asked), or should a fresh `development` branch be cut from current `main` with `V2` retired? | Renaming `V2` verbatim yields a `development` branch one commit behind `main`; pushing it touches both remotes (GitHub + GitLab). | Fresh `development` from `main` (done locally); leave remotes untouched. |
| Q-B | **Where is the walkthrough document** the critique is based on? It is not in the repo, `prompts/`, or the Obsidian vault. | The "ground-truth table" fixes target a document I cannot locate. | Treat `docs/AUDIT-2026-10.md` as the new source-of-truth status table. |
| Q-C | **License intent (T3).** Is Velure intended to be closed-source paid SaaS, or open to publishing source? | AGPL-3.0 obligations on derived Midday code change the answer. | None — legal decision. Ask first. |
| Q-D | **Target segment (T12).** Small businesses only, or also medium taxpayers already inside the mandate? | Drives positioning copy and whether a mock can ever serve the segment. | Small businesses. |
| Q-E | **Scheduler host (T1).** Cloudflare Worker cron, Supabase `pg_cron`, or an external cron caller of the existing secret endpoints? | Deployment is Cloudflare **Pages**, which has no Cron Triggers, so the existing endpoints need an external pinger. | Cloudflare Worker with a Cron Trigger calling the secret endpoints. |
| Q-F | **Real users / pilots (T7/T13).** Are there any real pilot users today? | Ground-truth table honesty. Evidence says effectively none (§7 of the audit). | Report "no known paying users; data is test fixtures". |

---

## Logged decisions

### 2026-10-29 — Task T0 (Phase 0 audit)

- **Decision:** Work on a new local branch `development` cut from `main`
  (`d7d8f07`); do not rename or force-push `V2` until Q-A is answered.
  Rationale: `V2` is an ancestor of `main` (exactly one commit behind), so a
  verbatim rename would drop the latest Paystack hardening commit. Creating a
  fresh branch is reversible and preserves both existing branches.
- **Decision:** Preserve the uncommitted `.gitignore` edits found on checkout
  (`prompts/`, `design/`, `docs/internal/`, `.claude/`, `.opencode/`,
  `.worktrees/` un-ignored). This is user work-in-progress; the prior handoff
  note said the file was to be left alone, but it is now modified on disk.
  Nothing here reverts it.
- **Decision:** Produced `docs/AUDIT-2026-10.md` (read-only verdicts for all
  seven critique claims) plus this ledger. No product behavior, schema,
  numbering, audit-log, or customer-facing document was changed.
- **Baseline checks:** `pnpm test` → 754 passed / 86 skipped (unchanged).

### 2026-10-29 — Task T2 (provisional, needs confirmation)

- **Finding:** The mock IRN/QR is already prefixed (`MOCK-IRN-`,
  `MOCK-SANDBOX|NOT-NRS-CLEARED|`) and the PDF stamps it
  ("MOCK SANDBOX — NOT NRS CLEARED"). The specific risk in the critique is
  refuted. Residual: the mock IRN is present in the public
  `/api/invoice/public/$token` JSON payload for mock-cleared invoices.
- **Proposed:** Strip `fiscalization` from the public payload entirely (it is
  not rendered). Left unapplied pending confirmation — it touches a
  customer-facing response shape.
