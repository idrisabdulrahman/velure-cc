# VPS Node deployment + auth hardening

Status: done
Task ID: vps-node-deployment-2026-11

## Goal

Host Velure on the user's VPS as a Node process under systemd (no Docker),
served at `https://velure.variadic.ng`, port 8490. Deliver the deployment
artifacts (systemd unit, env template, nginx reverse-proxy + TLS block, runbook)
and harden the authentication path to an enterprise baseline.

This is not a Midday parity port. Classification: N/A (infrastructure +
security hardening). No Midday source is ported.

## Decisions / assumptions (confirmed with user)

- 2026-11-01: production sign-in failed on Cloudflare with error 1102
  (`Worker exceeded CPU time limit.`). Root cause is the free/bundled per-request
  CPU budget (10-50 ms) versus better-auth's scrypt (~142-237 ms). Verified
  evidence is in `prompts/auth-signin-1101-2026-11.md`.
- 2026-11-01 (user): "go for option 3 i will host it on a VPS". No Docker; the
  service is managed by systemd, modelled on the user's `dp-metrics` unit
  (`User=variadic`, `EnvironmentFile=/etc/<name>/.env`, `ExecStart=/usr/bin/node`).
- 2026-11-01 (user): domain `velure.variadic.ng`; port **8490**.
- 2026-11-01 (user): "revert [the native scrypt] but still keep cloudflare code
  in the repo so we can use it in the future but clean it off so we dont push it
  to git". Interpretation, recorded: keep the committed Cloudflare support
  (`build:pages` / `deploy:pages` / the Worker-safe pool path) in the repo;
  revert the uncommitted native-scrypt experiment and delete the untracked probe
  scripts so they are never committed.
- 2026-11-01 (user): "make sure it is hardened the script for the auth totally
  hardened and enterprise level".

## Skills read

- `auth-implementation-patterns` (`/home/asys/.agents/skills/auth-implementation-patterns`
  + `resources/implementation-playbook.md`): session/cookie/password/rate-limit
  baseline, "rate limit auth endpoints", "secure cookies", "never store plain
  passwords", "log security events".
- Gap recorded: AGENTS §7 names `better-auth-best-practices` and
  `frontend-security-coder`; neither is installed under `/home/asys/.agents/skills`
  (verified — only `auth-implementation-patterns`, `backend-security-coder`,
  `clerk-auth` match "auth"). Substitute: `auth-implementation-patterns` plus
  direct inspection of the installed `better-auth@1.4.9` option types and runtime
  source.

## Existing code inspected (concrete)

- `src/lib/auth.ts:1-55` — betterAuth config: baseURL, secret, database pool,
  trustedOrigins, `emailAndPassword: { enabled: true }`, onboarding hook, Google
  social, `advanced.useSecureCookies`. No rate limit, session, or password-policy
  config.
- `src/server/auth-database.ts:1-129` — `createAuthPool` / `withAuthConnection`
  (the committed 1101 fix). Opens one connection per auth request and closes it.
- `src/server/security-stepup.ts:45-79` — `callAuthEndpoint` wraps
  `auth.handler` in `withAuthConnection`; `getAuthSessionFromRequest` is the
  session read used by every authenticated server path.
- `src/routes/api/auth/$.ts`, `src/routes/api/auth/$first/$second.ts` — the two
  catch-all auth handlers, both wrapped.
- `src/env.ts:1-63` — `BETTER_AUTH_SECRET: z.string().min(1)` (weak).
- `node_modules/better-auth/dist/api/rate-limiter/index.mjs:89-156` — default
  special rule: `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*`
  are limited to **3 per 10 s**; general default 100 per 10 s; storage memory by
  default; `enabled` defaults to production.
- `node_modules/better-auth/dist/utils/get-request-ip.mjs:6-19` — `getIp` reads
  the **first** comma-separated entry of `x-forwarded-for` (default header list
  is `["x-forwarded-for"]` only; no `cf-connecting-ip`). A proxy that *appends*
  to a client-supplied XFF therefore lets the client choose the rate-limit key.
- `node_modules/better-auth/dist/cookies/index.mjs:16-38` — default cookie
  attributes are already `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, with
  the `__Secure-` prefix when the base URL is https. Confirmed secure; no change
  needed.
- `@better-auth/core` `index-Zbo6xPkd.d.mts` — option types: `emailAndPassword`
  (`minPasswordLength` default 8, `maxPasswordLength` default 128,
  `revokeSessionsOnPasswordReset` default false), `rateLimit` (`enabled`,
  `window`, `max`, `customRules`, `storage`), `advanced.ipAddress.ipAddressHeaders`,
  `logger` (`level`, `log`).
- `.env` — `BETTER_AUTH_SECRET` is 32 chars (so a `min(32)` guard passes).

## Files likely to change or be added

- `src/server/auth-database.ts` — add an explicit pool mode for Node.
- `src/server/auth-database.test.ts` — pin both modes.
- `src/lib/auth.ts` — revert native scrypt; add password policy, rate limit,
  IP-header trust boundary, redacting logger.
- `src/server/auth-logger.ts` (new) + `src/server/auth-logger.test.ts` (new) —
  PII-redacting logger.
- `src/env.ts` — require a 32+ character `BETTER_AUTH_SECRET`.
- `deploy/velure.service`, `deploy/velure.env.example`,
  `deploy/nginx-velure.conf`, `deploy/README.md` (new).
- `docs/DECISIONS.md` — decision entry.
- Delete `src/server/password.ts`, `src/server/password.test.ts` (experiment).
- Delete untracked `.pgprobe.mjs`, `.scryptbench.mjs`, `.fixture.mjs`.

Not touched: Cloudflare build/deploy scripts, `withAuthConnection` default
behaviour, money paths, numbering, tenancy, Supabase schema.

## Implementation requirements

1. `AUTH_DB_MODE=pool` selects a real `pg.Pool` (Node/VPS). Any other value keeps
   the invocation-scoped client (Cloudflare-safe default). The pooled path must
   never end a client inside `withAuthConnection` — the pool owns the lifecycle.
2. Rate limiting stays at least as strict as the built-in 3-per-10 s on
   sign-in/sign-up, and adds limits to password-reset endpoints (currently
   uncapped at 100/10 s).
3. Only `x-forwarded-for` is trusted for the client IP; nginx must **replace**
   that header (`$remote_addr`), never append.
4. Password policy: minimum 12 characters, maximum pinned at 128 (bounds scrypt
   cost). Existing credentials are unaffected (length checks apply to new
   passwords only).
5. Auth logs must not contain email addresses.
6. The systemd unit and nginx block follow least privilege: non-root service
   user, root-only env file (`0600`), systemd sandboxing, TLS 1.2+ with HSTS.
7. No secrets in any committed file; the env template uses placeholders only.

## Acceptance criteria

- [x] `AUTH_DB_MODE=pool` verified: a pooled auth request no longer opens a new
      Postgres connection per request. On the local Node build with
      `AUTH_DB_MODE=pool`, 10 authenticated `get-session` calls took 0.39-0.70 s
      each and sign-in ~0.71 s, down from 1.0-2.4 s and 1.6-2.0 s with the
      invocation strategy against the same Supabase pooler.
- [x] `AUTH_DB_MODE` unset/other: existing Worker-safe behaviour unchanged. The
      two new `authDbMode` tests pin the default and fail-safe on an
      unrecognised value; the pre-existing 8 `auth-database` tests still pass.
- [x] `src/server/auth-logger.test.ts` proves emails are redacted (message,
      nested object, `Error`) and levels map to console methods.
- [x] `src/env.ts` rejects a `BETTER_AUTH_SECRET` shorter than 32 chars.
- [x] `deploy/` contains a valid systemd unit, env template, and nginx block;
      `systemd-analyze verify deploy/velure.service` exits 0.
- [x] Native scrypt experiment (`src/server/password.ts` +
      `src/server/password.test.ts`) and probe scripts (`.pgprobe.mjs`,
      `.scryptbench.mjs`, `.fixture.mjs`) removed from the working tree.
- [x] `pnpm test` 880 passed / 86 skipped; `pnpm typecheck` clean; `pnpm check`
      exit 0 (359 pre-existing warnings, none new).
- [x] `deploy/velure.env.example` contains placeholders only; no real secret is
      committed.

## Checks to run

- `pnpm test`, `pnpm typecheck`, `pnpm check` — all run, results above.
- `systemd-analyze verify deploy/velure.service` — run, exit 0.
- `nginx -t` — **not run**: nginx is not installed in this environment. The
  provided block is reviewed by hand and every directive is standard nginx. Run
  `sudo nginx -t` on the VPS before `systemctl reload nginx` (documented in
  `deploy/README.md` step 6).
- Local Node server: sign-in + an authenticated request, timing before/after the
  pool mode change — run, figures above.

## Scope changes (append-only)

- 2026-11-01: created.
