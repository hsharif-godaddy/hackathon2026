# Investigate Production Issue Skill

Systematically investigate Airo Builder production issues using logs and codebase analysis. Logs live in **two** stores: customer-app container logs (agent, preview, publish, dev-supervisor) in **Grafana Loki** (LogQL); the Katana BFF (`app/`/website, server-side) and browser client (`client.*`) logs in **ESSP/Elastic**.

## Setup

### Loki (backend services — the default)

Each person generates their **own** Grafana service-account token (Grafana UI → Administration → Service accounts, with read access to the Loki datasource) and stores it securely — export it from your shell profile or a secrets manager, never commit it. The skill and `scripts/loki-query.sh` use it as Bearer auth against the Loki datasource proxy:

```bash
export GRAFANA_API_TOKEN="your_grafana_service_account_token"
```

Override the endpoint only if needed (defaults to the prod Loki datasource):

```bash
export LOKI_PROXY="https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/query_range"
```

### ESSP/Elastic (builder-frontend only)

Authenticate to AWS SSO first, then fetch credentials:

```bash
aws sso login --profile airobuild-dev-private-sso   # or airobuild-prod-sso
scripts/essp-creds.sh dev|prod    # writes /tmp/essp-creds-<env>.env + /tmp/essp-query-<env>.sh
```

## Quick Start

```
/investigate-production-issue
```

Follow the interactive prompts. Or query Loki directly:

```bash
scripts/loki-query.sh -c <cell> -a <app_id> -m '<error_substring>' --since 6h | jq -r '[.timestamp, .level, .event, .message] | @tsv'
scripts/loki-query.sh --help
```

## Example Investigation

```
You: /investigate-production-issue

Skill: What error message or pattern should I search for?
You: publish.timeout

Skill: What's the affected resource ID (app_id, etc)?
You: mkoecwqlky

Skill: Time range? (default: last 24h)
You: 2026-02-22T06:00:00Z to 2026-02-22T07:00:00Z

Skill: Which service/job? (airo-agents, airo-preview-application, airo-publish-application, ...)
You: airo-agents

[Investigation runs through 6 phases; generates investigation-<timestamp>.md]
```

## Advanced Usage

### Provide Parameters Upfront

```
/investigate-production-issue error="publish.timeout" appId="mkoecwqlky" job="airo-agents" timeRange="2026-02-22T06:00:00Z,2026-02-22T07:00:00Z"
```

### Skip / Rerun Phases

- "validation_failed, I already know it's in dev-supervisor/api.go:164, skip to Phase 4"
- "Rerun Phase 2 with a wider time range"

## Investigation Phases

1. **Error Discovery** — find and classify errors in logs
2. **Pattern Analysis** — compare failed vs successful requests
3. **Code Analysis** — locate and understand the failing logic
4. **Historical Analysis** — trace git history and deploy correlation
5. **Impact Assessment** — count affected apps and errors (client-side)
6. **Report Generation** — comprehensive investigation report

## Tips

- **Start broad, then narrow.** General search first, refine on findings.
- **Compare success vs failure.** The diff reveals the issue.
- **Check deploy correlation.** Spikes often follow a deploy — group by the build/deploy field.
- **Aggregate client-side.** Server-side LogQL aggregation over high-volume streams trips Loki's ~30s timeout (502); pull raw lines (capped by `--limit`) and aggregate with `jq`.
- **`app_id` is structured metadata** (added 5/28/26). Filter it with `-a` (builds `| app_id = "<id>"` — exact and indexed, not a substring scan); absent on system/pre-start lines.
- **Scope by cell** with `-c c37` when you know it — narrows the streams and speeds the query. Cells are `c1`–`c41`. Retention is **14 days**.

## Troubleshooting

### Loki query fails or returns nothing
- Confirm `GRAFANA_API_TOKEN` is set and unexpired.
- Confirm the `job` label for the service (`airo-agents`, `airo-preview-application`, `airo-publish-application`, …; the develop-env agent is `-j airo-agents -e dev`); read one line to inspect fields: `scripts/loki-query.sh -j <job> --since 1h --limit 1 | jq 'keys'`. List all job labels: `curl -sS -H "Authorization: Bearer $GRAFANA_API_TOKEN" "https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/label/job/values" | jq -r '.data[]'`.
- Widen `--since` (errors may be outside the window).
- A 502 usually means an aggregation query timed out — switch to raw lines + client-side `jq`.

### Git history missing
- Ensure you're in the repo; the file may have been renamed (`git log --follow`); the commit may be on another branch.

## Example Queries

```bash
# All error lines for an app, last 24h
scripts/loki-query.sh -a mkoecwqlky -m '"level":"error"' --since 24h

# A specific event on the develop-env agent, raw envelope
scripts/loki-query.sh -j airo-agents -e dev -m sse.stream.premature_close --since 1d --raw

# Errors per hour (client-side bucketing)
scripts/loki-query.sh -m publish.timeout --since 24h --limit 5000 --ts | awk '{print substr($1,1,13)}' | sort | uniq -c

# Distinct affected apps
scripts/loki-query.sh -m publish.timeout --since 7d --limit 5000 | jq -r '.app_id' | sort -u | wc -l
```

### Builder-frontend (ESSP/Elastic)

```bash
scripts/essp-creds.sh prod
/tmp/essp-query-prod.sh '/.ds-logs-gdelastic.katana.<app>-prod-*/_search' -d '{"query":{"match_phrase":{"message":"<error>"}},"size":20}'
```

Client logs ship prefixed `client.` and only at warn/error (info dropped) — frontend recovery-success rates are not computable from logs alone.

## Version History

- v2.0.0 — retargeted to Grafana Loki (LogQL via `scripts/loki-query.sh`); Elastic demoted to the builder-frontend appendix; client-side aggregation guidance for the ~30s Loki timeout.
- v1.0.0 (2026-02-23) — initial Elasticsearch-based 6-phase framework.
