#!/usr/bin/env bash
# Velure OIDC issuer — VM bootstrap. Runs ON the VM as root.
#
#   sudo bash setup-vm.sh /path/to/velure-issuer.env \
#       [--duckdns-token TOKEN --duckdns-domain velure-auth]
#
# Installs Node 22 LTS (official tarball, arch-aware for Ampere A1 ARM),
# Caddy (official static binary, auto-TLS), installs the issuer deps
# (better-auth 1.4.9 + pg only), writes the systemd unit + Caddyfile from the
# ISSUER_URL hostname, opens 80/443 on the OS firewall, and waits for the
# https discovery endpoint. The OCI Security List ingress for 80/443 must be
# opened in the console (that cannot be scripted without API creds).
set -euo pipefail

ENV_FILE="${1:?usage: setup-vm.sh /path/to/env [--duckdns-token T --duckdns-domain D]}"
shift
DUCKDNS_TOKEN=""
DUCKDNS_DOMAIN=""
while [ $# -gt 0 ]; do
	case "$1" in
	--duckdns-token) DUCKDNS_TOKEN="${2:?}"; shift 2 ;;
	--duckdns-domain) DUCKDNS_DOMAIN="${2:?}"; shift 2 ;;
	*) echo "unknown arg: $1" >&2; exit 1 ;;
	esac
done

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
. /etc/os-release
PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> OS: $PRETTY_NAME ($ID)"
case "$ID" in
ubuntu|debian) PM=apt ;;
ol|rhel|rocky|almalinux|centos|fedora) PM=dnf ;;
*) echo "unsupported distro: $ID" >&2; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
x86_64) NODE_ARCH=x64;   CADDY_ARCH=amd64 ;;
aarch64|arm64) NODE_ARCH=arm64; CADDY_ARCH=arm64 ;;
*) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac
echo "==> arch: $ARCH (node=$NODE_ARCH caddy=$CADDY_ARCH)"

# ---- install Node 22 LTS (official tarball; arch-aware) ----
if [ ! -x /opt/node/bin/node ]; then
	echo "==> installing Node 22 LTS to /opt/node"
	"$PM" install -y xz-utils ca-certificates curl >/dev/null 2>&1 || "$PM" install -y xz ca-certificates curl
	NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
	curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
	mkdir -p /opt/node
	tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
	rm -f /tmp/node.tar.xz
fi
/opt/node/bin/node --version

# ---- install Caddy (official static binary; auto-TLS via Let's Encrypt) ----
if [ ! -x /opt/caddy/caddy ]; then
	echo "==> installing Caddy to /opt/caddy"
	curl -fsSL -o /tmp/caddy.tar.gz "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}"
	mkdir -p /opt/caddy
	tar -xzf /tmp/caddy.tar.gz -C /opt/caddy
	rm -f /tmp/caddy.tar.gz
	# allow binding :80/:443 as the unprivileged caddy user
	setcap cap_net_bind_service=+ep /opt/caddy/caddy 2>/dev/null || true
	id -u caddy >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /var/lib/caddy caddy
	mkdir -p /var/lib/caddy /etc/caddy
	chown -R caddy:caddy /var/lib/caddy
fi
/opt/caddy/caddy version

# ---- issuer service user + payload ----
id -u velure >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/velure-issuer velure
mkdir -p /opt/velure-issuer
cp "$PAYLOAD_DIR"/production-issuer.mjs /opt/velure-issuer/
cp "$PAYLOAD_DIR"/package.json /opt/velure-issuer/
chown -R velure:velure /opt/velure-issuer

echo "==> installing issuer deps (better-auth + pg)"
(cd /opt/velure-issuer && /opt/node/bin/npm install --omit=dev --no-audit --no-fund)
chown -R velure:velure /opt/velure-issuer

# ---- env file ----
install -m 600 -o velure -g velure "$ENV_FILE" /etc/velure-issuer.env
# shellcheck disable=SC1091
. /etc/velure-issuer.env
ISSUER_URL="${ISSUER_URL:?ISSUER_URL required in env}"
HOST="$(echo "$ISSUER_URL" | sed -E 's#https?://([^/]+).*#\1#')"
echo "==> issuer host: $HOST"

# ---- DuckDNS (free dynamic DNS so Let's Encrypt can validate) ----
if [ -n "$DUCKDNS_TOKEN" ] && [ -n "$DUCKDNS_DOMAIN" ]; then
	echo "==> pointing $DUCKDNS_DOMAIN.duckdns.org -> this VM's public IP"
	curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}" && echo
	# keep the A record fresh every 5 minutes (VMs can be recreated)
	(crontab -l 2>/dev/null; echo "*/5 * * * * curl -kfsS -o /dev/null 'https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}'") | crontab -
else
	echo "==> no DuckDNS token/domain — ensure $HOST already resolves to this VM's public IP"
fi

# ---- systemd units ----
install -m 644 "$PAYLOAD_DIR"/velure-issuer.service /etc/systemd/system/velure-issuer.service
install -m 644 "$PAYLOAD_DIR"/caddy.service /etc/systemd/system/caddy.service
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	reverse_proxy 127.0.0.1:8788
	encode zstd gzip
}
EOF
systemctl daemon-reload
systemctl enable --now velure-issuer
systemctl enable --now caddy

# ---- OS firewall (OCI Security List ingress for 80/443 is separate) ----
if command -v firewall-cmd >/dev/null 2>&1; then
	firewall-cmd --permanent --add-service=http --add-service=https >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
	ufw allow 80/tcp >/dev/null 2>&1 || true
	ufw allow 443/tcp >/dev/null 2>&1 || true
fi

# ---- wait for https discovery ----
echo "==> waiting for https discovery at $ISSUER_URL/.well-known/openid-configuration"
STATUS=""
for i in $(seq 1 20); do
	STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' "$ISSUER_URL/.well-known/openid-configuration" 2>/dev/null || true)"
	[ "$STATUS" = "200" ] && break
	sleep 5
done
echo "==> discovery status: ${STATUS:-timeout}"
if [ "$STATUS" = "200" ]; then
	curl -fsS "$ISSUER_URL/.well-known/openid-configuration" | grep -o '"issuer":"[^"]*"'
	echo "==> issuer is LIVE at $ISSUER_URL"
else
	echo "==> discovery not reachable yet. Check: OCI Security List allows 80/443," >&2
	echo "    the hostname resolves to the VM public IP, and 'journalctl -u velure-issuer -u caddy -n 50'." >&2
	exit 1
fi
