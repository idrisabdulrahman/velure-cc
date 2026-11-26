#!/usr/bin/env bash
# End-to-end proof of the Bachs money path against a disposable Postgres.
#
# The live Bachs sandbox is externally blocked (the connected account has no
# dashboard product yet), so this runs the REAL function bodies from the
# migrations against a throwaway Postgres and asserts the lifecycle:
#   success -> paid, replay -> duplicate, failed -> retryable,
#   expired -> still settleable by a late success, manual review never credits,
#   wrong account cannot match, settled money is never downgraded.
#
# It needs Docker and the postgres:16-alpine image. It is deliberately not part
# of `pnpm test`; run it when the Bachs SQL changes.
#
# Usage: scripts/bachs-money-path/proof.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="invoicly-bachs-proof-$$"
here="$root/scripts/bachs-money-path"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$container" \
  -e POSTGRES_PASSWORD=postgres postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

# Pull the function definitions straight from the applied migrations so the
# proof can never drift from what ships.
awk '/^create or replace function public.confirm_bachs_payment/{f=1} f{print} f&&/^\$\$;/{exit}' \
  "$root/supabase/migrations/20261125000001_bachs_confirmation_overload_repair.sql" \
  > "$tmp/confirm.sql"
awk '/^create or replace function public.record_bachs_payment_outcome/{f=1} f{print} f&&/^\$\$;/{exit}' \
  "$root/supabase/migrations/20261126000000_bachs_collection_lifecycle.sql" \
  > "$tmp/lifecycle.sql"

cat "$here/bootstrap.sql" "$tmp/confirm.sql" "$tmp/lifecycle.sql" "$here/assertions.sql" \
  | docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"$tmp/out" 2>&1 || {
    cat "$tmp/out"
    echo "Bachs money-path proof FAILED" >&2
    exit 1
  }

if ! grep -q "ALL PASSED" "$tmp/out"; then
  cat "$tmp/out"
  echo "Bachs money-path proof did not reach ALL PASSED" >&2
  exit 1
fi

echo "Bachs money-path proof PASSED ($(grep -c 'PASS:' "$tmp/out") assertions)"