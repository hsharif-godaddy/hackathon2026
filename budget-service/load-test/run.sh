#!/usr/bin/env bash
# load-test/run.sh — Run one or all k6 load test scenarios.
# Usage:
#   ./load-test/run.sh                     # all scenarios sequentially
#   ./load-test/run.sh contention          # single scenario
#   ./load-test/run.sh throughput lifecycle # multiple scenarios
#
# Env:
#   BASE_URL    (default: http://localhost:8080)
#   AUTH_TOKEN  (default: empty, for LOCAL_AUTH_DISABLE=true)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

# Verify k6 is installed
if ! command -v k6 >/dev/null 2>&1; then
  echo "error: k6 not found. Install: brew install k6" >&2
  exit 1
fi

# Verify service is reachable
echo "Checking ${BASE_URL}/health ..."
if ! curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "error: budget-service not reachable at ${BASE_URL}" >&2
  echo "Start it with: make up && make dev" >&2
  exit 1
fi
echo "Service healthy."

SCENARIOS=("$@")
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  SCENARIOS=(contention throughput lifecycle)
fi

RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "${RESULTS_DIR}"

for scenario in "${SCENARIOS[@]}"; do
  script="${SCRIPT_DIR}/${scenario}.js"
  if [ ! -f "$script" ]; then
    echo "error: ${script} not found" >&2
    exit 1
  fi

  timestamp=$(date +%Y%m%d-%H%M%S)
  summary_file="${RESULTS_DIR}/${scenario}-${timestamp}.json"

  echo ""
  echo "=========================================="
  echo "  Running: ${scenario}"
  echo "  Target:  ${BASE_URL}"
  echo "  Output:  ${summary_file}"
  echo "=========================================="
  echo ""

  k6 run \
    --env BASE_URL="${BASE_URL}" \
    --env AUTH_TOKEN="${AUTH_TOKEN}" \
    --summary-export="${summary_file}" \
    "${script}"

  echo ""
  echo "  ✓ ${scenario} complete — summary: ${summary_file}"
  echo ""
done

echo "All scenarios complete. Results in ${RESULTS_DIR}/"

