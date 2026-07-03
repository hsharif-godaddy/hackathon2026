#!/usr/bin/env bash
# Provisions the shared skill-eval base app and outputs the three env vars
# required to activate stateful injection for the 12 skill-eval scenarios.
#
# Usage:
#   bash scripts/provision-skill-eval-base.sh [--ctrl-plane-url <url>]
#
# Defaults:
#   --ctrl-plane-url  http://localhost:4100   (local-control-plane default)
#
# Prerequisites:
#   - local-control-plane running (pnpm run dev, or standalone)
#   - curl and jq available on PATH
#
# On success prints:
#   export EVAL_SKILL_BASE_APP_ID=<id>
#   export EVAL_SKILL_BASE_PREVIEW_URL=<url>
#   export EVAL_SKILL_BASE_RESET_COMMIT=<sha>
#
# These can be eval'd directly:
#   eval "$(bash scripts/provision-skill-eval-base.sh)"

set -euo pipefail

CTRL_PLANE_URL="http://localhost:4100"
APPS_BASE_DIR="${APPS_BASE_DIR:-/tmp/airo-app-builder}"
FIXTURE_DIR="$(cd "$(dirname "$0")/../fixtures/skill-eval-base/src" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctrl-plane-url) CTRL_PLANE_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}
require_cmd curl
require_cmd jq

echo "[provision] Signing up for new app..." >&2
signup_response=$(curl -sf -X POST "${CTRL_PLANE_URL}/api/airo/v1/signup" \
  -H "Content-Type: application/json" \
  -d '{}')
job_id=$(echo "${signup_response}" | jq -r '.statusJobId')
if [[ -z "${job_id}" || "${job_id}" == "null" ]]; then
  echo "Signup failed — no statusJobId in response: ${signup_response}" >&2
  exit 1
fi
echo "[provision] Job ID: ${job_id}" >&2

echo "[provision] Polling until provisioning completes..." >&2
app_id=""
preview_url=""
attempts=0
max_attempts=60
while [[ $attempts -lt $max_attempts ]]; do
  poll=""
  curl_exit=0
  poll=$(curl -sf "${CTRL_PLANE_URL}/api/airo/v1/jobs/${job_id}/apps") || curl_exit=$?

  if [[ $curl_exit -ne 0 ]]; then
    echo "[provision] curl failed (exit ${curl_exit}), retrying..." >&2
    sleep 2
    attempts=$((attempts + 1))
    continue
  fi

  if ! status=$(echo "${poll}" | jq -re '.status // "unknown"' 2>/dev/null); then
    echo "[provision] Non-JSON response, retrying..." >&2
    sleep 2
    attempts=$((attempts + 1))
    continue
  fi

  if [[ "${status}" == "completed" ]]; then
    app_id=$(echo "${poll}" | jq -r '.apps[0].id')
    preview_url=$(echo "${poll}" | jq -r '.apps[0].urls.preview')
    break
  elif [[ "${status}" == "failed" ]]; then
    echo "Provisioning failed: $(echo "${poll}" | jq -r '.error // "unknown"')" >&2
    exit 1
  fi

  sleep 2
  attempts=$((attempts + 1))
done

if [[ -z "${app_id}" || "${app_id}" == "null" ]]; then
  echo "Provisioning timed out after $((max_attempts * 2)) seconds." >&2
  exit 1
fi
if [[ -z "${preview_url}" || "${preview_url}" == "null" ]]; then
  echo "Provisioning completed but preview_url is missing or null." >&2
  exit 1
fi
echo "[provision] App ID: ${app_id}" >&2
echo "[provision] Preview URL: ${preview_url}" >&2

app_workspace="${APPS_BASE_DIR}/${app_id}/preview"
if [[ ! -d "${app_workspace}" ]]; then
  echo "Workspace not found at expected path: ${app_workspace}" >&2
  echo "Check APPS_BASE_DIR (default /tmp/airo-app-builder) and app_id." >&2
  exit 1
fi

echo "[provision] Copying fixture files into ${app_workspace}..." >&2

# Pages
cp -r "${FIXTURE_DIR}/pages/." "${app_workspace}/src/pages/"

# Layout parts — only Header and Footer (don't replace RootLayout)
cp "${FIXTURE_DIR}/layouts/parts/Header.tsx" "${app_workspace}/src/layouts/parts/Header.tsx"
cp "${FIXTURE_DIR}/layouts/parts/Footer.tsx" "${app_workspace}/src/layouts/parts/Footer.tsx"

# routes.tsx — replace entirely
cp "${FIXTURE_DIR}/routes.tsx" "${app_workspace}/src/routes.tsx"

echo "[provision] Committing fixture state..." >&2
git_repo="${APPS_BASE_DIR}/${app_id}/git-repo"
GIT="git --git-dir=${git_repo}/.git --work-tree=${app_workspace}"
$GIT add src/pages/ src/layouts/parts/Header.tsx src/layouts/parts/Footer.tsx src/routes.tsx
$GIT diff --cached --quiet || $GIT commit -m "chore: add skill-eval base fixture (dental practice, 6 pages)"

reset_commit=$($GIT rev-parse HEAD)
echo "[provision] Reset commit: ${reset_commit}" >&2

echo ""
echo "# Copy-paste or eval the following to activate stateful injection:"
echo "export EVAL_SKILL_BASE_APP_ID=\"${app_id}\""
echo "export EVAL_SKILL_BASE_PREVIEW_URL=\"${preview_url}\""
echo "export EVAL_SKILL_BASE_RESET_COMMIT=\"${reset_commit}\""
