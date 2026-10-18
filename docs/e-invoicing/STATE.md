# E-invoicing build ledger

Spec: `docs/e-invoicing/SPEC.md` (section 5 = master fix list).
Run scope: **Wave 1 only** (WP1–WP5). Waves 2–6 remain pending for a future run.
Base tag: `einv-base` (313c464). Integration branch: `einv/integration`.

Status: pending | ready | implementing | auditing | fixing | merged | blocked

| Package | Spec fixes | Depends on | Status | Branch | Base sha | Audit rounds | Open findings |
|---|---|---|---|---|---|---|---|
| WP1 | A1,A2,A3 | none | **merged** (round 1 PASS; merge commit 54aac07) | einv/wp1 | 536f564 | 1 | LOW accepted: CSV disclaimer line puts header on row 2 — intentional, pinned by test |
| WP2 | B1 | none | **merged** (round 1 PASS + cheap fixes; round 2 PASS + cheap fixes 51fddd4; merge commit bde111d; post-merge suite green) | einv/wp2 | 536f564 | 2 | L: source-shape tests in settings.index.test.ts should become component tests when a harness exists; L: editable Country field on the supplier form is a product decision (drops NG TIN/RC requirements when changed); carried from round 1: "server boundary" is app-layer only (no DB CHECK on profile fields) — product decision; BN- RC acceptance — product decision. No round-3 audit was run for the round-2 cheap fixes (merge-time full suite used instead) |
| WP3 | H1 | none | ready — dispatching on rebased branch (will cover WP1/2/4/5 surfaces incl. the audit endpoint) | einv/wp3 | 536f564 (branch will be fast-forwarded to integration tip before implementation) | 0 | — |
| WP4 | G1 | none | **merged** (round 1 FAIL: BLOCKER service-role writer reachable from browser; fix round; round 2 PASS; merge commit 429c4dd) | einv/wp4 | 536f564 | 2 | MEDIUM logged: audit POST failure after invoice insert commits → retry can duplicate the draft (non-atomic; fix = idempotency per mutation). LOW logged: client-asserted audit content is a documented trust boundary; autosave writes one full-snapshot audit row per debounce (coalescing deferred, G2 retention is "Later"); no live test for service-key DELETE rejection (A10_LIVE-gated); scheduled-invoice mailer writes no audit row (needs system-actor entry point); audit endpoint has no rate limit |
| WP5 | E2 | none | **merged** (round 1 PASS + WHT-base parameterized; round 2 PASS dbdedc0; merge commit b3b7806) | einv/wp5 | 536f564 | 2 | LOW: WHT base (inclusive vs exclusive) needs tax-adviser confirmation — module requires explicit parameter, no default assumed; stale Results line in prompts/wp5 file (disk-only, prompts/ gitignored) |
| WP6 | B2 | WP2 | pending (wave 2, out of scope this run) | — | — | 0 | — |
| WP7 | B3 | WP5 | pending (wave 2, out of scope this run) | — | — | 0 | — |
| WP8 | C1,C2,C3 | WP4 | pending (wave 2, out of scope this run) | — | — | 0 | — |
| WP9 | B6 | WP8 | pending | — | — | 0 | — |
| WP10 | D1 | WP6,WP7,WP8 | pending | — | — | 0 | — |
| WP11 | D3 | WP8,WP10 | pending | — | — | 0 | — |
| WP12 | D8 | WP10,WP5 | pending | — | — | 0 | — |
| WP13 | D2,D10 | WP10,WP11 | pending | — | — | 0 | — |
| WP14 | D4,D6,D9 | WP13 | pending | — | — | 0 | — |
| WP15 | H2 | WP13 | pending | — | — | 0 | — |
| WP16 | D5,D7,C4 | WP14 | pending | — | — | 0 | — |

## Baseline (einv-base, 313c464)

- stack: TanStack Start (React 19, Vite 7, Nitro/Cloudflare Pages) + Supabase Postgres (pg/kysely/drizzle available) + Better Auth + Tailwind 4 + Biome + Vitest 4 + Playwright.
- commands: test `pnpm test` (vitest run); typecheck `pnpm typecheck` (tsc --noEmit); lint `pnpm check` (biome check); build `pnpm build`.
- baseline: typecheck PASS; test 144 passed / 55 skipped (36 files passed, 8 skipped); biome check exit 0 with 356 pre-existing warnings.
- live DB tests (`A10_LIVE=1`) require a linked Supabase instance; not part of the default suite.

## Integration head checks (honest counts since 54709b8)

- 54709b8: excluded `.worktrees/**` from biome and vitest. Before this, root-suite runs silently collected tests from every nested worktree checkout (859 stray vitest entries) — merge validation was over-reporting.
- b3b7806 (WP5 merged): 191 passed / 55 skipped, typecheck 0, check 356 warnings.
- bde111d (WP2 merged): 280 passed / 55 skipped, typecheck 0, check 356 warnings.

## Notes

- Auditor command permissions in `.opencode/agents/auditor.md` were fixed by the orchestrator (commit 05bad04, lines 21–23): invalid YAML replaced with `pnpm test*` / `pnpm check*` / `pnpm typecheck*` allow rules.
- The `auditor` agent id is not registered in the running OpenCode session; audits are executed by fresh `general` subagents given the auditor.md rules verbatim (read-only instructions, same output format).
