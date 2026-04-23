#!/usr/bin/env bash
# Local E2E: full Product → session spend → report → webhook flow.
# Requires: jq, curl; Postgres + budget-service running (LOCAL_AUTH_DISABLE=true for open API);
# webhook-sink on WEBHOOK_SINK_URL (default http://127.0.0.1:9999).
set -euo pipefail

BASE="${BUDGET_SERVICE_URL:-http://127.0.0.1:8080}"
SINK="${WEBHOOK_SINK_URL:-http://127.0.0.1:9999}"
# URL the budget server uses to POST webhooks (host-visible sink)
WEBHOOK_TARGET="${WEBHOOK_CALLBACK_URL:-${SINK}/hook}"

if ! command -v jq >/dev/null 2>&1; then
  echo "e2e-local: jq is required" >&2
  exit 1
fi

CURL_AUTH=()
if [[ -n "${BUDGET_E2E_JWT:-}" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer ${BUDGET_E2E_JWT}")
elif [[ -n "${TOKEN:-}" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer ${TOKEN}")
fi

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -f "${CURL_AUTH[@]}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE}${path}"
  else
    curl -sS -f "${CURL_AUTH[@]}" -X "$method" "${BASE}${path}"
  fi
}

echo "e2e-local: health ${BASE}/health"
api GET /health >/dev/null

PRODUCT_KEY="e2e-$(date +%s)-$$"
echo "e2e-local: POST /api/v1/products ${PRODUCT_KEY}"
api POST /api/v1/products "{\"productKey\":\"${PRODUCT_KEY}\"}" >/dev/null

echo "e2e-local: POST /api/v1/budgets"
BUDGET_JSON=$(api POST /api/v1/budgets "{\"productKey\":\"${PRODUCT_KEY}\",\"items\":[{\"creditsTotal\":\"1000.000000\",\"costToCreditRatio\":\"0.666660\"}]}")
BUDGET_ID=$(echo "$BUDGET_JSON" | jq -r .budgetId)
echo "e2e-local: budgetId=${BUDGET_ID}"

echo "e2e-local: POST /api/v1/sessions"
SESS_JSON=$(api POST "/api/v1/sessions" "{\"budgetId\":\"${BUDGET_ID}\"}")
SESSION_ID=$(echo "$SESS_JSON" | jq -r .sessionId)
echo "e2e-local: sessionId=${SESSION_ID}"

echo "e2e-local: PATCH session (GoCode spend)"
api PATCH "/api/v1/sessions/${SESSION_ID}" \
  '{"sessionItems":[{"cost":"2.000000","callRequestId":"e2e-gocode-1"}]}' >/dev/null

echo "e2e-local: POST /api/v1/webhooks -> ${WEBHOOK_TARGET}"
WH_JSON=$(api POST /api/v1/webhooks "{\"eventType\":\"report.created\",\"productKey\":\"${PRODUCT_KEY}\",\"url\":\"${WEBHOOK_TARGET}\"}")
echo "$WH_JSON" | jq .

echo "e2e-local: POST report"
REP_JSON=$(api POST "/api/v1/sessions/${SESSION_ID}/reports" \
  '{"reportItems":[{"budgetCost":"2.000000","productCost":"1.000000","label":"e2e"}]}')
REPORT_ID=$(echo "$REP_JSON" | jq -r .reportId)
echo "e2e-local: reportId=${REPORT_ID}"

# Async webhook delivery
sleep 2

echo "e2e-local: GET report (verify API)"
GOT=$(api GET "/api/v1/sessions/${SESSION_ID}/reports/${REPORT_ID}")
echo "$GOT" | jq .
[[ "$(echo "$GOT" | jq -r .reportId)" == "$REPORT_ID" ]]

echo "e2e-local: GET /api/v1/reports?sessionId= (list report summaries + pagination)"
LIST=$(api GET "/api/v1/reports?sessionId=${SESSION_ID}")
echo "$LIST" | jq .
[[ "$(echo "$LIST" | jq -r .total)" == "1" ]]
[[ "$(echo "$LIST" | jq -r .limit)" == "50" ]]
[[ "$(echo "$LIST" | jq -r .offset)" == "0" ]]
[[ "$(echo "$LIST" | jq -r .hasMore)" == "false" ]]
[[ "$(echo "$LIST" | jq -r '.reports[0].reportId')" == "$REPORT_ID" ]]
[[ "$(echo "$LIST" | jq -r '.reports[0].sessionId')" == "$SESSION_ID" ]]
[[ "$(echo "$LIST" | jq -r '.reports[0].productKey')" == "$PRODUCT_KEY" ]]
[[ -n "$(echo "$LIST" | jq -r '.reports[0].createdAt')" ]]
[[ "$(echo "$LIST" | jq '.reports[0] | has("reportItems")')" == "false" ]]

echo "e2e-local: fetch webhook sink last POST"
LAST=$(curl -sS "${SINK}/__e2e/last")
echo "$LAST" | jq .
BODY=$(echo "$LAST" | jq -r .body)
[[ -n "$BODY" ]]
[[ "$(echo "$BODY" | jq -r .eventType)" == "report.created" ]]
[[ "$(echo "$BODY" | jq -r .productKey)" == "${PRODUCT_KEY}" ]]
[[ "$(echo "$BODY" | jq -r .data.reportId)" == "${REPORT_ID}" ]]

echo "e2e-local: OK"
