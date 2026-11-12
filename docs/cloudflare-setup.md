# Velure on Cloudflare Workers (free plan)

Authoritative hosting procedure. Governing rules live in `AGENTS.md` §10; this
file is the procedure. Product direction, target architecture, and migration
sequencing stay in their own documents.

**Status of this procedure:** Phase 0 (audit) and Phase 1 (Worker build) complete.
Nothing deployed. Phases 2-8 not started. Every phase is gated on the escalation
points in §12.

**Scope:** hosting only. Better Auth stays the identity system; Supabase
Postgres stays the database. Nothing here changes either choice.

---

## 1. Non-negotiables

1. Total cost stays **$0**. No plan upgrade, no payment method, no billed
   service. If a step prompts for billing, stop and report.
2. Do not delete or modify the existing Cloudflare Pages project, DNS records,
   or Supabase data without explicit approval. The Pages project stays until
   the Worker is verified, then the user decides.
3. Deploy with `wrangler deploy`. Never `wrangler pages deploy`.
4. Secrets only via `wrangler secret put` or the dashboard. Local values in
   `.dev.vars` (git-ignored). Never print, log, or commit a secret.
5. Prefer the Cloudflare MCP for creating and inspecting resources. Check the
   MCP tool list instead of assuming a capability exists.
6. Read current Cloudflare docs (MCP `docs` tool, or the page's `llms.txt`)
   before writing config. Do not rely on training data for Wrangler or
   Nitro/Vite plugin config shape.

---

## 2. Target architecture

```
Browser
  |
Cloudflare Worker  (TanStack Start SSR + server functions + static assets)
  |-- Better Auth          (inside the Worker; password hashing offloaded to a
  |                         Durable Object, see §6.3)
  |-- Hyperdrive binding --> Supabase Postgres (pooled)
  |-- R2 binding ----------> invoice PDFs, logos, attachments (private bucket)
  |-- AI binding (optional) -> Workers AI, only for an approved feature
```

Not used: D1, KV. Supabase Postgres is the system of record.

---

## 3. Free-tier budget (verified 2026-11-02)

| Resource | Free limit | Consequence for Velure |
|---|---|---|
| Worker requests | 100,000/day | Static asset requests are free and do not count. SSR, server functions, and API routes do. |
| Worker **CPU** | **10 ms per invocation** | The binding constraint. Waiting on DB/network does not count; JS execution does. |
| Durable Object CPU | **30 s per request**, objects available on the free plan | The only $0 escape from the 10 ms cap. 100,000 requests/day, 13,000 GB-s/day duration. |
| Subrequests | **50 external**, 1,000 to Cloudflare services | Each `supabase-js` call is one external subrequest. |
| Worker memory | 128 MB | Do not buffer whole files or build large documents in memory. |
| Worker script size | **64 MiB uncompressed** | The old 3 MB compressed limit was removed in Sept 2026. Measured bundle: 13.36 MB raw / 2.53 MB gzip. Not a constraint. |
| Hyperdrive queries | 100,000/day | Every statement counts, cached or not, including `BEGIN`/`COMMIT`. |
| R2 | 10 GB-month, 1M Class A, 10M Class B, free egress | Ample for invoice PDFs. |
| Workers AI | 10,000 Neurons/day, shared across models | Hard-fails when exhausted; does not bill. |

**Failure mode vs billing:** Workers, Hyperdrive, Durable Objects, and Workers
AI hard-fail on the free plan. **R2 is the one service that can bill** if a
payment method is on file and the free tier is exceeded. Keep a usage
notification configured.

---

## 4. Build toolchain: Nitro, not the Vite plugin

Velure builds through **Nitro** (`nitro/vite` in `vite.config.ts`), not
`@cloudflare/vite-plugin`. Nitro's own documentation
(`node_modules/nitro/dist/docs/1.deploy/2.providers/5.cloudflare.md`) names
**`cloudflare_module`** as the Workers preset and explicitly recommends it over
`cloudflare_pages`.

Preset selection is the repository's existing mechanism: the `NITRO_PRESET`
environment variable, read by Nitro at build time.

```bash
pnpm build:worker   # NITRO_PRESET=cloudflare_module vite build
pnpm deploy:worker  # build:worker && wrangler deploy
```

| Artifact | Preset | Directory |
|---|---|---|
| Worker | `cloudflare_module` | `dist-worker/` |
| Pages (legacy/rollback) | `cloudflare_pages` | `dist/` |
| Node / VPS | `node-server` | `.output/` |

Nitro's `cloudflare_module` preset inherits the default `.output` directory,
which the Node build also uses; `vite.config.ts` overrides it to `dist-worker/`
so the two can never overwrite each other.

**Do not hardcode `main`.** Nitro generates
`dist-worker/server/wrangler.json` with `main: index.mjs`,
`assets: { binding: ASSETS, directory: ../public }`, `no_bundle: true`, and
ESModule rules, and writes `.wrangler/deploy/config.json` so `wrangler deploy`
run from the repo root finds it. Declaring `main` or `assets` in
`wrangler.jsonc` is overridden and warned about.

`wrangler.jsonc` is the single source of truth for `name`, compatibility date,
observability, and bindings. Nitro merges it into the generated config (its own
overrides win) and prints a warning for any key it ignores. Run `wrangler types`
after every binding change.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "velure",
  "compatibility_date": "2026-11-02",
  "observability": { "enabled": true }
}
```

Compatibility date: use the current date, never copy an example's. For dates
`2026-08-04` and later, Workers enables `nodejs_compat` by default, so
`compatibility_flags` should stay empty. Minimum for Workers + static assets is
`2024-09-19`.

**Verified Phase 1 baseline (2026-11-02):** build succeeds; `wrangler deploy
--dry-run` reports 311 modules, 12,995.71 KiB uncompressed / 2,528.96 KiB gzip,
231 asset files, with only `env.ASSETS` bound.

**Static assets** are served before the Worker by default. Any route that needs
an auth check before an asset needs `assets.run_worker_first`.

---

## 5. Phase 2 — database: Hyperdrive over Supavisor session mode

### 5.1 Connection string

The direct host `db.<project-ref>.supabase.co` is **IPv6-only** for this project
(verified: AAAA `2a05:d014:415:501::dbd6`, no A record). Use the Supavisor
**session-mode** pooled string (port **5432** on the pooler host), never
transaction mode (6543) and never the direct host, because Hyperdrive does its
own pooling.

Record the config `id` in `wrangler.jsonc`. Set **caching disabled** — auth and
invoice reads must never be served stale.

Migrations run **directly against Supabase from a local machine or CI**, never
through the Worker or Hyperdrive. This keeps schema statements out of the
100,000/day query budget.

### 5.2 Per-request connection objects

Never hold a socket in a module-level singleton. Velure already satisfies this
in a measured, deliberate way — do not "fix" it:

- `src/server/auth-database.ts` keeps connections **invocation-scoped**, opened
  lazily and closed when the request finishes (`withAuthConnection`).
- It exists because a module-scope `pg.Pool` produced intermittent
  Cloudflare **error 1101** on sign-in (roughly every second request). See
  `docs/DECISIONS.md`, 2026-10-31.
- A naive per-request `new Pool()` regresses sign-in to 4-8 s because every
  query pays a fresh connection.

The only change Phase 2 needs here is the **source** of the connection string.
`AUTH_DB_MODE` must be `invocation` on Workers (the default) and `pool` on a
Node/VPS host. Both modes stay in the repository.

### 5.3 Rate limiting

`src/lib/auth.ts` pins explicit per-endpoint budgets, but Better Auth's default
store is a **module-level `Map` per isolate**
(`better-auth/dist/context/create-context.mjs:137`), so on Workers the limits do
not hold across isolates and cannot gate a login flood.

`src/server/rate-limit-store.ts` is the replacement, wired into
`rateLimit.customStorage`. It has four properties that matter:

1. **Credentialed paths only.** Session reads (`get-session`) keep the in-isolate
   map, so no page load gains a query. `SHARED_RATE_LIMIT_PATHS` is the single
   source of truth for which paths reach the database.
2. **The reservation is one atomic statement.** Better Auth's limiter reads
   (`get`) then writes (`set`); implemented as two statements, concurrent
   requests all read the same stale count and every one is allowed. So `get`
   performs the whole increment-or-reset in a single
   `insert ... on conflict ... do update ... returning`, and `set` is a no-op.
   Verified against real Postgres: ten concurrent connections produced counts
   `0..9` exactly once each, final count `9`.
3. **The reset window matches the rule.** A `case` in the same statement resets
   the count when `lastRequest` fell outside the window, using the same window
   Better Auth enforces (`SHARED_RATE_LIMIT_PATHS`, `/forget-password` = one
   hour).
4. **Degrade, never fail open to "no limit".** A store error is logged once and
   the request falls back to the in-isolate map for that read — exactly Better
   Auth's default store. So a database blip weakens the *shared* guarantee but
   never removes the limit, and can never lock every user out. Residual risk:
   while the database is unavailable the limit is per isolate again.

The key is stored as a salted HMAC-SHA256 of `ip + path`, never the raw address,
so the table is not an IP log. The table is `better_auth."rateLimit"`
(`supabase/migrations/20261107000000_better_auth_rate_limit.sql`), server-only
and role-revoked like the other `better_auth` tables.

#### 5.3.1 The client-address header decides whether the limit exists

This is the first defect found in production, and it fails **open and silently**.
Better Auth's limiter starts with:

```js
const ip = getIp(req, ctx.options);
if (!ip) return;            // no address -> no limit, no log, no error
```

`getIp` reads only the headers listed in `advanced.ipAddress.ipAddressHeaders`
and defaults to `["x-forwarded-for"]`. Cloudflare does **not** send
`x-forwarded-for` for a direct `workers.dev` request, so on the first deployment
the limiter returned immediately on every request: six rapid failed sign-ins all
returned 401, and `better_auth."rateLimit"` stayed empty.

The config therefore selects the header by runtime
(`src/server/auth-runtime.ts`, tested in `auth-runtime.test.ts`):

| Host | Trusted header | Why |
| --- | --- | --- |
| Workers | `cf-connecting-ip` | The edge sets it and strips any client copy, so it cannot be forged. There is no `x-forwarded-for`. |
| Node (VPS) | `x-forwarded-for` | nginx must REPLACE it (`proxy_set_header X-Forwarded-For $remote_addr`). Trusting `cf-connecting-ip` here would be spoofable, because nothing in front of the process validates it. |

Verification after the fix, on `https://velure.noicepikachu.workers.dev`: three
failed sign-ins returned 401 and the fourth returned 429 with
`{"message":"Too many requests. Please try again later."}`, and the table held
exactly one row with `count = 4` whose `key` is a 64-character hex digest.

Any future change to the proxy or the route must re-run that check. A CDN or
proxy that hides the address, or a config that trusts a header the client can
set, silently removes brute-force protection.

---

## 6. Phase 2 — auth CPU budget (the hardest limit)


### 6.1 The measured problem

| Measurement | Value | Source |
|---|---|---|
| Free-plan CPU per invocation | 10 ms | Cloudflare docs |
| `get-session` with a real cookie | 15-20 ms | `docs/DECISIONS.md`, 2026-11-01 |
| `POST /api/auth/sign-in/email` | **131-146 ms** | same |
| Native `node:crypto` scrypt replacement | ~142 ms, 9/15 successes | same (tested and reverted) |

Better Auth hashes passwords with scrypt at `N=16384, r=16, p=1, dkLen=64`.
The credential format `${salt}:${keyHex}` fixes those parameters, so the cost is
irreducible without changing every stored hash. This is why the VPS exists
(`deploy/README.md`).

Note that even a plain session lookup sits at 15-20 ms. Isolates tolerate
occasional overruns, which is why the live site works, but there is no headroom.

### 6.2 Version upgrade does not solve it

Better Auth `1.7.x` moves hashing to `@better-auth/utils/password`, which uses
the `node` export condition: native `node:crypto` scrypt where available,
`@noble/hashes` pure-JS otherwise. The **scrypt parameters are unchanged**, so
stored hashes stay valid. The upgrade (1.4.9 -> 1.7.15) is still worth taking —
it drops the pure-JS path and picks up security fixes — but per §6.1 the native
path was already measured at ~142 ms and is not sufficient on its own.

All configuration Velure relies on exists in 1.7.15 (`emailAndPassword`,
`minPasswordLength`, `maxPasswordLength`, `revokeSessionsOnPasswordReset`,
`rateLimit.customRules`, `advanced.ipAddressHeaders`, `advanced.useSecureCookies`,
`trustedOrigins`, `databaseHooks`, and the `emailAndPassword.password.hash` /
`.verify` overrides).

**Upgrade status: attempted 2026-11-02, reverted.** It typechecks after one
call-site fix, but two things must be resolved first and neither is a
config change:

- The OIDC provider left `better-auth/plugins`: `oidcProvider` is now
  `oauthProvider` in `@better-auth/oauth-provider`, and `useJWTPlugin` is gone.
  Porting the bridge harness took it from green to 11/16 failing.
- `get-session` without a cookie starts opening a database connection, where
  1.4.9 issued none. If that is a real per-request query it changes the
  Hyperdrive budget on every page load, so measure it before shipping.

Details and acceptance criteria: `prompts/cloudflare-workers-migration.md`.

### 6.3 The chosen fix: offload hashing to a Durable Object

A Durable Object gets **30 seconds of CPU per incoming request** and is
available on the free plan. Route only `password.hash` and `password.verify`
through a DO:

- `emailAndPassword.password.hash` / `.verify` are overridable in both 1.4.9 and
  1.7.15 (`options.emailAndPassword?.password?.hash || hashPassword`).
- The DO is stateless; it uses no storage, so it accrues no storage cost and
  needs no hibernation strategy.
- New DO namespaces **must** use the SQLite backend: declare the class under
  `migrations: [{ tag, new_sqlite_classes: [...] }]`. KV-backed namespaces can
  no longer be created. The hasher still stores nothing.
- **Fallback required:** when the binding is absent (plain `vite dev` on Node,
  the VPS build, unit tests), hash in-process exactly as today. Detect the
  binding, do not add a second mode switch.
- Sharding: one object per sign-in would serialize all logins. Shard by a hash
  of the identifier across a small fixed set of instances.
- **Rate limiting is a prerequisite, not a follow-up.** A login flood spends one
  DO request per attempt from the same 100,000/day allowance, and in-memory
  limits do not hold across isolates (§5.3). Exhausting it stops sign-in for
  everyone. Gate the hash behind a cross-isolate limit.

#### Password-hash contract — reproduce exactly

Proven against 1.4.9's own implementation (25/25 cases). Any omission breaks
existing credentials:

1. Salt: 16 random bytes, hex-encoded to 32 chars, and that **hex string is the
   salt input to scrypt** — do not decode it to bytes.
2. Input: `password.normalize("NFKC")` (NFKC, not NFC).
3. `N=16384, r=16, p=1, dkLen=64`, `maxmem=128*N*r*2`.
4. Format: `${hexSalt32}:${hexKey128}`.
5. Verify compares the hex-decoded key in **constant time**.
6. Malformed hash throws.

#### Why the version upgrade is not an alternative

Measured here, Node wall-clock: pure-JS scrypt (1.4.9) **235 ms**, native
`node:crypto` (1.7.x) **160 ms** — a **1.5x** gain against a 10 ms budget that is
already 16-24x overshot. The upgrade is worth taking for its own reasons, but it
cannot make password login fit the free plan.

**Unverified.** The CPU figures above are Node timings, not workerd CPU, and the
DO's GB-s cost is derived. Gates 1-3 in
`prompts/cloudflare-workers-migration.md` must confirm them on the deployed
runtime before this is called done.

### 6.4 Also planned: passwordless

Magic link (Better Auth's `magicLink` plugin; Resend is already integrated) as
an additional sign-in path. This is additive, not a replacement: existing
password credentials must keep working. Resend's free tier allows 100 emails/day.

---

## 7. Phase 4 — R2 for files

There is **no file storage today**: no Supabase Storage bucket, no upload route,
no filesystem writes. Logos are a `logo_url` text column pointing at an external
URL. R2 is greenfield, not a migration.

1. Create a **private** bucket (`velure-files`). No public bucket URL, no
   `r2.dev` access.
2. Access only through the Worker binding behind an authenticated server
   function. Never mint public links.
3. Key convention: `ws/{workspaceId}/invoices/{invoiceId}.pdf`,
   `ws/{workspaceId}/logo/{hash}.png`. Derive `workspaceId` from the verified
   session, never from client input. This is the tenant-isolation boundary.
4. Validate on upload: allowed MIME types (PDF, PNG, JPEG), max size, and magic
   bytes — not just the extension.
5. Serve with `Content-Disposition` and `X-Content-Type-Options: nosniff`.
   Stream; do not buffer (128 MB cap).
6. Writes are Class A (1M/month). Generate a PDF once at issue and keep it. Do
   not regenerate on every view.
7. Enabling R2 may require a payment method even for the free tier. If prompted,
   stop and tell the user.

### PDF generation — resolved (2026-11-12)

The former blocker is closed. `src/server/pdf.ts` now renders a **native vector
PDF with `pdf-lib`** (pure JavaScript, the built-in Helvetica faces, no WASM, no
font files, no filesystem). It is drawn in `src/server/pdf-layout.ts` and mirrors
the customer-facing HTML preview's `print` appearance one-for-one. The
`@react-pdf/renderer` tree (yoga WASM, fontkit, pdfkit, brotli), its Worker
alias/stub, and the hand-rolled plain-text fallback PDF were **deleted**: the
fallback silently substituted a plain-text document, which is exactly the defect
issue #4 reported.

- Cost: one in-process render, no new external calls, ~+0.6 MiB uncompressed in
  the Worker bundle (`pdf-lib` + `pako`) against ~2.6 MiB of removed react-pdf
  chunks.
- CPU (measured in Node, A4, 2-decimal NGN): ~3.3 ms for 1-3 line items, ~4.1 ms
  for 5, ~7.2 ms for 12. Typical invoices sit inside the 10 ms free-plan CPU
  budget; ~20 line items (~11 ms) do not. The follow-up that keeps large invoices
  safe is the one AGENTS §9 already requires: **generate the PDF once at issue
  time and store it in R2**, then serve the stored object.
- No silent substitution: `renderInvoicePdf` throws on failure. The download
  route returns a retryable `503 text/html`; the send path reports the failure
  and keeps the invoice.
- The mock/sandbox fiscalization marker printed only by the old fallback is gone
  because the customer-facing preview does not show it either (parity), and
  AGENTS §9 forbids implying NRS clearance.

Whatever storage is added later must preserve AGENTS §9: an issued invoice's PDF
is generated once at issue and stored; mock/sandbox fiscalization stays labelled
as mock.

---

## 8. Phase 8 — acceptance checklist

Run on `*.workers.dev` before any custom domain is attached.

- [ ] Static assets load; no 404 on client routes after a hard refresh.
- [ ] Sign up, verify, sign in, sign out; session survives reload.
- [ ] 20+ consecutive authenticated requests; none fail intermittently (the
      shared-connection regression check).
- [ ] Sign-in CPU and the heaviest SSR route measured under the limit; no 1102.
- [ ] Durable Object hash/verify: measured CPU per sign-in, measured DO
      duration, no 1102 over 20 attempts.
- [ ] Create, edit, finalize a standard invoice, a credit note, and a pro-forma.
      VAT and NGN totals match the pre-migration app on identical inputs.
- [ ] Upload and download a file via R2; another workspace's key returns 403/404.
- [ ] Count Hyperdrive queries for the top 5 routes; report numbers and implied
      daily capacity.
- [ ] Rate limit triggers on repeated failed logins.
- [ ] No secret in the repo, build output, or client bundle.
- [ ] `wrangler deploy --dry-run` reports the uncompressed bundle size.
- [ ] Rollback confirmed: the previous deployment or the VPS stays intact.

---

## 9. Subrequest ceiling

The 50-external-subrequest cap already shaped the product:
`REMINDER_SWEEP_DEFAULT_BATCH_SIZE` is 8 and the budget is 5 s because a
50-workspace sweep made 49 Supabase calls and dropped the cursor write
(`docs/DECISIONS.md`, 2026-10-30). Keep per-route query counts low, measure
them, and treat this as an architectural ceiling rather than a tuning knob.

---

## 10. Secrets and environment

| Name | Type | Where |
|---|---|---|
| `HYPERDRIVE` | binding | `wrangler.jsonc` |
| `AUTH_HASHER` | DO binding | `wrangler.jsonc` |
| `FILES` | R2 binding | `wrangler.jsonc` |
| `BETTER_AUTH_SECRET` | secret | `wrangler secret put`, >= 32 chars |
| `BETTER_AUTH_URL`, `SITE_URL` | var | `wrangler.jsonc`; change together with `trustedOrigins` and OAuth redirect URIs |
| `DATABASE_URL` | secret | Supavisor session mode; local value in `.dev.vars` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | server only; never in client code or a `VITE_*` var |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | secret | verification, onboarding and invoice email; never in a `VITE_*` var |
| OAuth client ids/secrets | secret | `wrangler secret put` |

`.dev.vars` is **not currently git-ignored** — add it. Do not reuse the
production `BETTER_AUTH_SECRET` locally; rotating it logs every user out.

---

## 11. Security floor on the Worker

- Tenant isolation: scope every query and every R2 key by the workspace id from
  the verified session. A server-side Postgres connection can bypass RLS, so
  enforce in application code **and** keep RLS enabled as defense in depth.
- Headers: HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a
  sensible CSP, `frame-ancestors 'none'`.
- CSRF: keep `trustedOrigins` tight; every state-changing server function
  requires a session.
- Account linking: `socialProviders.google` alone does **not** make Google
  sign-in work for an existing email+password user. Better Auth links implicitly
  only when `trustedProviders` contains the provider or the provider asserts
  `emailVerified` (`better-auth/dist/oauth2/link-account.mjs:21`); otherwise the
  callback returns `error=account_not_linked`. `src/lib/auth.ts` therefore sets
  `account.accountLinking = { enabled: true, trustedProviders: ["google"] }` and
  leaves `allowDifferentEmails` false, so a Google address that differs from the
  existing account creates a separate user instead of attaching to someone
  else's. See `src/server/google-account-linking.test.ts`.
- Email verification: a password account must prove control of its address
  before it can hold a session. `emailAndPassword.requireEmailVerification` is
  `true`, `/sign-up/email` returns no session, `/sign-in/email` answers 403
  "Email not verified" (and re-sends when `sendOnSignIn` is on), and the emailed
  `/api/auth/verify-email?token=` GET verifies then signs the user in
  (`autoSignInAfterVerification`) before redirecting to `/verify-email`. Because
  a session minted before this rule is still a valid cookie, it is also checked
  at two boundaries: `src/server/supabase-session.ts` refuses to mint a Supabase
  JWT for `emailVerified === false`, and the dashboard renders a resend screen
  instead of the shell. Delivery is Resend (`src/server/verification-mailer.ts`);
  `/send-verification-email` is limited to 5 per hour per IP. A completed
  password reset counts as verification (`emailAndPassword.onPasswordReset`),
  because the reset token is itself mailed to the address. Linking a social
  provider into a still-unverified account deletes that account's password
  (`src/server/email-verification-db.ts`), closing the pre-hijacking path where
  a squatter's password would become usable once Google proved the address.
  Pre-existing users were backfilled to `emailVerified = true` immediately
  before this rule shipped; without that, every current password account would
  have been locked out. Tests: `src/server/email-verification.test.ts`,
  `src/server/verification-mailer.test.ts`.
- Zod validation on every server function input.
- No stack traces or SQL in responses.
- Log actor, workspace, resource, action, result, timestamp. Never log secrets.

---

## 12. Escalate — do not decide alone

1. Any step requiring a payment method, plan upgrade, or billing.
2. Sign-in or SSR CPU still over budget after the Durable Object work.
3. The Supabase connection only works pooled (already the case here; confirm
   session mode behaves before Phase 2 is called done).
4. PDF rendering cannot reach acceptable output on Workers free (resolved
   2026-11-12 with `pdf-lib` — see §7; re-open only if typical invoices breach
   the CPU budget).
5. A destructive or irreversible action: deleting the Pages project, rotating a
   secret, touching production data, rewriting git history.
6. The migration phase cannot be verified from evidence.

---

## 13. Corrections to the original briefing

Recorded so the next agent does not re-derive them:

| Briefing claim | Reality in this repo |
|---|---|
| Use `@cloudflare/vite-plugin` with `main: @tanstack/react-start/server-entry` | The build is Nitro; use the `cloudflare_module` preset (§4). |
| Compressed Worker size limit is 3 MB | Removed Sept 2026; now 64 MiB uncompressed. |
| Use the direct Supabase connection through Hyperdrive | The direct host is IPv6-only here; use Supavisor session mode. |
| Build the DB client and auth instance per request | Already done, differently and better; see §5.2. Do not regress it. |
| Fix sign-in CPU with lighter PBKDF2 hashing | Already tested with native scrypt: ~142 ms, 9/15. Use the Durable Object (§6.3). |
| R2 migrates existing uploads | There are none; R2 is greenfield (§7). |
| Module-scope imports are harmless | They are not. `@react-pdf/renderer` -> `@react-pdf/pdfkit` evaluates `new URL("./data/sRGB_IEC61966_2_1.icc", import.meta.url)` while its module initialises, and `import.meta.url` is not a URL in the Workers bundle. Because `src/server/pdf.ts` was imported statically by the invoice routes, that threw during server startup and **every route** returned `500 {"message":"HTTPError"}` - including `/api/auth/ok`. Fixed at the time by loading the renderer lazily inside `renderInvoicePdf` (`getPdfRenderer`), so the failure stayed on the PDF path where `renderFallbackPdf` handled it. (2026-11-12: that whole react-pdf stack was deleted — see §7 — so the lazy loader and fallback no longer exist. The rule stands: any Node-only library reached from a route must be imported lazily.) |

---

## 13.1 What the first live deploy proved

Deployed 2026-11-03 to `https://velure.noicepikachu.workers.dev`
(worker `velure`, hasher `velure-password-hasher`, account
`699cc6ec07aa29df7034163270b23f87`).

- Build and deploy are reproducible: `pnpm build:worker` then `npx wrangler
  deploy` (the `deploy:worker` script fails because `wrangler` is not on the
  PATH inside the pnpm script environment; `npx wrangler deploy` works).
  Startup 9-17 ms, 13,002 KiB upload, 226 assets.
- `process.env` **is** populated from secrets: no
  `nodejs_compat_populate_process_env` flag is needed at compatibility date
  `2026-11-02`, because that flag defaults on from `2025-04-01` and
  `nodejs_compat` itself defaults on from `2026-08-04`.
- `better_auth` access over the Supavisor transaction pooler works from the
  Worker with plain `pg` and no Hyperdrive binding (A guard/idle query path
  confirmed by the sign-in lookup completing in ~500 ms wall).
- The Durable Object hasher is reached through
  `durable_objects.bindings[].script_name` and returns `outcome: ok` for every
  call, with `executionModel: durableObject` in its trace events.


---

## 14. Sources

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers pricing / free plan: https://developers.cloudflare.com/workers/platform/pricing/
- Worker size increase (Sept 2026): https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
- Subrequest limits: https://developers.cloudflare.com/workers/platform/limits/#subrequests
- Durable Objects limits (30 s CPU): https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Objects free tier: https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/
- Hyperdrive pricing: https://developers.cloudflare.com/hyperdrive/platform/pricing/
- Hyperdrive + Supabase: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- node:crypto on Workers: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Nitro Cloudflare presets: `node_modules/nitro/dist/docs/1.deploy/2.providers/5.cloudflare.md`