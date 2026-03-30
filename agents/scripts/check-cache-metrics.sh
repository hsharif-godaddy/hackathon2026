#!/bin/bash

# Cache Metrics Checker for Airo Agents Production
# Queries Elasticsearch to analyze cache effectiveness

ES_URL="${ES_URL:-https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443}"
INDEX="${ES_INDEX:-airo-agents-prod}"
API_KEY="${ES_API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "Error: ES_API_KEY environment variable not set"
  echo "Usage: ES_API_KEY='your-key' $0"
  exit 1
fi

echo "=== Agent Cache Effectiveness Report ==="
echo "Index: $INDEX"
echo "Time range: Last 7 days"
echo ""

# Overall cache hit rate
echo "--- Overall Cache Hit Rate ---"
CACHE_STATS=$(curl -s -X POST "$ES_URL/$INDEX/_search" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"@timestamp": {"gte": "now-7d"}}}
        ]
      }
    },
    "aggs": {
      "total_reads": {"sum": {"field": "data.cacheReadTokens"}},
      "total_writes": {"sum": {"field": "data.cacheWriteTokens"}},
      "total_invocations": {"value_count": {"field": "data.cacheReadTokens"}}
    }
  }')

READS=$(echo "$CACHE_STATS" | jq -r '.aggregations.total_reads.value // 0')
WRITES=$(echo "$CACHE_STATS" | jq -r '.aggregations.total_writes.value // 0')
INVOCATIONS=$(echo "$CACHE_STATS" | jq -r '.aggregations.total_invocations.value // 0')

if [ "$READS" != "null" ] && [ "$WRITES" != "null" ] && [ "$INVOCATIONS" != "null" ]; then
  # Use awk for floating point arithmetic
  TOTAL=$(awk "BEGIN {printf \"%.0f\", $READS + $WRITES}")
  if [ "$TOTAL" != "0" ] && [ -n "$TOTAL" ]; then
    HIT_RATE=$(awk "BEGIN {printf \"%.2f\", ($READS / $TOTAL) * 100}")
    echo "Cache Read Tokens: $(awk "BEGIN {printf \"%'.0f\", $READS}")"
    echo "Cache Write Tokens: $(awk "BEGIN {printf \"%'.0f\", $WRITES}")"
    echo "Total Agent Invocations: $INVOCATIONS"
    echo "Cache Hit Rate: $HIT_RATE%"

    # Cost calculation (Anthropic pricing March 2026)
    SAVINGS=$(awk "BEGIN {printf \"%.2f\", ($READS / 1000000 * 2.70) - ($WRITES / 1000000 * 3.75)}")
    echo "Estimated Savings: \$$SAVINGS"
  else
    echo "No cache data found in the last 7 days"
  fi
else
  echo "Error: Could not parse cache statistics"
fi

echo ""

# Top 10 apps by cache reads
echo "--- Top 10 Apps by Cache Usage ---"
TOP_APPS=$(curl -s -X POST "$ES_URL/$INDEX/_search" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"@timestamp": {"gte": "now-7d"}}}
        ]
      }
    },
    "aggs": {
      "by_app": {
        "terms": {"field": "app_id", "size": 10, "order": {"total_reads": "desc"}},
        "aggs": {
          "total_reads": {"sum": {"field": "data.cacheReadTokens"}},
          "total_writes": {"sum": {"field": "data.cacheWriteTokens"}}
        }
      }
    }
  }')

echo "$TOP_APPS" | jq -r '
  .aggregations.by_app.buckets[] |
  "App: \(.key | .[0:8])... | Reads: \(.total_reads.value | tonumber | floor) tokens | Writes: \(.total_writes.value | tonumber | floor) tokens | Hit Rate: \(((.total_reads.value / (.total_reads.value + .total_writes.value)) * 100) | floor)%"
'

echo ""

# Recent cache invalidation events
echo "--- Recent Cache Invalidation Events (Last 24h) ---"
INVALIDATIONS=$(curl -s -X POST "$ES_URL/$INDEX/_search" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 10,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"data.cacheWriteTokens": {"gt": 10000}}},
          {"range": {"@timestamp": {"gte": "now-24h"}}}
        ]
      }
    },
    "sort": [{"@timestamp": "desc"}],
    "_source": ["@timestamp", "app_id", "data.cacheWriteTokens", "data.cacheReadTokens"]
  }')

INVALIDATION_COUNT=$(echo "$INVALIDATIONS" | jq -r '.hits.total.value // 0')
echo "Total invalidation events: $INVALIDATION_COUNT"

if [ "$INVALIDATION_COUNT" -gt 0 ]; then
  echo ""
  echo "$INVALIDATIONS" | jq -r '
    .hits.hits[] |
    "Time: \(._source["@timestamp"]) | App: \(._source.app_id | .[0:8])... | Writes: \(._source.data.cacheWriteTokens) tokens"
  '
else
  echo "No cache invalidation events found (this is good!)"
fi

echo ""

# Average context sizes
echo "--- Average Context Sizes (Last 24h) ---"
CONTEXT_SIZES=$(curl -s -X POST "$ES_URL/$INDEX/_search" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "app.context.generate.success"}},
          {"range": {"@timestamp": {"gte": "now-24h"}}}
        ]
      }
    },
    "aggs": {
      "avg_context_size": {"avg": {"field": "data.contextSize"}},
      "avg_stable": {"avg": {"field": "data.stableContextSize"}},
      "avg_secrets": {"avg": {"field": "data.secretsContextSize"}},
      "avg_media": {"avg": {"field": "data.mediaSlotsContextSize"}},
      "total_generations": {"value_count": {"field": "data.contextSize"}}
    }
  }')

AVG_TOTAL=$(echo "$CONTEXT_SIZES" | jq -r '.aggregations.avg_context_size.value // 0')
AVG_STABLE=$(echo "$CONTEXT_SIZES" | jq -r '.aggregations.avg_stable.value // 0')
AVG_SECRETS=$(echo "$CONTEXT_SIZES" | jq -r '.aggregations.avg_secrets.value // 0')
AVG_MEDIA=$(echo "$CONTEXT_SIZES" | jq -r '.aggregations.avg_media.value // 0')
TOTAL_GENS=$(echo "$CONTEXT_SIZES" | jq -r '.aggregations.total_generations.value // 0')

if [ "$TOTAL_GENS" != "null" ] && [ "$TOTAL_GENS" -gt 0 ]; then
  echo "Total context generations: $TOTAL_GENS"
  echo "Average Total Context: $(printf "%.0f" $AVG_TOTAL) bytes"

  # New fields only available after PR deployment
  if [ "$AVG_STABLE" != "0" ] && [ "$AVG_STABLE" != "null" ]; then
    echo "Average Stable Context: $(printf "%.0f" $AVG_STABLE) bytes"
    echo "Average Secrets Context: $(printf "%.0f" $AVG_SECRETS) bytes"
    echo "Average Media Slots Context: $(printf "%.0f" $AVG_MEDIA) bytes"
  else
    echo "(Note: stableContextSize/secretsContextSize/mediaSlotsContextSize not yet deployed)"
  fi
else
  echo "No context generation data found in the last 24 hours"
fi

echo ""
echo "=== End of Report ==="
