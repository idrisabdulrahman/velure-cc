#!/usr/bin/env bash
# Velure OIDC issuer — one-command deploy to the always-on VM.
# Run from this machine (the checkout), NOT on the VM.
#
#   ./deploy-to-vm.sh <user@host> \
#       --issuer-url https://velure-auth.duckdns.org \
#       --db-url 'postgresql://better_auth.kbexydkmmfabfutgkbxn:...@aws-0-eu-central-1.pooler.supabase.com:5432/postgres' \
#       --secret '<BETTER_AUTH_SECRET — must be the current one>' \
#       --client-secret '<CLIENT_SECRET — must match the Supabase provider>' \
#       [--client-id velure-supabase-client] \
#       [--redirect-uris https://kbexydkmmfabfutgkbxn.supabase.co/auth/v1/callback] \
#       [--duckdns-token TOKEN --duckdns-domain velure-auth] \
#       [--resend-api-key ... --resend-from ...]
#
# Prereqs (done once, in the Oracle Cloud console / duckdns.org):
#   1. Always Free VM (Ampere A1 ARM, Ubuntu 24.04 or Oracle Linux 9).
#   2. Security List ingress: allow TCP 80 and 443 from 0.0.0.0/0.
#   3. Your SSH key added to the VM (we use the agent / default key).
#   4. A free DuckDNS subdomain + token (optional but recommended — gives
#      HTTPS via Let's Encrypt without owning a domain).
set -euo pipefail

HOST="${1:?usage: deploy-to-vm.sh <user@host> [flags...]}"
shift

ISSUER_URL="" DB_URL="" SECRET="" CLIENT_SECRET="" CLIENT_ID="velure-supabase-client"
REDIRECT_URIS="https://kbexydkmmfabfutgkbxn.supabase.co/auth/v1/callback"
DUCKDNS_TOKEN="" DUCKDNS_DOMAIN="" RESEND_API_KEY="" RESEND_FROM=""
while [ $# -gt 0 ]; do
	case "$1" in
	--issuer-url) ISSUER_URL="${2:?}"; shift 2 ;;
	--db-url) DB_URL="${2:?}"; shift 2 ;;
	--secret) SECRET="${2:?}"; shift 2 ;;
	--client-secret) CLIENT_SECRET="${2:?}"; shift 2 ;;
	--client-id) CLIENT_ID="${2:?}"; shift 2 ;;
	--redirect-uris) REDIRECT_URIS="${2:?}"; shift 2 ;;
	--duckdns-token) DUCKDNS_TOKEN="${2:?}"; shift 2 ;;
	--duckdns-domain) DUCKDNS_DOMAIN="${2:?}"; shift 2 ;;
	--resend-api-key) RESEND_API_KEY="${2:?}"; shift 2 ;;
	--resend-from) RESEND_FROM="${2:?}"; shift 2 ;;
	*) echo "unknown arg: $1" >&2; exit 1 ;;
	esac
done
: "${ISSUER_URL:?--issuer-url required}"
: "${DB_URL:?--db-url required}"
: "${SECRET:?--secret required (must be the current BETTER_AUTH_SECRET)}"
: "${CLIENT_SECRET:?--client-secret required (must match the Supabase provider)}"

PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> target: $HOST"
echo "==> issuer url: $ISSUER_URL"

# 1. push the deploy payload
echo "==> pushing payload"
rsync -az --delete -e ssh \
	--exclude 'deploy-to-vm.sh' \
	"$PAYLOAD_DIR"/ "$HOST":/tmp/velure-issuer-deploy/

# 2. write the env file on the host
echo "==> writing /etc/velure-issuer.env"
ssh "$HOST" "cat > /tmp/velure-issuer.env" <<EOF
ISSUER_URL=$ISSUER_URL
DATABASE_URL=$DB_URL
BETTER_AUTH_SECRET=$SECRET
PORT=8788
CLIENT_ID=$CLIENT_ID
CLIENT_SECRET=$CLIENT_SECRET
REDIRECT_URIS=$REDIRECT_URIS
${RESEND_API_KEY:+RESEND_API_KEY=$RESEND_API_KEY
}${RESEND_FROM:+RESEND_FROM=$RESEND_FROM}
EOF

# 3. run the bootstrap
echo "==> running setup-vm.sh on the host (this takes a few minutes)"
DUCKDNS_ARGS=""
[ -n "$DUCKDNS_TOKEN" ] && DUCKDNS_ARGS="$DUCKDNS_ARGS --duckdns-token $DUCKDNS_TOKEN"
[ -n "$DUCKDNS_DOMAIN" ] && DUCKDNS_ARGS="$DUCKDNS_ARGS --duckdns-domain $DUCKDNS_DOMAIN"
ssh -t "$HOST" "sudo bash /tmp/velure-issuer-deploy/setup-vm.sh /tmp/velure-issuer.env $DUCKDNS_ARGS"

# 4. verify from here
echo "==> verifying discovery from this machine"
for i in $(seq 1 10); do
	R="$(curl -fsS -o /dev/null -w '%{http_code}' "$ISSUER_URL/.well-known/openid-configuration" 2>/dev/null || true)"
	[ "$R" = "200" ] && break
	sleep 5
done
echo "discovery: ${R:-timeout}"
if [ "$R" = "200" ]; then
	curl -fsS "$ISSUER_URL/.well-known/openid-configuration" | grep -o '"issuer":"[^"]*"'
	curl -fsS "$ISSUER_URL/jwks" | head -c 120; echo
	echo
	echo "==> DEPLOYED. Next: register + re-run the tenancy suite against this URL:"
	echo "  node scripts/bridge-proof/register-production-provider.mjs  (ISSUER_URL=$ISSUER_URL)"
	echo "  ISSUER_URL=$ISSUER_URL CLIENT_SECRET=<same> node scripts/bridge-proof/a9-live-tenancy.mjs"
else
	echo "==> discovery not reachable from here. Check OCI Security List 80/443 and DNS." >&2
	exit 1
fi
