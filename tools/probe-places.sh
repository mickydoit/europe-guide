#!/usr/bin/env bash
# Plan 6 Task 5 precondition: is Places API (New) live on the server key?
#
# Sends exactly what scripts/import/photos.ts sends — same field mask, same pageSize — and
# insists the answer carries `photos`. A 200 with no `photos` array means the mask is not
# enabled for the key, which the import would turn into ~80 "no place found" warnings.
# The key is read from .env and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

QUERY="${1:-Real Alcázar de Sevilla}"
FIELD_MASK='places.id,places.photos.name,places.photos.authorAttributions.displayName'

[ -f .env ] || { echo "probe-places: no .env here" >&2; exit 2; }
KEY=$(grep -m1 '^GOOGLE_SERVER_KEY=' .env | cut -d= -f2- | tr -d '\r"'"'"' ') || true
[ -n "${KEY:-}" ] || { echo "probe-places: GOOGLE_SERVER_KEY is not set in .env" >&2; exit 2; }

BODY=$(printf '{"textQuery":%s,"pageSize":1}' "$(printf '%s' "$QUERY" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')")
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Goog-Api-Key: $KEY" \
  -H "X-Goog-FieldMask: $FIELD_MASK" \
  -d "$BODY" \
  https://places.googleapis.com/v1/places:searchText)

if [ "$CODE" != "200" ]; then
  echo "probe-places: HTTP $CODE for \"$QUERY\" — Places API (New) is not enabled on the server key (or it is restricted)." >&2
  # The error body names the API and the project; it carries no secret.
  sed 's/[[:space:]]\{1,\}/ /g' "$OUT" | head -c 600 >&2; echo >&2
  exit 1
fi
if ! grep -q '"photos"' "$OUT"; then
  echo "probe-places: HTTP 200 but no \"photos\" in the answer for \"$QUERY\" — the field mask is not served for this key." >&2
  head -c 600 "$OUT" >&2; echo >&2
  exit 1
fi
echo "probe-places: OK — 200 with photos for \"$QUERY\"."
