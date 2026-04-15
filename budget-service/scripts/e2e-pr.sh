#!/usr/bin/env bash
# PR / GHA e2e: curl against running budget-service (LOCAL_AUTH_DISABLE), structured JSON logs per request.
# Requires: curl, jq
set -euo pipefail

BASE="${BUDGET_SERVICE_URL:-http://127.0.0.1:8080}"
SUFFIX="$(date +%s)-$$"
RESP_FILE="$(mktemp)"
trap 'rm -f "$RESP_FILE"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "e2e-pr: jq is required" >&2
  exit 1
fi

_LOG_FIRST=1

log_request() {
  local method="$1"
  local path="$2"
  local status="$3"
  local description="$4"
  if [[ "$_LOG_FIRST" -eq 0 ]]; then
    echo >&2
  fi
  _LOG_FIRST=0
  echo "e2e-pr: ${description}" >&2
  # statusCode is always a JSON string (avoids --argjson failures for 000 or malformed curl output)
  if [[ -s "$RESP_FILE" ]] && jq -e . >/dev/null 2>&1 <"$RESP_FILE"; then
    jq -nc --slurpfile b "$RESP_FILE" \
      --arg m "$method" --arg p "$path" --arg sc "$status" --arg d "$description" \
      '{description:$d, method:$m, path:$p, statusCode:$sc} + (if ($b[0]|type)=="object" and ($b[0]|has("code")) then {code:$b[0].code} else {} end)' >&2
  else
    jq -nc --arg m "$method" --arg p "$path" --arg sc "$status" --arg d "$description" \
      '{description:$d, method:$m, path:$p, statusCode:$sc}' >&2
  fi
}

# Usage: api_req METHOD PATH DATA DESCRIPTION
# Pass DATA as "" for GET/DELETE with no body.
api_req() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local description="$4"
  local status=""
  local curl_rc=0
  set +e
  if [[ -n "$data" ]]; then
    status=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE}${path}")
    curl_rc=$?
  else
    status=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X "$method" "${BASE}${path}")
    curl_rc=$?
  fi
  set -e
  if [[ "$curl_rc" -ne 0 ]] || [[ -z "$status" ]]; then
    status="${status:-000}"
  fi
  log_request "$method" "$path" "$status" "$description"
  echo -n "$status"
}

expect_status() {
  local got="$1"
  local want="$2"
  local ctx="$3"
  if [[ "$got" != "$want" ]]; then
    echo "e2e-pr: $ctx expected HTTP $want got $got body=$(cat "$RESP_FILE")" >&2
    exit 1
  fi
}

expect_json_code() {
  local want_code="$1"
  local want_err="$2"
  local got_code
  got_code=$(jq -r '.code // empty' "$RESP_FILE")
  if [[ "$got_code" != "$want_code" ]]; then
    echo "e2e-pr: expected code $want_code got $got_code body=$(cat "$RESP_FILE")" >&2
    exit 1
  fi
  if [[ -n "$want_err" ]]; then
    local got_err
    got_err=$(jq -r '.error // empty' "$RESP_FILE")
    if [[ "$got_err" != "$want_err" ]]; then
      echo "e2e-pr: expected error $want_err got $got_err body=$(cat "$RESP_FILE")" >&2
      exit 1
    fi
  fi
}

echo "e2e-pr: starting" >&2
st=$(api_req GET /health "" "Liveness: GET /health")
expect_status "$st" 200 "health"

# --- Tier A ---
echo >&2
echo "# --- Tier A ---" >&2
DUP_KEY="e2e-dup-${SUFFIX}"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${DUP_KEY}\"}" \
  "Register product (expect 201)")
expect_status "$st" 201 "first product"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${DUP_KEY}\"}" \
  "Register same product again (expect 409 CONFLICT)")
expect_status "$st" 409 "duplicate product"
expect_json_code "CONFLICT" "productKey already registered"

st=$(api_req POST /api/v1/budgets '{"productKey":"e2e-no-such-product-'"${SUFFIX}"'","items":[{"creditsTotal":"1","costToCreditRatio":"1"}]}' \
  "Create budget with unknown productKey (expect 400)")
expect_status "$st" 400 "unknown product"
expect_json_code "BAD_REQUEST" "productKey is not registered"

SHELL_PK="e2e-shell-${SUFFIX}"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${SHELL_PK}\"}" \
  "Register product for shell-budget flow")
expect_status "$st" 201 "shell product"
st=$(api_req POST /api/v1/budgets "{\"productKey\":\"${SHELL_PK}\",\"items\":[]}" \
  "Create shell budget with empty items[]")
expect_status "$st" 201 "shell budget"
SHELL_BUDGET_ID=$(jq -r .budgetId "$RESP_FILE")
st=$(api_req POST /api/v1/sessions "{\"budgetId\":\"${SHELL_BUDGET_ID}\"}" \
  "Open session on shell budget (expect 402 NO_BUDGET_CAPACITY)")
expect_status "$st" 402 "shell session"
expect_json_code "NO_BUDGET_CAPACITY" "budget has no budget items"

st=$(api_req POST /api/v1/webhooks '{"eventType":"bogus.event","productKey":"x","url":"http://127.0.0.1:9/h"}' \
  "Register webhook with invalid eventType (expect 400)")
expect_status "$st" 400 "webhook event"
expect_json_code "BAD_REQUEST" "eventType must be one of: budget-item.exhausted, budget-item.expired, budget-item.reset, report.created"

st=$(api_req POST /api/v1/webhooks '{"eventType":"report.created","productKey":"e2e-noreg-'"${SUFFIX}"'","url":"http://127.0.0.1:9/h"}' \
  "Register webhook for unregistered productKey (expect 400)")
expect_status "$st" 400 "webhook product"
expect_json_code "BAD_REQUEST" "productKey is not registered"

# --- Main flow ---
echo >&2
echo "# --- Main flow: product, budget, session, PATCH ---" >&2
MAIN_PK="e2e-main-${SUFFIX}"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${MAIN_PK}\"}" \
  "Register main product")
expect_status "$st" 201 "main product"
st=$(api_req POST /api/v1/budgets "{\"productKey\":\"${MAIN_PK}\",\"items\":[{\"creditsTotal\":\"1000.000000\",\"costToCreditRatio\":\"0.666660\"}]}" \
  "Create budget with one item")
expect_status "$st" 201 "main budget"
BUDGET_ID=$(jq -r .budgetId "$RESP_FILE")
st=$(api_req POST /api/v1/sessions "{\"budgetId\":\"${BUDGET_ID}\"}" \
  "Open session")
expect_status "$st" 201 "main session"
SESSION_ID=$(jq -r .sessionId "$RESP_FILE")

st=$(api_req PATCH "/api/v1/sessions/${SESSION_ID}" \
  '{"sessionItems":[{"cost":"1","callRequestId":"dup-a"},{"cost":"1","callRequestId":"dup-a"}]}' \
  "PATCH session: duplicate callRequestId in one body (expect 400)")
expect_status "$st" 400 "dup in body"
expect_json_code "DUPLICATE_CALL_REQUEST_ID" "duplicate callRequestId in sessionItems"

st=$(api_req PATCH "/api/v1/sessions/${SESSION_ID}" \
  '{"sessionItems":[{"cost":"1","callRequestId":"dup-across-req"}]}' \
  "PATCH session: first append with callRequestId dup-across-req")
expect_status "$st" 200 "first patch dup-across"
st=$(api_req PATCH "/api/v1/sessions/${SESSION_ID}" \
  '{"sessionItems":[{"cost":"1","callRequestId":"dup-across-req"}]}' \
  "PATCH session: reuse same callRequestId across requests (expect 400)")
expect_status "$st" 400 "second patch dup-across"
expect_json_code "DUPLICATE_CALL_REQUEST_ID" "callRequestId already used for this session"

st=$(api_req PATCH "/api/v1/sessions/${SESSION_ID}" \
  '{"sessionItems":[{"cost":"2.000000","callRequestId":"e2e-happy-1"}]}' \
  "PATCH session: happy-path spend line")
expect_status "$st" 200 "happy patch"

# --- Webhooks CRUD ---
echo >&2
echo "# --- Webhooks CRUD ---" >&2
st=$(api_req POST /api/v1/webhooks \
  "{\"eventType\":\"report.created\",\"productKey\":\"${MAIN_PK}\",\"url\":\"http://127.0.0.1:9/sink\"}" \
  "Register webhook for report.created")
expect_status "$st" 201 "webhook create"
WEBHOOK_ID=$(jq -r .webhookId "$RESP_FILE")
st=$(api_req GET "/api/v1/webhooks/${WEBHOOK_ID}" "" \
  "Get webhook by id")
expect_status "$st" 200 "webhook get"
st=$(api_req DELETE "/api/v1/webhooks/${WEBHOOK_ID}" "" \
  "Delete webhook (soft)")
expect_status "$st" 204 "webhook delete"
st=$(api_req GET "/api/v1/webhooks/${WEBHOOK_ID}" "" \
  "Get deleted webhook (expect 404)")
expect_status "$st" 404 "webhook get after delete"
expect_json_code "NOT_FOUND" "resource not found"

# --- Tier B ---
echo >&2
echo "# --- Tier B: delete conflicts ---" >&2
DELP_PK="e2e-delprod-${SUFFIX}"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${DELP_PK}\"}" \
  "Register product for delete-product conflict")
expect_status "$st" 201 "delp product"
st=$(api_req POST /api/v1/budgets "{\"productKey\":\"${DELP_PK}\",\"items\":[{\"creditsTotal\":\"10\",\"costToCreditRatio\":\"1\"}]}" \
  "Create budget (active reference to product)")
expect_status "$st" 201 "delp budget"
st=$(api_req DELETE "/api/v1/products/${DELP_PK}" "" \
  "Delete product while budget exists (expect 409)")
expect_status "$st" 409 "delete product with budget"
expect_json_code "CONFLICT" "active budgets reference this product"

DELB_PK="e2e-delbud-${SUFFIX}"
st=$(api_req POST /api/v1/products "{\"productKey\":\"${DELB_PK}\"}" \
  "Register product for delete-budget conflict")
expect_status "$st" 201 "delb product"
st=$(api_req POST /api/v1/budgets "{\"productKey\":\"${DELB_PK}\",\"items\":[{\"creditsTotal\":\"10\",\"costToCreditRatio\":\"1\"}]}" \
  "Create budget for open-session delete test")
expect_status "$st" 201 "delb budget"
DELB_BUDGET_ID=$(jq -r .budgetId "$RESP_FILE")
st=$(api_req POST /api/v1/sessions "{\"budgetId\":\"${DELB_BUDGET_ID}\"}" \
  "Open session (unreconciled)")
expect_status "$st" 201 "delb session"
st=$(api_req DELETE "/api/v1/budgets/${DELB_BUDGET_ID}" "" \
  "Delete budget while session open (expect 409)")
expect_status "$st" 409 "delete budget with open session"
expect_json_code "CONFLICT" "budget has unreconciled sessions"

echo >&2
echo "e2e-pr: OK" >&2
