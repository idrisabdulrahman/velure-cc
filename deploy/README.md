# Velure on a VPS (Node + systemd + nginx)

Deploy guide for running Velure as a long-lived Node process under systemd,
reverse-proxied by nginx at `https://velure.variadic.ng` on port 8490.

This is the "option 3" path agreed on 2026-11-01: the app previously ran on
Cloudflare Pages, where sign-in failed with error 1102
(`Worker exceeded CPU time limit.`) because the free/bundled plan allows only
10-50 ms of CPU per request while better-auth's scrypt password verification
costs ~142-237 ms. A VPS has no such per-request CPU cap.

Cloudflare support stays in the repository (`pnpm build:pages`,
`pnpm deploy:pages`, and the Worker-safe connection strategy). Nothing here
removes it; the two modes are selected by `AUTH_DB_MODE`.

## What is in this directory

| File | Purpose |
| --- | --- |
| `velure.service` | systemd unit (hardened, non-root, loopback-only) |
| `velure.env.example` | environment template — copy to `/etc/velure/velure.env` |
| `nginx-velure.conf` | reverse proxy + TLS + security headers |

## Requirements

- Node.js 20 or newer on the VPS (`node -v`).
- nginx and certbot.
- systemd 247 or newer (the unit uses `ProtectProc=invisible`).
- The Supabase project reachable from the VPS.

## 1. Build

Build on a machine that has the repository and its `.env` (the `VITE_*` values
are inlined into the client bundle at build time):

```bash
pnpm install --frozen-lockfile
pnpm build            # emits .output/ (preset: node-server)
```

`.output/` is self-contained (no symlinks, no `pnpm install` needed on the
server) and is about 20 MB. Smoke-test it locally first:

```bash
cd .output && HOST=127.0.0.1 PORT=8490 \
  BETTER_AUTH_URL=http://127.0.0.1:8490 SITE_URL=http://127.0.0.1:8490 \
  node --env-file=../.env server/index.mjs
```

> Do **not** deploy `.output` produced by `pnpm build:pages` — that build is for
> Cloudflare and lands in `dist/`.

## 2. Create the service account and directories

```bash
sudo useradd --system --home /opt/velure --shell /usr/sbin/nologin velure
sudo install -d -o velure -g velure -m 0755 /opt/velure
sudo install -d -m 0755 /etc/velure
```

If you would rather reuse an existing account, change `User=`/`Group=` in the
unit and make sure it owns `/opt/velure`.

## 3. Upload the build

```bash
sudo rsync -a --delete .output/ velure@YOUR_VPS:/opt/velure/
```

The result is `/opt/velure/server/index.mjs`, `/opt/velure/public/`, and
`/opt/velure/nitro.json`.

## 4. Configure the environment

```bash
sudo cp deploy/velure.env.example /etc/velure/velure.env
sudo chown root:root /etc/velure/velure.env
sudo chmod 600 /etc/velure/velure.env
sudo "${EDITOR:-nano}" /etc/velure/velure.env   # fill in the real values
```

Notes:

- `AUTH_DB_MODE=pool` is what makes the app reuse Postgres connections. Without
  it every authenticated request opens a fresh Supabase connection (~1-2 s) —
  correct, but slow.
- `BETTER_AUTH_SECRET` must be at least 32 characters; the app refuses to boot
  otherwise.
- Generate secrets with `openssl rand -hex 32`.
- Values containing spaces or JSON must be single-quoted (systemd syntax, not
  shell).

## 5. Install and start the service

```bash
sudo cp deploy/velure.service /etc/systemd/system/velure.service
sudo systemd-analyze verify /etc/systemd/system/velure.service
sudo systemctl daemon-reload
sudo systemctl enable --now velure
systemctl status velure
journalctl -u velure -f
```

Confirm it is listening on loopback only:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8490/
ss -ltnp | grep 8490        # should show 127.0.0.1:8490, not 0.0.0.0
```

## 6. nginx and TLS

Point the DNS `A`/`AAAA` record for `velure.variadic.ng` at the VPS, then:

```bash
sudo cp deploy/nginx-velure.conf /etc/nginx/sites-available/velure.variadic.ng
sudo ln -s /etc/nginx/sites-available/velure.variadic.ng /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d velure.variadic.ng
sudo nginx -t && sudo systemctl reload nginx
```

Two proxy directives are security-critical and are explained inline in the
config:

- `proxy_set_header X-Forwarded-For $remote_addr;` — **replace**, never append.
  better-auth reads the first `X-Forwarded-For` entry for rate limiting; if nginx
  appended to a client-supplied value the caller could rotate the header and
  bypass the sign-in limit.
- `proxy_set_header Host $host;` and
  `proxy_set_header X-Forwarded-Proto $scheme;` — the Nitro Node server builds
  the request URL from these. Without them the app sees
  `http://127.0.0.1:8490/api/auth/...` and could set cookies without `Secure`.

## 7. Post-deploy checks

```bash
curl -sS -o /dev/null -w 'root   %{http_code}\n' https://velure.variadic.ng/
curl -sS -o /dev/null -w 'signin %{http_code}\n' -X POST \
  https://velure.variadic.ng/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://velure.variadic.ng' \
  -d '{"email":"YOU@example.com","password":"YOUR-PASSWORD"}'
```

Reliability check — sign-in must succeed repeatedly and quickly, since it no
longer runs into a CPU cap:

```bash
for i in $(seq 1 10); do curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' \
  -X POST https://velure.variadic.ng/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: https://velure.variadic.ng' \
  -d '{"email":"YOU@example.com","password":"YOUR-PASSWORD"}'; done
```

Then, in a browser: sign in, land on `/invoices`, open an invoice, and load a
public invoice share link.

## 8. Scheduler follow-up (do this once)

The reminder/scheduler tick is driven by Supabase `pg_cron` + `pg_net`, which
posts to the app URL stored in Vault. Update that URL to
`https://velure.variadic.ng/api/cron/tick` and make sure the Vault secret matches
`INVOICE_SCHEDULER_SECRET` from `/etc/velure/velure.env`. Automatic reminder
sending is intentionally still off (`SCHEDULER_REMINDER_SEND_ENABLED`) until real
invoices are being issued — do not turn it on as part of a deployment.

## Updating a deployment

```bash
# on the build machine
pnpm build
sudo rsync -a --delete .output/ velure@YOUR_VPS:/opt/velure/
# on the VPS
sudo systemctl restart velure && systemctl status velure
```

`rsync --delete` keeps the directory an exact copy of the build. Keep the
previous `.output` around if you want a fast rollback.

## Hardening notes

The unit already applies systemd sandboxing: non-root user, loopback-only bind,
`NoNewPrivileges`, read-only filesystem (`ProtectSystem=strict`), private
`/tmp` and devices, a system-call allowlist, an empty capability set, and
`UMask=0077`. The environment file is root-owned and mode `0600`, so the service
account never needs to read the secrets.

If the service fails to start with `EPERM` or a "permission denied" syscall
error, relax the two most opinionated lines first —
`SystemCallFilter=@system-service` and `RestrictAddressFamilies` — then report
which one was needed. Do not remove `NoNewPrivileges`, `ProtectSystem=strict`,
or the root-only env file.

`MemoryDenyWriteExecute` must **not** be enabled: V8's JIT needs
writable+executable memory.
