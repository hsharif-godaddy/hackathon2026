# Observability

## Dashboards

| Environment  | Link                                                                                                                                                                                                                                                                                                         |
|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Prod**     | [Analytics dashboard (prod)](https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io:9243/app/dashboards#/view/1c7154c8-2ed0-4782-a14d-11eece31d1d8?_g=(filters:!(),refreshInterval:(pause:!t,value:60000),time:(from:now-24h%2Fh,to:now)))                                                                    |
| **Prod**     | [Observability dashboard (prod)](https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io/app/apm/services/budget-service/overview?comparisonEnabled=true&environment=ENVIRONMENT_ALL&kuery=&latencyAggregationType=avg&offset=1d&rangeFrom=now-30m&rangeTo=now&serviceGroup=&transactionType=request)         |
| **Non-prod** | [Analytics dashboard (non-prod)](https://airobuilde-non-prod-usw2.kb.us-west-2.aws.found.io:9243/app/dashboards#/view/1c7154c8-2ed0-4782-a14d-11eece31d1d8?_g=(filters:!(),refreshInterval:(pause:!t,value:60000),time:(from:now-24h%2Fh,to:now)))                                                            |
| **Non-prod** | [Observability dashboard (non-prod)](https://airobuilde-non-prod-usw2.kb.us-west-2.aws.found.io/app/apm/services/budget-service/overview?comparisonEnabled=true&environment=ENVIRONMENT_ALL&kuery=&latencyAggregationType=avg&offset=1d&rangeFrom=now-30m&rangeTo=now&serviceGroup=&transactionType=request) |

These dashboards surface the structured JSON logs described below.

## Logs

Structured JSON to **stdout** via `log/slog`. Default level is **info**. The logger is configured from `LOG_LEVEL` before config load so early failures (e.g. invalid env) still emit JSON on stdout.

### HTTP access

The mux router is wrapped so **every response** (including 404 / 405 and OpenAPI routes) emits `http.request.complete` with `method`, `path`, `status`, `durationMs`, `userAgent`. Path and user-agent are sanitized and truncated for log safety. Set `LOG_REQUEST_BODIES=true` to also log `requestBody` for POST and PATCH (sanitized, 64KiB rune cap; opt-in to avoid shipping large or sensitive payloads by default).

### Session report (reconciliation)

When `POST /api/v1/sessions/{sessionId}/reports` returns 201 with the **full report JSON** (the usual path: report is stored, session report is loaded, and the response is built), the service emits `budget.session.report.success` with:

- `productKey`, `budgetId`, `sessionId`, `reportId`
- string `productCostTotal` and `budgetCostTotal` (same fixed-scale formatting as the API)
- numeric `productCostTotalUsd` / `budgetCostTotalUsd` for Kibana sum / time-series

If the report is persisted but loading or building the full response fails, the handler can still return 201 with only `budgetId`, `sessionId`, and `reportId`; that path **does not** emit this line (see error logs `budget.post_session_report_get` / `budget.post_session_report_response`).

### Shutdown

`SIGINT` / `SIGTERM` triggers graceful `http.Server.Shutdown` (15s timeout).

## OpenTelemetry (metrics + traces)

The service integrates [`observability-go-otel`](https://github.com/gdcorp-engineering/observability-go-otel) for metrics and distributed tracing via OTLP. Telemetry is **optional** — the service runs without it if the collector is unreachable or disabled.

### Signals exported

| Signal                  | Source                                     | Notes                                                                                                                     |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| HTTP request metrics    | `otelClient.Metrics.MetricsMiddleware`     | Duration, status, method for all routes                                                                                   |
| HTTP distributed traces | `otelClient.Tracer.TracingMiddleware`      | Span-per-request on all routes                                                                                            |
| Go runtime metrics      | `runtime.Start()`                          | GC, goroutines, memory (OTel runtime instrumentation)                                                                     |
| DB connection pool      | `internal/observability.RegisterDBMetrics` | `db.pool.open_connections`, `db.pool.idle_connections` (gauges); `db.pool.wait_count`, `db.pool.wait_duration` (counters) |

### Resource attributes

Derived from Katana-injected env vars (see [Configuration](configuration.md#opentelemetry)):

| Attribute                  | Source                    |
|----------------------------|---------------------------|
| `service.name`             | `KATANA_APP`              |
| `service.version`          | `KATANA_ARTIFACT_VERSION` |
| `deployment.environment`   | `GD_ENV`                  |
| `cloud.platform`           | `OTEL_CLOUD_PLATFORM`     |

In deployed environments the service exports via OTLP to a sidecar OTel Collector configured by Katana.

## Memory alerting and `GOMEMLIMIT`

Each deployed environment must set the `GOMEMLIMIT` env var (Katana app config) to roughly **90% of the container memory limit** — e.g. `GOMEMLIMIT=1800MiB` for a 2 GiB task. This serves two purposes:

1. **Backpressure before OOM-kill.** Go's runtime aggressively GCs to keep heap usage under the soft limit. Without it, the process happily allocates until the kernel OOM-kills the container, which surfaces as a hard crash rather than a slow-down.
2. **Enables a memory-utilization alert.** The `go.memory.limit` OTel metric reports the value of `GOMEMLIMIT`. When unset, Go reports `math.MaxInt64` (~9.22 × 10¹⁸), which is dropped somewhere in the Elastic OTLP ingest pipeline — so the metric simply doesn't appear in Kibana and you have nothing to compare `go.memory.used` against.

After changing `GOMEMLIMIT` in a Katana environment, confirm via Kibana that `go.memory.limit` shows a sane value (matching the configured limit in bytes). If it's still missing, the env var didn't take effect.

## Local OTel collector

```bash
make otel   # OTLP on :4317 gRPC, :4318 HTTP
```

> `make otel` runs in the foreground. Use a dedicated terminal and start `make dev` in another.

The collector uses a `debug` exporter — received metrics and traces are printed to stdout. To send telemetry from the budget-service, set these in `.env`:

```
OTEL_COLLECTOR_OTLP_ENDPOINT=localhost:4318
OTEL_COLLECTOR_HEADERS=test
OTEL_COLLECTOR_ENABLED=true
OTEL_EXPORTER_OTLP_INSECURE=true
```

Then restart with `make dev`. The collector config is inline in [`docker-compose.yml`](../docker-compose.yml).

## SPAQ

Speed, Security, Performance, Availability, and Quality metrics for the service are tracked in the [SPAQ Hub Dashboard](https://spaq.gdcorp.tools/onboarding/8606/hub/7357).
