#!/usr/bin/env bash
#
# Query Grafana Loki for Airo Builder container logs.
#
# Builds a LogQL query from label/filter args, queries the Loki query_range API
# through the Grafana datasource proxy, and prints the matching log lines
# (newest-first) ready to pipe into jq/grep. See scripts/essp-creds.sh for the
# separate builder-frontend (Elastic/ESSP) path.
#
# Auth: export GRAFANA_API_TOKEN (a Grafana service-account token). Bearer auth.
#
# Examples:
#   GRAFANA_API_TOKEN=... scripts/loki-query.sh -a mkoecwqlky -m '"level":"error"' --since 6h
#   scripts/loki-query.sh -j airo-preview-application -c c37 -a stmhyk9qno --since 6h
#   scripts/loki-query.sh -j airo-agents -e dev -m sse.stream.premature_close --since 1d --limit 5000
#   scripts/loki-query.sh -q '{job="airo-agents",env="prod"} |= "publish.timeout"' --since 2h | jq -r .message
#
# Gotcha: server-side aggregation (count_over_time/quantile_over_time) over the
# high-volume airo-agents stream trips Loki's ~30s gateway timeout (502). Pull
# raw lines here (capped by --limit) and aggregate client-side with jq/python.
set -euo pipefail

# Grafana datasource proxy for the prod Loki source (id 650 == uid ff18mpwxpc7wgd).
LOKI_PROXY="${LOKI_PROXY:-https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/query_range}"

JOB="airo-agents"
ENV="prod"
APP_ID=""
CLUSTER=""
MATCHES=()
SINCE="1h"
START=""
END=""
LIMIT="1000"
DIRECTION="backward"
QUERY=""
RAW=0
SHOW_TS=0
MAX_TIME="60"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/loki-query.sh [options]

Selector (ignored when --query is given):
  -j, --job JOB        job / service_name label (default: airo-agents; e.g. airo-preview-application, airo-publish-application)
  -e, --env ENV        env label (default: prod; dev|prod)
  -c, --cluster CELL   cell label, e.g. c37 (recommended — scopes and speeds the query)
  -a, --app APP_ID     filter by app_id (structured metadata: | app_id = "<id>")
  -m, --match STR      additional |= "STR" line filter (repeatable)
  -q, --query LOGQL    full LogQL string; overrides -j/-e/-a/-m

Time range:
  -s, --since DUR      relative window ending now: 90s|30m|6h|2d (default: 1h)
      --start TS       explicit start (epoch seconds or RFC3339); overrides --since
      --end TS         explicit end   (epoch seconds or RFC3339; default: now)

Output:
  -l, --limit N        max lines (default: 1000)
  -d, --direction DIR  forward|backward (default: backward = newest first)
      --ts             prefix each line with its UTC timestamp
  -r, --raw            print the raw Loki JSON envelope instead of extracted lines

Auth: export GRAFANA_API_TOKEN (Grafana service-account token).
Override endpoint with LOKI_PROXY=... (default: prod datasource 650).
EOF
  exit "${1:-1}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -j|--job) JOB="$2"; shift 2 ;;
    -e|--env) ENV="$2"; shift 2 ;;
    -c|--cluster) CLUSTER="$2"; shift 2 ;;
    -a|--app) APP_ID="$2"; shift 2 ;;
    -m|--match) MATCHES+=("$2"); shift 2 ;;
    -q|--query) QUERY="$2"; shift 2 ;;
    -s|--since) SINCE="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --end) END="$2"; shift 2 ;;
    -l|--limit) LIMIT="$2"; shift 2 ;;
    -d|--direction) DIRECTION="$2"; shift 2 ;;
    --ts) SHOW_TS=1; shift ;;
    -r|--raw) RAW=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 1 ;;
  esac
done

command -v curl >/dev/null || { echo "Error: curl is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "Error: jq is required." >&2; exit 1; }
[[ -n "${GRAFANA_API_TOKEN:-}" ]] || { echo "Error: GRAFANA_API_TOKEN not set." >&2; exit 1; }

# Resolve a timestamp arg to epoch seconds: all-digits is treated as epoch,
# otherwise parsed as a date string via GNU date, falling back to BSD/macOS date.
to_epoch() {
  local ts="$1"
  if [[ "$ts" =~ ^[0-9]+$ ]]; then
    echo "$ts"
  elif date -d "$ts" +%s >/dev/null 2>&1; then
    date -d "$ts" +%s
  else
    date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s
  fi
}

since_to_secs() {
  local dur="$1" num unit
  num="${dur%[smhd]}"
  unit="${dur##*[0-9]}"
  [[ "$num" =~ ^[0-9]+$ ]] || { echo "Error: bad --since '$dur' (use 90s|30m|6h|2d)." >&2; exit 1; }
  case "$unit" in
    s|"") echo "$num" ;;
    m) echo $((num * 60)) ;;
    h) echo $((num * 3600)) ;;
    d) echo $((num * 86400)) ;;
    *) echo "Error: bad --since unit '$unit'." >&2; exit 1 ;;
  esac
}

NOW_S="$(date +%s)"
if [[ -n "$END" ]]; then END_S="$(to_epoch "$END")"; else END_S="$NOW_S"; fi
if [[ -n "$START" ]]; then
  START_S="$(to_epoch "$START")"
else
  # Separate assignment so a bad --since aborts via set -e instead of a
  # subshell exit swallowed inside $(( )).
  SINCE_SECS="$(since_to_secs "$SINCE")"
  START_S=$((NOW_S - SINCE_SECS))
fi

START_NS="${START_S}000000000"
END_NS="${END_S}000000000"

if [[ -z "$QUERY" ]]; then
  SELECTOR="job=\"${JOB}\",env=\"${ENV}\""
  [[ -n "$CLUSTER" ]] && SELECTOR+=",cluster=\"${CLUSTER}\""
  QUERY="{${SELECTOR}}"
  if [[ -n "$APP_ID" ]]; then
    aesc="${APP_ID//\\/\\\\}"   # escape backslash + double-quote for the LogQL string
    aesc="${aesc//\"/\\\"}"
    QUERY+=" | app_id = \"${aesc}\""   # structured-metadata filter (exact + indexed; app_id added 5/28/26)
  fi
  for m in "${MATCHES[@]:-}"; do
    [[ -n "$m" ]] || continue
    esc="${m//\\/\\\\}"   # escape backslashes first
    esc="${esc//\"/\\\"}" # then double-quotes, so inner JSON quotes survive LogQL parsing
    QUERY+=" |= \"${esc}\""
  done
fi

RESP="$(curl -sS -G --max-time "$MAX_TIME" \
  -H "Authorization: Bearer ${GRAFANA_API_TOKEN}" \
  "$LOKI_PROXY" \
  --data-urlencode "query=${QUERY}" \
  --data-urlencode "start=${START_NS}" \
  --data-urlencode "end=${END_NS}" \
  --data-urlencode "limit=${LIMIT}" \
  --data-urlencode "direction=${DIRECTION}")" || {
    echo "Error: Loki request failed (timeout or network). Query: ${QUERY}" >&2
    exit 1
  }

if [[ "$(printf '%s' "$RESP" | jq -r '.status // "error"')" != "success" ]]; then
  printf '%s' "$RESP" | jq -r '.error // .' >&2
  echo "(query: ${QUERY})" >&2
  exit 1
fi

if [[ "$RAW" == 1 ]]; then
  printf '%s\n' "$RESP" | jq .
  exit 0
fi

if [[ "$(printf '%s' "$RESP" | jq -r '.data.resultType')" == "streams" ]]; then
  printf '%s' "$RESP" | jq -r --argjson ts "$SHOW_TS" '
    .data.result[]? as $s | $s.values[]? |
      (if $ts == 1 then ((.[0] | tonumber / 1000000000 | todate) + " ") else "" end) + .[1]'
else
  printf '%s\n' "$RESP" | jq .
fi
