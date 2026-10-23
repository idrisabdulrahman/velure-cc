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
| WP6 | B2 | WP2 (merged) | **merged** (round 3 PASS @d4303ee; follow-up @00dbd9f independently audited PASS and merged; follow-up suite 481/86, typecheck 0, check 0 with 356 existing warnings) | einv/wp6 | bf82fad | 3 | No open findings. R1/R2/R3 customer-gate, import paging, legacy address, and live-fixture findings closed by d4303ee and 00dbd9f |
| WP7 | B3 | WP5,WP6,WP8 (merged) | **merged** (audited PASS; merge commit 3878acc; WP7 branch 6e98e3f; integration 542 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp7 | 5901e58 | 1 | No open findings; live RLS validation unavailable without linked Supabase |
| WP8 | C1,C2,C3 | WP4 (merged) | **merged** (round 1 FAIL @87b6869; audit-fix @c53139f; integration review found and closed manual second-payment reference overwrite; final integration checks: 530 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp8 | 96d5c49 | 2 | R1 findings and cross-package manual-payment reference issue closed with regressions. No live migration/application test |
| WP9 | B6 | WP8 (merged) | **merged** (audit PASS; merge commit 4b90014; package commit a6e9384; integration 551 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp9 | 8ade385 | 1 | No open findings; live Supabase migration/RLS validation unavailable |
| WP10 | D1 | WP6,WP7,WP8,WP9 (merged) | **merged** (audit PASS after one fix round; merge commit 07a6755; branch commit b264778; integration 558 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp10 | a5aed99 | 2 | No open findings; live DB checks not applicable (pure mapper) |
| WP11 | D3 | WP8,WP10 (merged) | **merged** (audit PASS; merge commit 88b958d; package commit 40a7c9f; integration 568 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp11 | af6088e | 1 | No open findings; live DB/provider tests not needed (pure state model) |
| WP12 | D8 | WP10,WP5 | **merged** (audit PASS after 3 fix rounds; merge commit 5a90fd2; branch commit f8a08e9; integration 587 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp12 | 5164b35 | 4 | No open findings; no live Supabase RLS/provider checks available or needed for this pure validator and scoped loader |
| WP13 | D2,D10 | WP10,WP11 | **merged** (audit PASS; merge commit e011da7; branch commit a8b0ded; integration 598 passed/86 skipped, typecheck 0, check 0 with 356 existing warnings) | einv/wp13 | 8baeb3d | 1 | No open findings; no live provider/Supabase test is applicable (mock-only adapter) |
| WP14 | D4,D6,D9 | WP13 (merged) | **merged** (round 3 PASS; branch commit 74b83d6; merge commit d8cbce0; integration suite 608 passed/86 skipped) | einv/wp14 | 42b0c8f | 3 | No open code findings; live RLS and deployment cron wiring remain unverified |
| WP15 | H2 | WP13 | **auditing** (round 2; sanitizer normalization fix 2040798) | einv/wp15 | 259d45c | 2 | Prior MEDIUM snake_case key finding fixed; live Supabase/provider validation unavailable |
| WP16 | D5,D7,C4 | WP14 | pending | — | — | 0 | — |

## Coordination notes (wave-1 session, 2026-10-18 evening)

- **Auditor subagent registered.** The main checkout's `.opencode/agents/auditor.md` had invalid YAML in its frontmatter (a 5-space-indented `"pnpm typecheck"` rule inside the permission map), so OpenCode never registered the `auditor` agent id — audits had to run via `general`. Fixed to consistent indentation with `pnpm test*`/`pnpm check*`/`pnpm typecheck*` wildcard rules; registration probed OK. The integration copy (lines 21–23) was already correct; only the running session's project file differed (main checkout keeps `webfetch: ask`, integration has `deny`).
- **Live-test branch `v2` created.** From `origin/main` (be5b8e4, an ancestor of `einv-base`), fast-forwarded to this integration tip. Worktree: `/home/asys/.local/share/opencode/worktree/f96efc/v2`. Green there: test 390 passed / 86 skipped, typecheck 0, check 0 errors / 356 warnings, `pnpm build` ✓. Refresh after each integration merge with `git -C <v2-path> merge einv/integration` (fast-forward expected). Never pushed anywhere; remote push needs the user's explicit go-ahead.
- **Home-directory migration:** the machine moved `/home/atlas` → `/home/asys` mid-session (~21:19–22:30 today). Git re-resolved every worktree record, but absolute `/home/atlas/...` paths in older prompts and shells are dead — use `/home/asys/...` from now on.
- **WP-SOURCES (non-WP copy task): CLOSED / merged.** Implementer delivered `4391c40` on `einv/sources` (3 files: `nigeria.ts` sources list + intro, `settings.compliance.tsx` official-sources section after the untouched disclaimer, `nrs-claims.test.ts` URL/wiring/non-affiliation/banned-words pins). Merged `--no-ff` as `bf82fad`. Audit round 1: **PASS** (registered `auditor`, fresh context; criteria 1–6 verified incl. live fetches of all 4 URLs; WP1 base tests confirmed unmodified line-for-line). Two LOW findings (loose file-scoped wiring substrings; claim-scan limited to shared constants) fixed in cheap-fix round `895bb6d` — test-only hardening: per-anchor binding of `target="_blank"`/`rel="noopener noreferrer"` inside the section slice, claim scan extended over the route section; bite-evidence recorded (auditor's exact mutation scenarios now fail the suite). Final merge `6a44165`; suites green on integration AND v2 (394 passed / 86 skipped, rc=0; typecheck 0; check 0 errors / 356 warnings; v2 build ✓). Worktree `.worktrees/sources` removed; branch `einv/sources` retained. Official sources verified live 2026-10-18: community.nrsmbs.com KB ×2, einvoice.nrs.gov.ng, nrs.gov.ng. Audit rounds: 1 + cheap-fix round.

## Baseline (einv-base, 313c464)

- stack: TanStack Start (React 19, Vite 7, Nitro/Cloudflare Pages) + Supabase Postgres (pg/kysely/drizzle available) + Better Auth + Tailwind 4 + Biome + Vitest 4 + Playwright.
- commands: test `pnpm test` (vitest run); typecheck `pnpm typecheck` (tsc --noEmit); lint `pnpm check` (biome check); build `pnpm build`.
- baseline: typecheck PASS; test 144 passed / 55 skipped (36 files passed, 8 skipped); biome check exit 0 with 356 pre-existing warnings.
- live DB tests (`A10_LIVE=1`) require a linked Supabase instance; not part of the default suite.

## Integration head checks (honest counts since 54709b8)

- 54709b8: excluded `.worktrees/**` from biome and vitest. Before this, root-suite runs silently collected tests from every nested worktree checkout (859 stray vitest entries) — merge validation was over-reporting.
- b3b7806 (WP5 merged): 191 passed / 55 skipped, typecheck 0, check 356 warnings.
- 5a90fd2 (WP12 merged): **587 passed / 86 skipped, typecheck 0, check exit 0 / 356 existing warnings**; WP12 focused tests 21 passed.
- e011da7 (WP13 merged): **598 passed / 86 skipped, typecheck 0, check exit 0 / 356 existing warnings**; WP13 focused tests 11 passed.
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
