#!/usr/bin/env bash
# Imports dashboard.ndjson into Kibana via the saved-objects import API.
#
# Required env:
#   AIRO_BUILDER_ES_ENDPOINT  e.g. https://airobuilde-prod-usw2.es.us-west-2.aws.found.io:9243
#   AIRO_BUILDER_ES_API_KEY   ES/Kibana API key (Kibana sits at the .kb. sister URL)
#
# Optional env:
#   KIBANA_URL  override Kibana base URL (default: derived from AIRO_BUILDER_ES_ENDPOINT)
#   SPACE       Kibana space id (default: default)

set -euo pipefail

cd "$(dirname "$0")"

if [[ -z "${AIRO_BUILDER_ES_ENDPOINT:-}" || -z "${AIRO_BUILDER_ES_API_KEY:-}" ]]; then
  echo "ERROR: AIRO_BUILDER_ES_ENDPOINT and AIRO_BUILDER_ES_API_KEY must be set" >&2
  exit 1
fi

KIBANA_URL="${KIBANA_URL:-${AIRO_BUILDER_ES_ENDPOINT/.es./.kb.}}"
SPACE="${SPACE:-default}"

if [[ "$SPACE" == "default" ]]; then
  BASE="$KIBANA_URL"
else
  BASE="$KIBANA_URL/s/$SPACE"
fi

NDJSON="dashboard.ndjson"
if [[ ! -f "$NDJSON" ]]; then
  echo "Generating $NDJSON ..."
  python3 build-dashboard.py
fi

echo "Importing $NDJSON to $BASE (overwrite=true) ..."
curl -fsS -X POST \
  "$BASE/api/saved_objects/_import?overwrite=true" \
  -H "Authorization: ApiKey $AIRO_BUILDER_ES_API_KEY" \
  -H "kbn-xsrf: true" \
  --form file=@"$NDJSON" | python3 -m json.tool

echo
echo "Open dashboard (use the time picker for 24h / 7d / 30d):"
echo "  $BASE/app/dashboards#/view/lf-agents-ops"
