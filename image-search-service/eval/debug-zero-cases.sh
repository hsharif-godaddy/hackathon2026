#!/usr/bin/env bash
# Debug script for zero-result eval cases.
# Sends individual requests to the image search service and prints full responses.
#
# Usage:
#   ./debug-zero-cases.sh           # Run all 3 zero-result cases
#   ./debug-zero-cases.sh lawyer    # Run just the law-firm/attorney case
#   ./debug-zero-cases.sh startup   # Run just the tech-startup/hero case
#   ./debug-zero-cases.sh salon     # Run just the salon/hero case
#
# The service should be running at localhost:8080 (or set IMAGE_SEARCH_SERVICE_URL).

set -euo pipefail

BASE_URL="${IMAGE_SEARCH_SERVICE_URL:-http://localhost:8080}"
ENDPOINT="${BASE_URL}/api/v1/search"

run_case() {
  local label="$1"
  local payload="$2"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $label"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "POST $ENDPOINT"
  echo "$payload" | jq .
  echo ""
  echo "Response:"
  local tmpfile
  tmpfile=$(mktemp)
  local http_code
  http_code=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "$payload")
  jq . "$tmpfile" 2>/dev/null || cat "$tmpfile"
  echo ""
  echo "HTTP Status: $http_code"
  rm -f "$tmpfile"
  echo ""
}

# Case 1: law-firm / attorney — 0 results
# Filters: compositions=headshot, graphicalStyles=photography
case_lawyer() {
  run_case "law-firm / team/attorney" '{
    "query": "professional attorney portrait",
    "count": 5,
    "filters": {
      "compositions": ["headshot"],
      "graphicalStyles": ["photography"]
    }
  }'
}

# Case 2: tech-startup / hero — 0 results
# Filters: moods=cool, compositions=copy_space, orientations=horizontal
case_startup() {
  run_case "tech-startup / pages/home/hero" '{
    "query": "technology team collaboration startup",
    "count": 5,
    "filters": {
      "moods": ["cool"],
      "compositions": ["copy_space"],
      "orientations": ["horizontal"]
    }
  }'
}

# Case 3: salon / hero — 0 results
# Filters: moods=warm, orientations=horizontal
case_salon() {
  run_case "salon / pages/home/hero" '{
    "query": "modern hair salon interior",
    "count": 5,
    "filters": {
      "orientations": ["horizontal"]
    }
  }'
  # "moods": ["warm"],
}

QDRANT_URL="${QDRANT_URL:-https://localhost:6333}"
COLLECTION="${QDRANT_COLLECTION:-image_analyses}"

# Dump stored Qdrant payload for a specific Getty image ID.
# Shows orientation, moods, compositions, graphicalStyles, numberOfPeople, ethnicity, ageOfPeople.
dump_point() {
  local getty_id="$1"
  echo "--- Getty ID: $getty_id ---"
  curl -s -k "${QDRANT_URL}/collections/${COLLECTION}/points/${getty_id}" |
    jq '{
      id: .result.id,
      orientation:     .result.payload.orientation,
      moods:           .result.payload.moods,
      composition:     .result.payload.composition,
      graphicalStyle:  .result.payload.graphicalStyle,
      numberOfPeople:  .result.payload.numberOfPeople,
      ethnicity:       .result.payload.ethnicity,
      ageOfPeople:     .result.payload.ageOfPeople,
      analysisVersion: .result.payload.analysisVersion,
      title:           .result.payload.title
    }' 2>/dev/null || echo "  (not found or error)"
  echo ""
}

# Dump all points matching a query (scroll with filter) to see what's in the collection.
dump_scroll() {
  local label="$1"
  local filter_json="$2"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  QDRANT DUMP: $label"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Scrolling ${COLLECTION} with filter:"
  echo "$filter_json" | jq .
  echo ""

  curl -k -s -X POST "${QDRANT_URL}/collections/${COLLECTION}/points/scroll" \
    -H "Content-Type: application/json" \
    -d "{
      \"filter\": ${filter_json},
      \"limit\": 20,
      \"with_payload\": true,
      \"with_vector\": false
    }" | jq '.result.points[] | {
      id,
      orientation:     .payload.orientation,
      moods:           .payload.moods,
      composition:     .payload.composition,
      graphicalStyle:  .payload.graphicalStyle,
      numberOfPeople:  .payload.numberOfPeople,
      ethnicity:       .payload.ethnicity,
      ageOfPeople:     .payload.ageOfPeople,
      analysisVersion: .payload.analysisVersion,
      title:           .payload.title
    }' 2>/dev/null || echo "  (error querying Qdrant)"
  echo ""
}

# Dump salon images — the Getty IDs from the log (1410142649, 2239863237, 1289190337)
case_dump_salon() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  QDRANT DUMP: salon Getty IDs (from service logs)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  for id in 1410142649 2239863237 1289190337; do
    dump_point "$id"
  done

  echo "--- Scroll: orientation=horizontal ---"
  dump_scroll "orientation=horizontal only" '{
    "must": [{"key": "orientation", "match": {"value": "horizontal"}}]
  }'

  echo "--- Scroll: moods contains warm ---"
  dump_scroll "moods=warm only" '{
    "must": [{"key": "moods", "match": {"value": "warm"}}]
  }'
}

filter="${1:-all}"

case "$filter" in
lawyer | law*) case_lawyer ;;
startup | tech*) case_startup ;;
salon | hair*) case_salon ;;
dump | dump-salon) case_dump_salon ;;
all)
  case_lawyer
  case_startup
  case_salon
  ;;
*)
  echo "Unknown case: $filter"
  echo "Usage: $0 [lawyer|startup|salon|dump|all]"
  exit 1
  ;;
esac
