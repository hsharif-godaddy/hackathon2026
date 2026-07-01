---
name: investigate-production-issue
description: Use when investigating a production issue, error spike, regression, or customer-app failure in Airo Builder backend services (agent, preview, publish, dev-supervisor) — searching container logs by app_id/event/error, comparing failed vs successful requests, correlating with deploys, and assessing blast radius. Customer-app container logs live in Grafana Loki (LogQL); the Katana BFF (app/website, server-side) and browser client (client.*) logs live in ESSP/Elastic.
---

# Investigate Production Issue

## Overview

Systematically investigate a production issue by moving logs → code → git history → impact.

Logs are split across **two** stores — pick by where the failure lives:
- **Customer-app containers** (agent, preview, publish, dev-supervisor) → **Grafana Loki**, queried with LogQL via `scripts/loki-query.sh`.
- **The builder app itself** — the Katana BFF (`app/` / website, server-side) **and** its browser client (`client.*`) logs → **ESSP/Elastic** (see the appendix).

When unsure which store: a customer's site/build/publish failure is **Loki**; a failure in the Airo Builder UI, a BFF API request, SSO, or billing is **Elastic**.

## Prerequisites

- `GRAFANA_API_TOKEN` exported (Grafana service-account token; Bearer auth to the Loki proxy).
- `scripts/loki-query.sh` in the airo-app-builder repo (run from repo root).
- Source checkout with git history.
- For the Katana BFF / client logs: `scripts/essp-creds.sh dev|prod` (AWS SSO).

## Credentials

Each person uses their **own** credentials — nothing here is shared or committed:

- **Loki:** generate your own Grafana service-account token (Grafana UI → Administration → Service accounts) with read access to the Loki datasource, then export it as `GRAFANA_API_TOKEN` from your shell profile or a secrets manager. Never commit it. Grafana access requires the `JOMAX\okta_lgtm-grafana_mwpv2_viewer` and `JOMAX\okta_observability_grafana` AD groups.
- **ES/ESSP:** `scripts/essp-creds.sh` pulls credentials from AWS Secrets Manager — authenticate first with `aws sso login --profile airobuild-dev-private-sso` (or `airobuild-prod-sso`). Elastic read access needs the `GD-AWS-USA-CPO-AiroBuilde-ES-non-prod-ReadOnly` / `-prod-ReadOnly` groups.

## Log sources

| Logs | Store | How |
|------|-------|-----|
| Customer-app containers: agent, preview, publish, dev-supervisor | Grafana Loki | `scripts/loki-query.sh` (LogQL) |
| Katana BFF (`app/` / website, server-side) **and** browser client (`client.*`) | ESSP/Elastic (airobuilde cluster) | `scripts/essp-creds.sh` + generated query wrapper |

**Loki label/field notes:**
- Stream selector labels: `job` (equivalently `service_name`), `env` (`dev` | `prod`), and `cluster` (the cell, `c1`–`c41`). **Scope by cell (`-c c37`) whenever you know it** — it narrows the streams and speeds the query. The Airo job/service_name values are `airo-agents`, `airo-preview-application`, `airo-publish-application`, plus supporting workers (`airo-db-init`, `airo-filesystem-worker`, `airo-pre-start`, `airo-secrets-worker`). There is **no** `develop-agent` job — the develop-environment agent is `{job="airo-agents", env="dev"}`. dev-supervisor (PID1) lines appear within the application containers, matched by content rather than a dedicated job. Enumerate live: `curl -sS -H "Authorization: Bearer $GRAFANA_API_TOKEN" "https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/label/job/values" | jq -r '.data[]'`.
- `app_id` is **structured metadata** (added 5/28/26) — filter it with `| app_id = "<id>"` (the `-a` flag), which is exact and indexed, not a substring `|=` scan. It is absent on system/pre-start lines. **Retention is 14 days** — older windows return nothing.
- **Gotcha:** server-side aggregation (`count_over_time`, `quantile_over_time`) over high-volume streams trips Loki's ~30s gateway timeout (502). Pull raw lines (capped by `--limit`) and aggregate client-side with `jq`.

## Log line schema

Every app log line (from the structured logger `logger.<level>("event.name", { data })`) carries these stable top-level fields — no discovery query needed:

| Field | Meaning |
|-------|---------|
| `event` | `domain.operation.lifecycle` name — the primary thing to filter (`-m`) and group on |
| `level` | `info` \| `warn` \| `error` |
| `message` | human-readable message (**not** `msg`) |
| `timestamp` | ISO time (**not** `time`) |
| `data` | structured payload object; app-specific fields live here (camelCase), e.g. `.data.error`, `.data.appId` |
| `component`, `environment`, `version` | emitter context |

Resource/label fields present on every line (for scoping + deploy correlation): `app_id`, `product_id`, `region`, `cell_id`, `container_id`, `com.godaddy.goldencontainers.build-date` (deploy correlation), `com.godaddy.goldencontainers.release`, `com.hashicorp.nomad.alloc_id` / `job_name` / `node_name`. Sparse: `agentId`, `conversationId`, `profile`.

**jq gotcha:** keys with literal dots (`service.name`, `com.godaddy.goldencontainers.build-date`) are flat, not nested — access as `.["service.name"]`, not `.service.name`.

## Querying Loki

Use the helper for everything; it builds the LogQL, converts the time window to nanoseconds, and extracts log lines newest-first:

```bash
# By app_id (structured metadata) + level, scoped to the app's cell, last 6h
scripts/loki-query.sh -j airo-preview-application -c c37 -a mkoecwqlky -m '"level":"error"' --since 6h

# By job + env + event name, wider window, more lines (develop-env agent)
scripts/loki-query.sh -j airo-agents -e dev -m sse.stream.premature_close --since 1d --limit 5000

# Full LogQL for pipeline stages — multi-service, case-insensitive error|warn
scripts/loki-query.sh --since 2h -q '{env="prod",cluster="c37",service_name=~"airo-pre-start|airo-preview-application|airo-publish-application"} | app_id = "mkoecwqlky" |~ `"level":"(?i)(error|warn)"`'
```

Output is one log line per row (mostly JSON) — pipe to `jq`. `--raw` returns the full Loki envelope; `--ts` prefixes UTC timestamps; `--help` lists all flags. To discover the exact field names on a service's lines, read one: `scripts/loki-query.sh -j <job> --since 1h --limit 1 | jq 'keys'`.

For ad-hoc browsing there's a ready-made Grafana dashboard (**airo-agents-log-search**, variables for env/cell/service/level/app_id) and the per-service Explore links in [Airo Builder Logs](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs) (Confluence) — the canonical source for cells, links, and query patterns.

## Investigation Process

### Phase 1: Error Discovery
Gather from the user: error message/pattern, affected `app_id` (or other resource), time range (default 24h), service.

```bash
scripts/loki-query.sh -a <app_id> -m '<error_substring>' --since 24h | jq -r '[.timestamp, .level, .event, .message, (.data.error // "")] | @tsv'
```

Extract event names/types, error fields (`data.error`, `message`), resource ids, timestamps.

### Phase 2: Pattern Analysis
Find successful runs of the same operation and diff the inputs:

```bash
scripts/loki-query.sh -j <job> -m '<same_event>' -m '"level":"info"' --since 24h --limit 50 | jq -c '{app_id, event, wd: .data.working_dir, timeout: .data.timeout}'
```

Build a failed-vs-successful comparison table and identify the differentiating parameter:

```
| Parameter   | Failed | Successful | Difference            |
|-------------|--------|------------|-----------------------|
| working_dir | "."    | "/app"     | relative vs absolute  |
```

### Phase 3: Code Analysis
1. Locate the error text in code (Grep tool, `output_mode: files_with_matches`).
2. Read the validation/error-handling code (Read tool).
3. Trace to the failing condition; state hypothesis + evidence + conclusion.

### Phase 4: Historical Analysis
1. Git history around the error window: `git log --since="<date>" --format="%H %ai %s" -- <file>`
2. Inspect the introducing commit: `git show <hash>:<file>`; `git diff <before> <after> -- <file>`
3. Correlate with deploys: find the build/deploy metadata field on a sample line (`scripts/loki-query.sh -j <job> --since 1h --limit 1 | jq 'keys'`), then group affected lines by it client-side (server-side aggregation will 502 — see Gotcha).

### Phase 5: Impact Assessment
Aggregate client-side (raw lines → `jq`), not server-side:

```bash
# Total matching errors since the bug landed
scripts/loki-query.sh -m '<error_pattern>' --start 2026-02-10T00:00:00Z --limit 5000 | wc -l

# Distinct affected apps
scripts/loki-query.sh -m '<error_pattern>' --since 7d --limit 5000 | jq -r '.app_id' | sort -u | wc -l

# Breakdown by build/deploy field (substitute the field found in Phase 4)
scripts/loki-query.sh -m '<error_pattern>' --since 7d --limit 5000 | jq -r '.["com.godaddy.goldencontainers.build-date"] // "unknown"' | sort | uniq -c | sort -rn
```

If `--limit` is hit, the count is a floor — say so explicitly and widen the limit or narrow the window.

### Phase 6: Report Generation
Save `investigation-<timestamp>.md`:

```markdown
# Production Issue Investigation Report

## Executive Summary
- **Root Cause**: <one line>
- **Introduced In**: <commit> on <date>
- **Fixed In**: <commit> on <date> (or "not yet")
- **Impact**: <N> errors across <M> apps; <K> still on the buggy build

## Technical Details
- **Code Location**: `<file>` — `<function>` (lines <range>)
- **Failure Condition**: <what triggers it>
- **Before / After**: <buggy vs fixed snippet>

## Impact Analysis
- **Timeline**: introduced → first error → fixed → duration
- **Affected Systems**: breakdown by build/deploy field
- **Top Affected Resources**: app_id + error counts

## Recommendations
- **Immediate**: deploy fix, monitor 24h, notify if needed
- **Prevention**: tests covering the failing condition; log the rejected input
- **Monitoring**: alert on the error spike; dashboard for the rate
```

## Common Patterns

| Symptom | Investigation path |
|---------|--------------------|
| `validation_failed` / 4xx | error text → validation function → condition logic |
| Sudden error spike | error timing → deploy/build metadata → config/code diff |
| Errors right after a deploy | error timing → `package.json`/dependency or commit diff |
| Intermittent failures | frequency over time → input/schema analysis |

## Checklist

- [ ] Phase 1: symptoms gathered; Loki searched; key fields + resources extracted
- [ ] Phase 2: successful comparison found; differentiating parameter identified
- [ ] Phase 3: error located in code; failing condition traced; hypothesis tested
- [ ] Phase 4: introducing commit found; before/after compared; correlated with deploy metadata
- [ ] Phase 5: total errors + distinct apps counted client-side; build-field breakdown; limit caveat stated
- [ ] Phase 6: report written with root cause, impact, recommendations

## Appendix: Katana BFF + client logs (ESSP/Elastic)

The builder app's own logs — the Katana BFF (`app/` / website, server-side) and the browser client (`client.*`) — are **not** in Loki; they're in the airobuilde ESSP/Elastic cluster. Fetch credentials and a query wrapper, then search the Elastic indices:

```bash
scripts/essp-creds.sh prod        # writes /tmp/essp-creds-prod.env + /tmp/essp-query-prod.sh
/tmp/essp-query-prod.sh /_cat/indices?v
/tmp/essp-query-prod.sh '/.ds-logs-gdelastic.katana.<app>-prod-*/_search' -d '{"query":{"match_phrase":{"message":"<error>"}},"size":20}'
```

Client logs ship prefixed `client.` and **only at warn/error** (info is dropped), so frontend recovery-success rates are not computable from logs alone.
```
