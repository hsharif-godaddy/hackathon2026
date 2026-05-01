#!/usr/bin/env bash
# bench-run.sh — Run one k6 scenario N times and emit median metrics as JSON.
#
# Usage:
#   ./load-test/bench-run.sh contention 3 > result.json
#
# Env:
#   BASE_URL    (default: http://localhost:8080)
#   AUTH_TOKEN  (default: empty)
#   RUNS        (default: 3)
set -euo pipefail

SCENARIO="${1:?scenario name required (contention|throughput|lifecycle)}"
RUNS="${2:-${RUNS:-3}}"
if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: RUNS must be a positive integer, got: ${RUNS}" >&2
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

script="${SCRIPT_DIR}/${SCENARIO}.js"
[ -f "$script" ] || { echo "error: ${script} not found" >&2; exit 1; }
command -v k6  >/dev/null 2>&1 || { echo "error: k6 not installed" >&2; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "error: jq not installed" >&2; exit 1; }
curl -sf "${BASE_URL}/health" >/dev/null 2>&1 || { echo "error: service not reachable at ${BASE_URL}" >&2; exit 1; }

tmpdir="$(mktemp -d -t bench-run.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

for i in $(seq 1 "$RUNS"); do
  echo "run ${i}/${RUNS}: ${SCENARIO}" >&2
  k6 run \
    --quiet \
    --env BASE_URL="${BASE_URL}" \
    --env AUTH_TOKEN="${AUTH_TOKEN}" \
    --summary-trend-stats="avg,min,med,max,p(95),p(99)" \
    --summary-export="${tmpdir}/run-${i}.json" \
    "$script" >&2
  if [ ! -s "${tmpdir}/run-${i}.json" ]; then
    echo "error: k6 did not produce a summary for run ${i} (likely crashed or OOM-killed)" >&2
    exit 1
  fi
done

# pick() produces [v1, v2, ...] per run; nulls are dropped before median.
# Median of an empty list is null (metric absent in all runs).
jq -s --arg scenario "$SCENARIO" '
  def median:
    map(select(. != null))
    | if length == 0 then null
      else sort
        | if length % 2 == 1 then .[length/2|floor]
          else (.[length/2-1] + .[length/2]) / 2 end
      end;

  def pick(path): map(getpath(path));

  {
    runs: length,
    scenario: $scenario,
    metrics: {
      http_req_duration_p95:    (pick(["metrics","http_req_duration","p(95)"]) | median),
      http_req_duration_p99:    (pick(["metrics","http_req_duration","p(99)"]) | median),
      http_req_duration_avg:    (pick(["metrics","http_req_duration","avg"])   | median),
      http_req_failed_rate:     (pick(["metrics","http_req_failed","value"])   | median),
      iterations_count:         (pick(["metrics","iterations","count"])        | median),
      iterations_rate:          (pick(["metrics","iterations","rate"])         | median),
      sessions_completed:       (pick(["metrics","sessions_completed","count"]) | median),
      sessions_failed:          (pick(["metrics","sessions_failed","count"])    | median),
      session_spend_p95:        (pick(["metrics","session_spend_duration","p(95)"]) | median),
      session_spend_p99:        (pick(["metrics","session_spend_duration","p(99)"]) | median),
      session_report_get_p95:   (pick(["metrics","session_report_get_duration","p(95)"]) | median),
      session_report_get_p99:   (pick(["metrics","session_report_get_duration","p(99)"]) | median)
    }
  }
' "${tmpdir}"/run-*.json
