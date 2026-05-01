#!/usr/bin/env bash
# bench-diff.sh — Compare two bench-run.sh outputs and emit a ratio table.
#
# Usage:
#   ./load-test/bench-diff.sh baseline.json candidate.json               # human-readable table
#   ./load-test/bench-diff.sh baseline.json candidate.json --markdown    # PR-comment markdown
#
# Exit codes:
#   0   no regression
#   1   regression (latency/error metric >20% worse, or baseline=0 -> candidate>0)
#   2   usage error
#   3   input/processing error (missing file, malformed JSON, jq error)
set -euo pipefail

BASELINE="${1:?baseline JSON path required}"
CANDIDATE="${2:?candidate JSON path required}"
FORMAT=table
for arg in "${@:3}"; do
  case "$arg" in
    --markdown|-m) FORMAT=markdown ;;
    --table|-t)    FORMAT=table ;;
    *) echo "error: unknown flag ${arg} (expected --markdown or --table)" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "error: jq not installed" >&2; exit 3; }
[ -s "$BASELINE" ]  || { echo "error: baseline ${BASELINE} missing or empty" >&2;  exit 3; }
[ -s "$CANDIDATE" ] || { echo "error: candidate ${CANDIDATE} missing or empty" >&2; exit 3; }

tmp="$(mktemp -t bench-diff.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

# For latency/error metrics, lower is better (ratio <1.0 = improvement).
# For throughput metrics, higher is better.
# Baseline=0 special case: if candidate is also 0, ratio is 1.0 (no change). If
# candidate is >0, emit a sentinel ratio of 999 so the regression gate fires — a
# zero error-rate baseline is the success state we want to protect.
if ! jq -n \
  --slurpfile b "$BASELINE" \
  --slurpfile c "$CANDIDATE" '
  def ratio(a; x):
    if a == null or x == null then null
    elif a == 0 then (if x == 0 then 1 else 999 end)
    else x / a end;
  def dir(r; lower_is_better):
    if r == null then "?"
    elif lower_is_better then
      if r < 0.95 then "better" elif r > 1.05 then "worse" else "~same" end
    else
      if r > 1.05 then "better" elif r < 0.95 then "worse" else "~same" end
    end;

  ($b[0]) as $base | ($c[0]) as $cand |
  {
    scenario: $base.scenario,
    baseline_runs: $base.runs,
    candidate_runs: $cand.runs,
    rows: [
      ["http_req_duration p95 (ms)",    $base.metrics.http_req_duration_p95,  $cand.metrics.http_req_duration_p95,  true],
      ["http_req_duration p99 (ms)",    $base.metrics.http_req_duration_p99,  $cand.metrics.http_req_duration_p99,  true],
      ["http_req_duration avg (ms)",    $base.metrics.http_req_duration_avg,  $cand.metrics.http_req_duration_avg,  true],
      ["http_req_failed rate",          $base.metrics.http_req_failed_rate,   $cand.metrics.http_req_failed_rate,   true],
      ["iterations completed",          $base.metrics.iterations_count,       $cand.metrics.iterations_count,       false],
      ["iterations / sec",              $base.metrics.iterations_rate,        $cand.metrics.iterations_rate,        false],
      ["sessions completed",            $base.metrics.sessions_completed,     $cand.metrics.sessions_completed,     false],
      ["sessions failed",               $base.metrics.sessions_failed,        $cand.metrics.sessions_failed,        true],
      ["session_spend p95 (ms)",        $base.metrics.session_spend_p95,      $cand.metrics.session_spend_p95,      true],
      ["session_spend p99 (ms)",        $base.metrics.session_spend_p99,      $cand.metrics.session_spend_p99,      true],
      ["session_report_get p95 (ms)",   $base.metrics.session_report_get_p95, $cand.metrics.session_report_get_p95, true],
      ["session_report_get p99 (ms)",   $base.metrics.session_report_get_p99, $cand.metrics.session_report_get_p99, true]
    ] | map({
      metric: .[0],
      baseline: .[1],
      candidate: .[2],
      ratio: ratio(.[1]; .[2]),
      direction: dir(ratio(.[1]; .[2]); .[3])
    })
  }
' > "$tmp"; then
  echo "error: failed to compute diff (malformed JSON?)" >&2
  exit 3
fi

case "$FORMAT" in
  markdown)
    jq -r '
      "### Load test: `\(.scenario)` (median of \(.baseline_runs) baseline / \(.candidate_runs) candidate runs)",
      "",
      "| Metric | Baseline | Candidate | Ratio | Direction |",
      "|---|---:|---:|---:|:---|",
      (.rows[] | "| \(.metric) | \(if .baseline==null then "n/a" else .baseline|tostring end) | \(if .candidate==null then "n/a" else .candidate|tostring end) | \(if .ratio==null then "n/a" elif .ratio == 999 then "∞" else (.ratio*1000|floor)/1000|tostring end) | \(.direction) |")
    ' "$tmp"
    ;;
  table)
    jq -r '
      "scenario: \(.scenario)  (baseline runs: \(.baseline_runs), candidate runs: \(.candidate_runs))",
      "",
      (["metric","baseline","candidate","ratio","dir"] | @tsv),
      (.rows[] | [.metric, (.baseline|tostring), (.candidate|tostring), (if .ratio==null then "n/a" elif .ratio == 999 then "∞" else (.ratio*1000|floor)/1000|tostring end), .direction] | @tsv)
    ' "$tmp" | column -t -s $'\t'
    ;;
esac

# Exit 1 if any latency/error metric regressed >20% (or baseline=0 -> candidate>0).
# Explicit gate: don't rely on set -e picking up the last command's exit code —
# a later edit adding any command below would silently defeat the regression check.
#
# Metrics checked: p95/p99 latencies and http_req_failed. Intentionally exclude
# http_req_duration avg — under contention workloads, serialization changes that
# reduce errors (e.g. replacing retry loops with advisory locks) shift queueing
# time into successful requests and make avg look worse, even when p95/p99 and
# error rate improve. p95/p99 capture real tail-latency regressions without the
# false positive; avg is still shown in the table for visibility.
if ! jq -e '[.rows[] | select(.metric | test("p95|p99|failed")) | select(.ratio != null and .ratio > 1.2)] | length == 0' "$tmp" >/dev/null; then
  exit 1
fi
exit 0
