# Agent Cache Effectiveness - Detailed Monitoring Guide

This document provides detailed log queries and advanced monitoring techniques.

**For quick start and dashboard access, see `CACHE-DASHBOARD-README.md`**

> Agent logs now live in **Grafana Loki** (V2). The pioneerc1 Elasticsearch cluster
> at `6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io` is deprecated - the
> raw `curl` recipes below are kept only for replay against surviving ES data. For
> live queries use Grafana / LogQL against `{job="airo-agents", env="prod"}`.
> Access: [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs).

## Prerequisites

Legacy ES queries require the `ES_API_KEY` environment variable:

```bash
export ES_API_KEY='your-elasticsearch-api-key'
```

## Production Baseline (March 2026)

**Pre-optimization metrics** (before file listing removal and dynamic context split):
- Cache hit rate: **88.53%** (7-day average)
- Cache invalidation events: **~4,500 per 24h** (>10K write tokens)
- Cost savings: **~$30K per week** from caching
- Average context size: **~7.2KB**

**Expected post-optimization** (after PRs #2093 and #2282 deployed):
- Cache hit rate: **95-99%+** (steady state)
- Cache invalidation events: **<100 per 24h** (only first turns and real changes)
- Cache write reduction: **~97%** (40-50K → 147-455 tokens per turn)
- Additional savings: **~$9 per equivalent dataset**

## Using Grafana Explore (LogQL)

For ad-hoc investigation, use Grafana Explore with the Loki datasource. Examples:

Prefer literal line filters on JSON fields (cheaper than parsing, and matches `debug-console/src/lib/loki-client.ts` - `app_id` is a field in the log line, not a Loki label):

```logql
{job="airo-agents", env="prod"} |= "\"event\":\"agent.step.finish\"" | json | data_cacheWriteTokens > 10000
{job="airo-agents", env="prod"} |= "\"event\":\"app.context.generate.success\""
{job="airo-agents", env="prod"} |= "\"app_id\":\"abc123xyz\""
```

## Dashboard Visualizations

The production dashboard includes four key visualizations:

### 1. Cache Hit Rate %
Shows percentage of tokens served from cache over time. Target: 95-99%+ after optimization.

### 2. Cache Invalidations (24h)
Count of events where >10K tokens were written (indicates full cache invalidation). Target: <100 per day.

### 3. Cache Read/Write Tokens
Time series showing token usage trends. Reads should be 10-20x higher than writes in steady state.

### 4. Top Apps by Cache Usage
Table showing top 10 apps by total cache reads, with write counts and hit rates.

## Legacy Kibana Discover Patterns (deprecated pioneerc1 cluster)

### Find cache invalidation events
```
event: "agent.step.finish" AND data.cacheWriteTokens > 10000
```

### Track context generation
```
event: "app.context.generate.success"
```

### Find conversations with low cache hit rate
```
event: "agent.step.finish" AND data.cacheReadTokens < 30000
```

### Investigate specific app
```
app_id: "abc123xyz" AND (event: "agent.step.finish" OR event: "app.context.generate.success")
```

## Elasticsearch Queries

### Base URL and Index

```bash
ES_URL="https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443"
INDEX="airo-agents-prod"
```

All queries below use these variables and `$ES_API_KEY` for authentication.

## Common Aggregations

### Overall cache hit rate (last 7 days)
```bash
curl -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \\
  -H "Authorization: ApiKey $ES_API_KEY" \\
  -H "Content-Type: application/json" \\
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
      "total_reads": {"sum": {"field": "agent.step.finish.cacheReadTokens"}},
      "total_writes": {"sum": {"field": "agent.step.finish.cacheWriteTokens"}}
    }
  }'
```

### Cache hit rate by app
```bash
curl -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \\
  -H "Authorization: ApiKey $ES_API_KEY" \\
  -H "Content-Type: application/json" \\
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
        "terms": {"field": "appId.keyword", "size": 20},
        "aggs": {
          "total_reads": {"sum": {"field": "agent.step.finish.cacheReadTokens"}},
          "total_writes": {"sum": {"field": "agent.step.finish.cacheWriteTokens"}}
        }
      }
    }
  }'
```

### Context size trends
```bash
curl -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \\
  -H "Authorization: ApiKey $ES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "size": 0,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "app.context.generate.success"}},
          {"range": {"@timestamp": {"gte": "now-7d"}}}
        ]
      }
    },
    "aggs": {
      "over_time": {
        "date_histogram": {"field": "@timestamp", "fixed_interval": "1h"},
        "aggs": {
          "avg_stable": {"avg": {"field": "app.context.generate.success.stableContextSize"}},
          "avg_secrets": {"avg": {"field": "app.context.generate.success.secretsContextSize"}},
          "avg_media": {"avg": {"field": "app.context.generate.success.mediaSlotsContextSize"}}
        }
      }
    }
  }'
```

### Find cache invalidation events
```bash
curl -X POST "https://6f2c29a49ba64dbfb4be9584fa6e5cef.us-west-2.aws.found.io:443/airo-agents-prod/_search" \\
  -H "Authorization: ApiKey $ES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "size": 100,
    "query": {
      "bool": {
        "must": [
          {"term": {"event.keyword": "agent.step.finish"}},
          {"range": {"agent.step.finish.cacheWriteTokens": {"gt": 10000}}},
          {"range": {"@timestamp": {"gte": "now-24h"}}}
        ]
      }
    },
    "sort": [{"@timestamp": "desc"}],
    "_source": ["@timestamp", "appId", "conversationId", "agent.step.finish.cacheWriteTokens", "agent.step.finish.cacheReadTokens"]
  }'
```

## Expected Patterns (Post-Fix)

### Healthy cache behavior
- **Turn 1:** cacheWriteTokens ~40-50K, cacheReadTokens 0
- **Turn 2+:** cacheWriteTokens <500, cacheReadTokens ~40-50K
- **Cache hit rate:** 0% turn 1, 95-99%+ turn 2+

### Cache invalidation triggers (expected)
- Package.json modified (dependency added/removed)
- Color scheme changed via app plan
- First conversation turn in a session

### Cache invalidation triggers (bugs to investigate)
- File writes in preview directory
- Secrets added/removed (should NOT invalidate - now after_history)
- Media slots updated (should NOT invalidate - now after_history)
- Directory structure changes (should NOT invalidate - no longer in context)

## Cost Impact Analysis

### Calculate savings
```
cache_read_tokens = sum(agent.step.finish.cacheReadTokens)
cache_write_tokens = sum(agent.step.finish.cacheWriteTokens)

# Anthropic pricing (March 2026)
# Cache write: $3.75 per 1M tokens
# Cache read: $0.30 per 1M tokens
# Regular input: $3.00 per 1M tokens

savings_per_1M_reads = (3.00 - 0.30) = $2.70
cost_per_1M_writes = 3.75

total_savings = (cache_read_tokens / 1_000_000 * 2.70) - (cache_write_tokens / 1_000_000 * 3.75)
```

### Expected impact from file listing removal
- **Before:** ~40-50K write tokens per turn (cache invalidated on file changes)
- **After:** ~147-455 write tokens per turn (stable prefix unchanged)
- **Reduction:** ~97% fewer write tokens (~40K → ~400 tokens)

## Alerting Recommendations

### Critical alerts
- Cache hit rate <80% for 15+ minutes (indicates widespread invalidation)
- Average cacheWriteTokens >5K per turn (should be <500 after first turn)

### Warning alerts
- Cache hit rate <90% for any app over 1 hour
- Individual cacheWriteTokens >10K on non-first turns

### Info alerts
- Context size growth >50% week-over-week (monitor context bloat)
- New apps with unusual cache patterns

## Troubleshooting

### Low cache hit rate
1. Check recent code changes to AppContextManager or context-normalization
2. Verify insertionOrder on all context messages
3. Check for dynamic data in stable context (timestamps, counters, etc.)
4. Review app.context.generate.success events for size changes

### High cache write tokens
1. Identify which apps have high writes
2. Check conversation logs for those apps
3. Look for patterns in user actions (file writes, secret updates, etc.)
4. Verify cache breakpoint placement in logs

### Unexpected invalidation
1. Find the turn with high cacheWriteTokens
2. Compare app.context.generate.success before and after
3. Check git diff for file changes in preview directory
4. Review secret/media slot updates around that timestamp
