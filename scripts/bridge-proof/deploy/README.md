# Velure issuer — always-on deploy package

Moves the A9 production issuer from the local ngrok tunnel (uptime = this
machine's uptime) to a free always-on host: **Oracle Cloud Always Free
(Ampere A1 ARM VM)** + **Caddy** (automatic Let's Encrypt HTTPS) +
**DuckDNS** (free dynamic DNS so the hostname resolves without owning a
domain). The issuer code is unchanged from the ngrok-validated shape; only
the hosting moves.

## The flow (one command at the end)

```
./deploy-to-vm.sh ubuntu@<vm-public-ip> \
    --issuer-url https://velure-auth.duckdns.org \
    --db-url 'postgresql://better_auth.kbexydkmmfabfutgkbxn:<role-pw>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres' \
    --secret '<BETTER_AUTH_SECRET — current one, never change it>' \
    --client-secret '<CLIENT_SECRET — matches the Supabase provider>' \
    --duckdns-token '<duckdns token>' --duckdns-domain velure-auth
```

Then, once discovery answers 200 from the public URL:

```
# register the provider at the new URL (idempotent; verifies discovery first)
ISSUER_URL=https://velure-auth.duckdns.org \
SUPABASE_SERVICE_KEY=<...> node ../register-production-provider.mjs

# re-run the tenancy suite against the real always-on issuer
ISSUER_URL=https://velure-auth.duckdns.org \
CLIENT_SECRET=<same> \
SUPABASE_ANON_KEY=<...> SUPABASE_SERVICE_KEY=<...> SUPABASE_MANAGEMENT_TOKEN=<...> \
node ../a9-live-tenancy.mjs
```

After the suite is green, tear down the local tunnel + issuer (the local
process on port 8788 and the ngrok agent on this machine).

## One-time console steps (cannot be scripted without OCI API creds)

1. **Oracle Cloud** — sign up (free; card for verification, never charged),
   create a **Compute → Instance**: shape **Ampere A1 (ARM)**, always-free
   eligible, image **Ubuntu 24.04** (or Oracle Linux 9), add your SSH public
   key. Takes ~10–15 min to provision.
2. **Security List** — on the instance's VCN subnet, add two **Ingress**
   rules: TCP **80** and **443** from `0.0.0.0/0` (Caddy needs 80 for
   HTTP-01; 443 serves the issuer). This is the step people forget — the OS
   firewall is handled by the script.
3. **DuckDNS** — sign in at https://duckdns.org (free, OAuth), create one
   subdomain e.g. `velure-auth.duckdns.org`, copy its token. The setup
   script points it at the VM's public IP and keeps it fresh via cron.

## What the script does (setup-vm.sh, on the VM)

- Detects OS (Ubuntu/Debian vs Oracle/RHEL-family) and arch (arm64 for
  Ampere A1) and installs **Node 22 LTS** (official tarball to `/opt/node`).
- Installs **Caddy** (official static binary, `/opt/caddy`, with
  `CAP_NET_BIND_SERVICE`) and writes `/etc/caddy/Caddyfile` from the
  `ISSUER_URL` hostname — automatic Let's Encrypt on first request.
- Creates the `velure` service user, copies the issuer +
  `package.json`, runs `npm install` (**only `better-auth@1.4.9` + `pg`** —
  `kysely` comes in as better-auth's own dependency), installs the env file
  at `/etc/velure-issuer.env` (0600).
- Installs the two systemd units (`velure-issuer.service` — hardened,
  `Restart=always`; `caddy.service`) and enables them.
- Opens 80/443 on the OS firewall; **waits for https discovery to answer
  200** and prints the issuer URL.

## Files

| file | purpose |
|---|---|
| `production-issuer.mjs` | the validated issuer (loginPage + oauthApplication seed) |
| `package.json` | `better-auth@1.4.9` + `pg@^8` only |
| `velure-issuer.service` | hardened systemd unit (user `velure`, restart) |
| `caddy.service` | systemd unit for the static-binary Caddy |
| `Caddyfile` | template — rewritten from `ISSUER_URL` by setup |
| `env.example` | env contract (DATABASE_URL, BETTER_AUTH_SECRET, CLIENT_*) |
| `setup-vm.sh` | the VM bootstrap (run as root on the VM) |
| `deploy-to-vm.sh` | one-command local orchestrator (rsync → env → setup → verify) |

## Operational rules (carried over from the ngrok run)

- **`BETTER_AUTH_SECRET` must never change.** The jwks key in
  `better_auth.jwks` is encrypted with it; changing it breaks id_token
  signing (the exact failure we hit and cleared in the ngrok run).
- **`CLIENT_SECRET` must match the Supabase custom-provider config**
  exactly — GoTrue sends it at the token endpoint and the issuer validates
  it (mismatch = `invalid_client`).
- Only **one** issuer should be registered as `custom:velure` at a time.
  Registering the VM URL replaces the tunnel URL.
