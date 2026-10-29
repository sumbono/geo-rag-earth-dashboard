#!/usr/bin/env bash
# Live health gate: geo.sumbono.dev must behave as ONE stack.
set -euo pipefail
BASE="${GEO_BASE:-https://geo.sumbono.dev}"
USER="${GEO_USER:-demo}"; PASS="${GEO_PASS:-demo-pass-123}"
fail() { echo "FAIL: $*" >&2; exit 1; }

# 1) OpenAPI shape consistent 20/20 (was: alternating 10/11 paths).
# Post-merge default is 11; Task 4 adds /coverage and bumps the default to 12.
EXPECTED="${GEO_EXPECTED_PATHS:-11}"
for i in $(seq 1 20); do
  paths=$(curl -sf "$BASE/api/openapi.json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['paths']))")
  [ "$paths" = "$EXPECTED" ] || fail "openapi paths=$paths (expect $EXPECTED) on request $i"
done

# 2) Login once; session must validate 20/20 (was: 50% 401)
HDR=$(mktemp); curl -sf -D "$HDR" -o /dev/null -X POST "$BASE/api/auth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "username=$USER&password=$PASS"
ACCESS=$(sed -n 's/.*access_token=\([^;]*\).*/\1/p' "$HDR" | tr -d '\r')
[ -n "$ACCESS" ] || fail "no access_token cookie"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: access_token=$ACCESS" "$BASE/api/auth/me")
  [ "$code" = "200" ] || fail "auth/me=$code on request $i"
done

# 3) One functional search + thumb (was: random 401 on thumbs)
JSON=$(curl -sf -H "Cookie: access_token=$ACCESS" -X POST "$BASE/api/search/vector" \
  -H 'Content-Type: application/json' -d '{"query":"turquoise coastal water"}')
ID=$(printf '%s' "$JSON" | python3 -c "import json,sys; r=json.load(sys.stdin)['results']; assert r, 'no results'; print(r[0]['id'])")
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: access_token=$ACCESS" "$BASE/api/thumbs/$ID")
[ "$code" = "200" ] || fail "thumb=$code"

# 4) Polygon route exists (was: 404 on half the requests).
# Body field is `polygon` (PolygonSearchRequest, search.py:178-185) — not `ring`/`query`.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/search/polygon" \
  -H 'Content-Type: application/json' -d '{"polygon":[[38,21],[38.1,21],[38.1,21.1],[38,21]]}')
[ "$code" != "404" ] || fail "polygon route 404 — old stack still serving"

echo "OK: single healthy stack"
