# E-invoicing build ledger

Spec: `docs/e-invoicing/SPEC.md` (section 5 = master fix list).
Run scope: **WP1–WP16** (run 2, started 2026-10-18; supersedes run 1's "Wave 1 only" scope). Run 1 completed WP1/2/4/5; WP3 was ready but not started.
Base tag: `einv-base` (313c464). Integration branch: `einv/integration`. Run-2 start tip: f9dad76 (test 322 passed/58 skipped, typecheck 0, check exit 0 / 356 warnings).
Batching rule: packages that touch the same invoice validation/serialization seams or add migrations concurrently are serialized. Batch A: WP3, WP6, WP8. Batch B: WP7.

Status: pending | ready | implementing | auditing | fixing | merged | blocked

| Package | Spec fixes | Depends on | Status | Branch | Base sha | Audit rounds | Open findings |
|---|---|---|---|---|---|---|---|
| WP1 | A1,A2,A3 | none | **merged** (round 1 PASS; merge commit 54aac07) | einv/wp1 | 536f564 | 1 | LOW accepted: CSV disclaimer line puts header on row 2 — intentional, pinned by test |
| WP2 | B1 | none | **merged** (round 1 PASS + cheap fixes; round 2 PASS + cheap fixes 51fddd4; merge commit bde111d; post-merge suite green) | einv/wp2 | 536f564 | 2 | L: source-shape tests in settings.index.test.ts should become component tests when a harness exists; L: editable Country field on the supplier form is a product decision (drops NG TIN/RC requirements when changed); carried from round 1: "server boundary" is app-layer only (no DB CHECK on profile fields) — product decision; BN- RC acceptance — product decision. No round-3 audit was run for the round-2 cheap fixes (merge-time full suite used instead) |
| WP3 | H1 | none | **merged** (round 1 PASS; 3 LOW guard-hardening items fixed in 0abf333; merge commit 46d9869; final-audit MEDIUM/LOW fixes in 58d55af, re-merged db20a28) | einv/wp3 | f9dad76 (ff'd onto integration tip before work) | 1 | No leaks found — app-layer predicates proven load-bearing for all classified exports (60+ data exports, 20 API routes); live RLS matrix (25 tables) not executed here (needs linked Supabase: `pnpm test:wp3-tenant-isolation-live`); rls-only functions verified by code read only. Package complete — no further dispatch needed |
| WP4 | G1 | none | **merged** (round 1 FAIL: BLOCKER service-role writer reachable from browser; fix round; round 2 PASS; merge commit 429c4dd) | einv/wp4 | 536f564 | 2 | MEDIUM logged: audit POST failure after invoice insert commits → retry can duplicate the draft (non-atomic; fix = idempotency per mutation). LOW logged: client-asserted audit content is a documented trust boundary; autosave writes one full-snapshot audit row per debounce (coalescing deferred, G2 retention is "Later"); no live test for service-key DELETE rejection (A10_LIVE-gated); scheduled-invoice mailer writes no audit row (needs system-actor entry point); audit endpoint has no rate limit |
| WP5 | E2 | none | **merged** (round 1 PASS + WHT-base parameterized; round 2 PASS dbdedc0; merge commit b3b7806) | einv/wp5 | 536f564 | 2 | LOW: WHT base (inclusive vs exclusive) needs tax-adviser confirmation — module requires explicit parameter, no default assumed; stale Results line in prompts/wp5 file (disk-only, prompts/ gitignored) |
| WP6 | B2 | WP2 (merged) | **implementing** (worktree .worktrees/wp6) | einv/wp6 | f9dad76 | 0 | — |
| WP7 | B3 | WP5 (merged) | ready — held for batch B (serialized: shares invoice "leave Draft" validation seam with WP6) | — | — | 0 | — |
| WP8 | C1,C2,C3 | WP4 (merged) | **implementing** (worktree .worktrees/wp8) | einv/wp8 | f9dad76 | 0 | — |
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
- 429c4dd (WP4 merged): 322 passed / 58 skipped, typecheck 0, check 356 warnings. One import-hunk conflict in src/server/data/compliance.ts (WP2 + WP4 both added imports) resolved by keeping both.
- 46d9869 (WP3 merged): **383 passed / 86 skipped, typecheck 0, check 356 warnings** — wave 1 final state. 86 skipped = 28 pre-existing + 58 A10_LIVE-gated (now incl. the WP3 RLS matrix).

## Wave 1 result (this run's scope — waves 2+ belong to run 2, started in a parallel session)

All five wave-1 packages (WP1–WP5) merged into `einv/integration`, no blockers, no reverted merges. Final audit (cross-package, scope A1/A2/A3/B1/E2/G1/H1 + tenant isolation, honesty, append-only seams): **PASS** at 46d9869/0abf333 — 390 tests green after the fix round (db20a28).

Final-audit findings and disposition:
- FIXED (58d55af → merged db20a28): duplicate migration version `20261016000000` (supplier migration renamed to `20261016000001`); TRUNCATE bypass of the audit-log delete guard (new `20261018000000_...truncate_guard.sql` statement trigger + guarantee comments corrected); audit endpoint now rejects `resourceId` not belonging to the caller's workspace (session-scoped lookup, 404).
- LOGGED: send route can answer 200 with the audit row absent if the post-send audit insert fails (deliberate, documented; follow-up = async retry queue); wave-1 migrations carry comment-only down sections (repo convention; convention gap flagged by the e-invoicing work rules).

The WP6/WP7/WP8 rows above are owned by run 2's session — this run does not touch them. Ledger commits use `--no-verify` (docs-only; biome ignores docs/ and the pre-commit hook fails on zero processed files).

## Notes

- Auditor command permissions in `.opencode/agents/auditor.md` were fixed by the orchestrator (commit 05bad04, lines 21–23): invalid YAML replaced with `pnpm test*` / `pnpm check*` / `pnpm typecheck*` allow rules.
- The `auditor` agent id is not registered in the running OpenCode session; audits are executed by fresh `general` subagents given the auditor.md rules verbatim (read-only instructions, same output format).
