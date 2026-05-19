#!/usr/bin/env bash
# DPP → /develop hand-off local repro
#
# Simulates a domain-purchase-path (DPP) cold redirect against the local stack
# by POSTing directly to local-control-plane (port 4100), bypassing the BFF —
# the same shape mgmt-airo receives in production. Prints the /develop URL to
# open in a fresh browser tab to exercise the auto-send + FQDN preamble path
# end-to-end.
#
# Prereqs:
#   - `pnpm run dev` is running (agents:4000, app:3000, local-control-plane:4100)
#   - `jq` is installed
#
# Usage:
#   scripts/dpp-local-repro.sh [-p PROMPT] [-d FQDN] [-o]
#
#   -p PROMPT  Initial prompt to seed (default: portfolio for a freelance illustrator)
#   -d FQDN    FQDN to attach (default: studiosketch.com); pass "" to omit
#   -o         Open the URL in the default browser when ready
#
# Auth (only required when local-control-plane has AUTH_TYPE=jwt and you want
# the seeded app owned by your real shopper so the BFF can find it via the
# customer-scoped subscription cache):
#
#   export AIRO_COOKIE='info_idp=...; jwt=...'
#   scripts/dpp-local-repro.sh ...
#
# Without AIRO_COOKIE the seed still works but creates the app under
# DefaultCustomerID. With AUTH_TYPE=jwt that means /api/sites/{realAppId}
# 404s for your browser session and the develop page won't flip from the
# job URL to the realAppId URL.
#
# Exits non-zero if the signup call fails or the local stack is not reachable.
# Does NOT wait for full provisioning — open the URL and the develop page will
# show "Provisioning..." until the URL flips to the real appId.

set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:4100}"
APP_URL="${APP_URL:-https://local.gasket.dev-godaddy.com:8443}"

PROMPT="Build me a portfolio for a freelance illustrator"
FQDN="studiosketch.com"
OPEN_URL=0

while getopts ":p:d:oh" opt; do
  case "$opt" in
    p) PROMPT="$OPTARG" ;;
    d) FQDN="$OPTARG" ;;
    o) OPEN_URL=1 ;;
    h)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    \?) echo "unknown option: -$OPTARG" >&2; exit 64 ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq / apt-get install jq)" >&2
  exit 64
fi

if ! curl -sSf -o /dev/null --max-time 2 "$CONTROL_PLANE_URL/health"; then
  echo "error: local-control-plane not reachable at $CONTROL_PLANE_URL" >&2
  echo "       run 'pnpm run dev' from the repo root and retry." >&2
  exit 69
fi

# Build the variables blob; only include fqdn when set so we can also test the
# no-fqdn fall-through (preamble suppressed).
if [[ -n "$FQDN" ]]; then
  variables_json=$(jq -n --arg fqdn "$FQDN" '{ fqdn: $fqdn }')
else
  variables_json='{}'
fi

# /api/airo/v1/signup is the simplest entry — uses default subscription/system
# IDs and merges body.initialPrompt into variables for us.
payload=$(jq -n \
  --arg prompt "$PROMPT" \
  --argjson variables "$variables_json" \
  '{
    datacenter: "us-east-1",
    isTrial: true,
    productId: "aab-v1",
    initialPrompt: $prompt,
    appConfigs: [{
      templateName: "default",
      variants: ["preview"],
      variables: $variables
    }]
  }')

curl_args=(-sS -X POST "$CONTROL_PLANE_URL/api/airo/v1/signup"
  -H 'content-type: application/json'
  -d "$payload")
if [[ -n "${AIRO_COOKIE:-}" ]]; then
  curl_args+=(-H "Cookie: $AIRO_COOKIE")
fi
response=$(curl "${curl_args[@]}")

job_id=$(jq -r '.statusJobId // empty' <<<"$response")
if [[ -z "$job_id" ]]; then
  echo "error: signup did not return a statusJobId" >&2
  echo "response: $response" >&2
  exit 70
fi

develop_url="$APP_URL/develop/$job_id?type=job"

echo "DPP repro seeded:"
echo "  prompt:  $PROMPT"
if [[ -n "$FQDN" ]]; then
  echo "  fqdn:    $FQDN"
else
  echo "  fqdn:    (none — preamble should NOT prepend)"
fi
echo "  jobId:   $job_id"
echo
echo "Open in a fresh browser tab (no prior sessionStorage):"
echo "  $develop_url"
echo
echo "Expected:"
echo "  1. 'Provisioning...' UI during job phase."
echo "  2. URL flips to /develop/<realAppId> once provisioning completes."
if [[ -n "$FQDN" ]]; then
  echo "  3. ChatPane auto-sends: \"This site is for $FQDN. $PROMPT\""
else
  echo "  3. ChatPane auto-sends: \"$PROMPT\""
fi
echo "  4. Reload mid-flight does NOT re-send (initialPromptSent latch + history check)."

if [[ "$OPEN_URL" -eq 1 ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$develop_url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$develop_url" || true
  else
    echo "(no xdg-open/open found; open the URL manually)" >&2
  fi
fi
