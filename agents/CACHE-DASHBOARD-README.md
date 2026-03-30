# Cache Effectiveness Dashboard - Setup Complete

## What Was Created

### 1. Monitoring Script (`scripts/check-cache-metrics.sh`)

**Purpose:** Quick command-line reports on cache performance
**Usage:**

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

### 2. Kibana Dashboard (Pre-Created)

**Purpose:** Visual dashboard for ongoing monitoring
**URL:** https://pioneerc1-prod-usw2.kb.us-west-2.aws.found.io:9243/app/dashboards#/view/0868e967-ab36-48d5-b08b-981a11cc14f4

**Status:** Empty dashboard created, needs visualizations added

**Add visualizations:**

- Run `./scripts/create-kibana-dashboard.sh` (interactive guide)
- Or follow manual steps in `KIBANA-SETUP.md`

**Planned visualizations:**

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

- Kibana query patterns
- Elasticsearch aggregations
- Expected behavior patterns
- Cost impact analysis
- Alerting recommendations
- Troubleshooting guide

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

1. Run `./scripts/check-cache-metrics.sh` to compare
2. Verify invalidation events drop to <100/day
3. Check that hit rates improve to 95-99%+
4. Monitor for unexpected regressions

### Set Up Alerts (Recommended)

Use Kibana Watcher or Elastic alerting to notify on:

- Cache hit rate <85% for 15+ minutes (critical)
- Average cacheWriteTokens >5K per app (warning)
- Specific app hit rate <80% for 1+ hour (info)

## Troubleshooting

### Script returns "No cache data"

- Check Elasticsearch connectivity
- Verify API key is valid
- Confirm index name is correct (`airo-agents-prod`)

### Kibana import fails

- Ensure Kibana version matches (8.17.x)
- Check data view exists for `airo-agents-prod`
- Verify field names match production mapping

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
