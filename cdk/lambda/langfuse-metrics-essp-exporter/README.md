# langfuse-metrics-essp-exporter

Pulls hourly observation metrics from Langfuse and indexes them into the
`langfuse-metrics-hourly` ESSP (Elasticsearch) index. Powers the
**Airo Agents — Operational Health** Kibana dashboard.

## What it does

- A Lambda runs every **5 minutes** (EventBridge cron, defined in
  `cdk/lib/langfuse-metrics-essp-exporter-stack.ts`).
- Each tick pulls a trailing **1-hour window** with **hourly granularity** from
  the Langfuse Metrics API and bulk-upserts it into ES with deterministic doc
  IDs (`sha256(observation_type::name::model::hour)` truncated to 20 hex
  chars). The latest hour bucket is continually re-upserted as more events
  arrive.
- Costs are **not** ingested — this index is for operational health only.

## Layout

```
src/
  handler.ts                 Lambda entry point
  shared.ts                  Query definitions, ES client, merge/derive logic,
                             ES index mapping, ingest() pipeline
  index.ts                   Re-exports handler
scripts/
  backfill-langfuse-to-es.ts CLI: backfill a [START_DATE, END_DATE] range
kibana/
  build-dashboard.py         Generates dashboard.ndjson (Kibana saved objects)
  import.sh                  Imports dashboard.ndjson into Kibana
```

## Secrets

Both reads from AWS Secrets Manager:

| Name                          | Shape                                                                                 | Used by  |
| ----------------------------- | ------------------------------------------------------------------------------------- |----------|
| `langfuse_test`               | JSON: `{ LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY }`               | Lambda   |
| `essp_deployment_credentials` | JSON: `{ url \| ingestion_url, api_key \| ingestion_user / ingestion_user_password }` | Lambda   |

> **Note on `langfuse_test`**: yes, the secret name and the URL contain
> "test". We are still using the test Langfuse cluster as our de-facto prod.
> Do **not** point this at the EventBridge-backed Langfuse "prod" cluster —
> it stores spans/traces in a different shape (different `observation_type`
> values, attribute layout, timestamp semantics). Migration is planned but is
> NOT a simple URL swap; see the comment near `ES_INDEX` in `src/shared.ts`.

## Local development

### Backfill (one-shot)

Required env:

- `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
- `AIRO_BUILDER_ES_ENDPOINT` (or `ES_ENDPOINT`)
- `AIRO_BUILDER_ES_API_KEY` (or `ES_API_KEY`)

Optional: `ES_INDEX` to override the target index.

```bash
cd cdk/lambda/langfuse-metrics-essp-exporter

# 7-day backfill (default)
pnpm backfill-langfuse

# Custom range (UTC dates, end inclusive)
START_DATE=2026-04-15 END_DATE=2026-04-22 pnpm backfill-langfuse

# Dry-run (no ES writes)
DRY_RUN=true pnpm backfill-langfuse
```

### Continuous loop (mirrors deployed Lambda)

A `scripts/run-loop-local.ts` may exist locally (gitignored). Run it via:

```bash
npx tsx scripts/run-loop-local.ts
```

Each tick pulls the trailing 1-hour window and upserts. Stops cleanly on
SIGINT / SIGTERM.

## Kibana dashboard

The dashboard is generated programmatically from `kibana/build-dashboard.py`
(panels, runtime fields, data view, palette, layout) and deployed via the
saved-objects import API.

Required env: `AIRO_BUILDER_ES_ENDPOINT`, `AIRO_BUILDER_ES_API_KEY`.

```bash
cd cdk/lambda/langfuse-metrics-essp-exporter/kibana
./import.sh
```

`import.sh` re-runs `build-dashboard.py` if `dashboard.ndjson` is missing,
then `POST`s to `${KIBANA_URL}/api/saved_objects/_import?overwrite=true`.
The Kibana base URL is derived from `AIRO_BUILDER_ES_ENDPOINT` by swapping
`.es.` → `.kb.` (override with `KIBANA_URL` if needed).

After import:

```
${KIBANA_URL}/app/dashboards#/view/lf-agents-ops
```

Use the time picker to switch between 24h / 7d / 30d / etc.

## Deploying

The CDK stack is `LangfuseMetricsEsspExporterStack`, wired into
`cdk/app/main.ts`. Deploy via the **CDK Workflow** GitHub Action
(`.github/workflows/cdk.yml`) — pick `LangfuseMetricsEsspExporterStack` from
the stack dropdown, or `--all`.

Lambda bundling happens inside the CDK Docker image (`npm install && npm run
build`); no pre-build step needed in CI.

## Operational notes

- Lambda timeout: **2 minutes** (5 sequential Langfuse calls × ~1–3s + bulk
  write).
- Lambda retry attempts: **0** — EventBridge ticks every 5 min so a missed
  tick is recovered on the next one (and the 1-hour trailing window
  re-upserts).
- `bulkIndex` does **not** retry on transient ES errors (only `fetchMetrics`
  retries Langfuse hiccups). Recovery for ES blips relies on the same 5-min
  cron + idempotent doc IDs — the next tick re-upserts the same hour.
- Errors are NOT swallowed — `handler.ts` lets exceptions propagate so
  CloudWatch Lambda `Errors` metric fires (so any future alarm has a real
  signal to bind to).
- Per-bucket row cap: `MAX_ROWS_PER_BUCKET = 200` (`shared.ts`). If
  truncation kicks in, look for `bucket … truncated …` warnings in the logs
  and bump the cap if needed.
