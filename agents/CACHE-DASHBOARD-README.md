# Cache Effectiveness Dashboard - Setup Complete

## What Was Created

### 1. Monitoring Script (`scripts/check-cache-metrics.sh`) - DEPRECATED

> The script queries the deprecated pioneerc1 ES cluster and will return "No cache data". Use Grafana Explore (section 2 below) until the script is re-pointed at Loki.

**Purpose (historical):** Quick command-line reports on cache performance
**Usage (historical):**

```bash
cd agents
./scripts/check-cache-metrics.sh
```

**Reports:**

- Overall cache hit rate (7-day)
- Top 10 apps by cache usage
- Recent cache invalidation events (24h)
- Average context sizes
- Cost savings estimate

### 2. Grafana Dashboard (V2 Logs)

**Purpose:** Visual dashboard for ongoing monitoring

Agent logs now flow into **Grafana Loki** (V2 logging); the old pioneerc1 Kibana dashboard
is deprecated. Build or link cache-effectiveness panels against the Loki `{job="airo-agents"}`
stream and Mimir metrics.

- Grafana entry point + per-env links: [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs)
- Required AD groups: `JOMAX\okta_lgtm-grafana_mwpv2_viewer`, `JOMAX\okta_observability_grafana`
- The `scripts/create-kibana-dashboard.sh` helper and `KIBANA-SETUP.md` are kept for historical reference only

**Planned Grafana panels (mirror of the old Kibana ones, not yet built):**

- Cache hit rate over time (line chart)
- Cache read vs write tokens (stacked area)
- Context size distribution (multi-line chart)
- Cache invalidation events (metric)
- Cache performance by app (data table)

### 3. Documentation (`CACHE-MONITORING.md` and `KIBANA-SETUP.md`)

**Purpose:** Reference guides for setup, queries, metrics, and troubleshooting

**KIBANA-SETUP.md:**

- Step-by-step visualization creation
- Interactive setup script usage
- Manual creation instructions

**CACHE-MONITORING.md:**

- LogQL/Loki query patterns (V2) and legacy Elasticsearch aggregations
- Expected behavior patterns
- Cost impact analysis
- Alerting recommendations
- Troubleshooting guide

> NOTE: The raw `curl` snippets below point at the deprecated pioneerc1 ES cluster
> (`6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io`). New data lands in
> Grafana Loki; these are retained only for historical replay against surviving
> ES indices until they age out. Translate `event.keyword` / `data.*` fields into
> LogQL label + JSON filters for live queries.

## Current Production Metrics (March 29, 2026)

**7-day summary:**

```
Cache Read Tokens:    13.4 billion tokens
Cache Write Tokens:   1.7 billion tokens
Cache Hit Rate:       88.53%
Agent Invocations:    216,474
Estimated Savings:    $29,700
```

**Top apps by cache usage:**

- d85zs2pb: 377M reads, 24M writes, 93% hit rate
- zvcu6fre: 350M reads, 14M writes, 96% hit rate
- jwoa61if: 155M reads, 11M writes, 93% hit rate

**Cache invalidation events:** 4,464 in last 24h

These numbers represent the baseline BEFORE optimization. Expected improvements after PR deployment:

- Hit rate: 88.53% → **95-99%+**
- Invalidations: 4,464/day → **<100/day**
- Write tokens: 1.7B/week → **~50M/week** (97% reduction)

## Key Field Mappings

Production Elasticsearch uses different field names than our local code:

| Code Field                                 | ES Field                | Notes                      |
| ------------------------------------------ | ----------------------- | -------------------------- |
| `appId`                                    | `app_id`                | Underscore, not camelCase  |
| `agent.step.finish.cacheReadTokens`        | `data.cacheReadTokens`  | Nested under `data` object |
| `agent.step.finish.cacheWriteTokens`       | `data.cacheWriteTokens` | Nested under `data` object |
| `app.context.generate.success.contextSize` | `data.contextSize`      | Nested under `data` object |

**New fields** (after PR deployment):

- `data.stableContextSize` - stable context (package info, colors)
- `data.secretsContextSize` - secrets context (dynamic)
- `data.mediaSlotsContextSize` - media slots context (dynamic)

## Quick Commands

### Check overall cache performance

```bash
./scripts/check-cache-metrics.sh
```

### Find apps with low cache hit rates

```bash
curl -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \
  -H "Authorization: ApiKey $ES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"@timestamp": {"gte": "now-24h"}}}
        ]
      }
    },
    "aggs": {
      "by_app": {
        "terms": {"field": "app_id", "size": 20},
        "aggs": {
          "total_reads": {"sum": {"field": "data.cacheReadTokens"}},
          "total_writes": {"sum": {"field": "data.cacheWriteTokens"}},
          "hit_rate": {
            "bucket_script": {
              "buckets_path": {
                "reads": "total_reads",
                "writes": "total_writes"
              },
              "script": "params.reads / (params.reads + params.writes) * 100"
            }
          }
        }
      },
      "low_hit_rate": {
        "bucket_selector": {
          "buckets_path": {"hit_rate": "hit_rate"},
          "script": "params.hit_rate < 90"
        }
      }
    }
  }' | jq
```

### Monitor cache invalidations in real-time

```bash
# Watch for invalidation events (>10K write tokens)
watch -n 5 'curl -s -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \
  -H "Authorization: ApiKey $ES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '"'"'{
    "size": 5,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"data.cacheWriteTokens": {"gt": 10000}}},
          {"range": {"@timestamp": {"gte": "now-5m"}}}
        ]
      }
    },
    "sort": [{"@timestamp": "desc"}],
    "_source": ["@timestamp", "app_id", "data.cacheWriteTokens"]
  }'"'"' | jq -r '"'"'.hits.hits[] | "\(._source["@timestamp"]) | \(._source.app_id) | \(._source.data.cacheWriteTokens) tokens"'"'"
```

## Next Steps

### Before Deployment

1. Establish baseline metrics for comparison
2. Document current problem apps (>10K writes on non-first turns)
3. Note current average hit rate per app

### After PR Deployment

1. Compare against baseline via Grafana Explore (`{job="airo-agents", env="prod"}` with the LogQL queries in `CACHE-MONITORING.md`). The legacy `check-cache-metrics.sh` queries pioneerc1 and is no longer reliable.
2. Verify invalidation events drop to <100/day
3. Check that hit rates improve to 95-99%+
4. Monitor for unexpected regressions

### Set Up Alerts (Recommended)

Use Grafana alerting against the Loki agent stream to notify on:

- Cache hit rate <85% for 15+ minutes (critical)
- Average cacheWriteTokens >5K per app (warning)
- Specific app hit rate <80% for 1+ hour (info)

## Troubleshooting

### Script returns "No cache data"

- Confirm you are querying Grafana Loki (V2); the pioneerc1 ES cluster no longer receives new data
- Verify Grafana auth (AD groups `JOMAX\okta_lgtm-grafana_mwpv2_viewer`, `JOMAX\okta_observability_grafana`)
- Confirm the Loki stream label (`{job="airo-agents", env="prod"}`)

### Unexpected cache invalidations

1. Run script to identify problem apps
2. Check app logs for file writes, secret updates, media changes
3. Verify code deployment status (old vs new cache logic)
4. Compare context generation events before/after invalidation

## Files Created

```
agents/
├── scripts/
│   ├── check-cache-metrics.sh          # CLI monitoring script
│   ├── create-dashboard-api.sh         # API script that created the dashboard
│   └── create-kibana-dashboard.sh      # Interactive visualization setup
├── CACHE-MONITORING.md                 # Elasticsearch queries and troubleshooting
├── KIBANA-SETUP.md                     # Kibana visualization setup guide
├── CACHE-DASHBOARD-README.md           # This file
└── kibana-cache-dashboard-simple.ndjson # Minimal export (may not import)
```
