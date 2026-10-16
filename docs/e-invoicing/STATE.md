# E-invoicing build ledger

Spec: `docs/e-invoicing/SPEC.md` (section 5 = master fix list).
Run scope: **Wave 1 only** (WP1–WP5). Waves 2–6 remain pending for a future run.
Base tag: `einv-base` (313c464). Integration branch: `einv/integration`.

Status: pending | ready | implementing | auditing | fixing | merged | blocked

| Package | Spec fixes | Depends on | Status | Branch | Base sha | Audit rounds | Open findings |
|---|---|---|---|---|---|---|---|
| WP1 | A1,A2,A3 | none | auditing | einv/wp1 | 536f564 | 0 | — |
| WP2 | B1 | none | auditing | einv/wp2 | 536f564 | 0 | — |
| WP3 | H1 | none | ready (serialized after WP4 merge) | einv/wp3 | 536f564 | 0 | — |
| WP4 | G1 | none | implementing (session interrupted; uncommitted work present, resuming) | einv/wp4 | 536f564 | 0 | — |
| WP5 | E2 | none | auditing | einv/wp5 | 536f564 | 0 | — |
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

## Notes

- Auditor command permissions in `.opencode/agents/auditor.md` were fixed by the orchestrator (commit 05bad04, lines 21–23): invalid YAML replaced with `pnpm test*` / `pnpm check*` / `pnpm typecheck*` allow rules.
