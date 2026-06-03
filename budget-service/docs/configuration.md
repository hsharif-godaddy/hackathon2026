# Configuration

All runtime configuration is environment-driven. The server loads `.env` from the working directory at startup; process env wins over `.env`. The `go` toolchain itself does not read `.env` — for `make build` / `make test` / raw `go run`, export vars in your shell or prefix the command. `make dev` and `make dev-budget-ui` source `.env.local` then `.env` for the Air parent process.

## Server

| Variable                              | Default | Notes                                      |
|---------------------------------------|---------|--------------------------------------------|
| `BUDGET_SERVICE_ADDR`                 | `:8080` | Listen address                             |
| `SERVER_CERT_PATH`, `SERVER_KEY_PATH` | —       | Both or neither → TLS                      |
| `HTTP_READ_TIMEOUT`                   | `30s`   |                                            |
| `HTTP_WRITE_TIMEOUT`                  | `60s`   |                                            |
| `HTTP_IDLE_TIMEOUT`                   | `120s`  |                                            |
| `GOMEMLIMIT`                          | —       | Go runtime soft memory limit (e.g. `900MiB`). **Set in deployed environments** to ~90% of the container memory limit. See [Observability](observability.md#memory-alerting-and-gomemlimit). |

## Auth

| Variable               | Default | Notes                                                                                                                                                                                                                                                                                                                                                            |
|------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `LOCAL_AUTH_DISABLE`   | —       | `true`/`1`/`yes`/`on` skips JWT (local dev only). See [Local E2E](local-e2e.md#quick-start-auth-disabled).                                                                                                                                                                                                                                                       |
| `AUTH_ALLOWED_ROLES`   | —       | **Required** when JWT auth is enabled (`LOCAL_AUTH_DISABLE` unset/false): non-empty JSON array of IAM role ARN patterns (no empty strings). Supports exact match and trailing `*` (e.g. `["arn:aws:iam::123:role/airo-*"]`). With `LOCAL_AUTH_DISABLE=true`, unset/empty is allowed for local open API; values are still parsed — malformed JSON fails startup. |
| `AUTH_ALLOWED_CERTS`   | —       | **Required** when JWT auth is enabled: non-empty JSON array of cert CommonName patterns (no empty strings). Supports exact match and trailing `*` (e.g. `["airo-builder.godaddy.com/*"]`). Same local-dev / parsing behavior as `AUTH_ALLOWED_ROLES`.                                                                                                            |
| `SSO_HOST`             | —       | Required when auth enabled; e.g. `sso.dev-godaddy.com`. See [Local E2E](local-e2e.md#optional-jwt-prod-like-auth).                                                                                                                                                                                                                                               |
| `AWS_PROFILE`          | —       | Used by `mint-iam-jwt` and the AWS CLI. See [Local Development](local-development.md#iam-jwt).                                                                                                                                                                                                                                                                   |
| `CERT_PEM_PATH`, `CERT_KEY_PATH` | — | Used by `mint-cert-jwt` only. See [Local Development](local-development.md#cert-jwt).                                                                                                                                                                                                                                                                             |

[gd-auth-lib](https://github.com/gdcorp-identity/gd-auth-lib/tree/main/go/gd_auth_lib) (via `internal/auth`) gates `/api/v1/*` with `AuthenticateAWSIAMService` — AWS IAM, Cert, or Cert2S JWT delivered via `Authorization: Bearer` or `Authorization: sso-jwt`. The middleware does **not** read the `auth_idp` cookie. With auth enabled, both allowlists must be non-empty or the process exits at startup.

## Database

| Variable               | Default | Notes                                                                                                                                                                  |
|------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `DATABASE_URL`         | —       | If unset, no Store: `/health` reports DB unconfigured and budget/product/webhook write paths return 503. See [Database Design](database-design.md#migration).         |
| `AUTO_MIGRATE`         | —       | When unset and `DATABASE_URL` is set, **on**: golang-migrate runs after ping. Set `false` to skip. See [Database Design](database-design.md#migration).               |
| `MIGRATE_DATABASE_URL` | —       | Optional DDL-capable DSN for migrations only; requires `DATABASE_URL` for the app pool. See [Database Design](database-design.md#migration).                          |
| `DB_MAX_OPEN_CONNS`    | `50`    |                                                                                                                                                                        |
| `DB_MAX_IDLE_CONNS`    | `25`    |                                                                                                                                                                        |
| `DB_CONN_MAX_LIFETIME` | `5m`    | Go duration                                                                                                                                                            |

## Logging

| Variable             | Default | Notes                                                                                                                                                                |
|----------------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `LOG_LEVEL`          | `info`  | slog level for the process: `debug` / `info` / `warn` / `error` (includes auth middleware noise when `debug`). Configured before config load so early failures still emit JSON. |
| `LOG_REQUEST_BODIES` | `false` | Log sanitized request bodies for POST/PATCH in `http.request.complete` (64 KiB rune cap)                                                                             |
| `AWS_ACCOUNT_ID`     | —       | Populates ECS `cloud.account.id` on `internal/seclog` security events for SIEM attribution. Katana does **not** auto-populate this — set explicitly per environment. Unset in deployed envs (`GD_ENV != "local"`) emits a startup warning; events still flow but without account attribution. |

See [Observability](observability.md#logs) for the structured event names emitted by handlers and middleware.

## Worker (resets, expirations, webhook delivery)

| Variable                  | Default | Notes                                                                                       |
|---------------------------|---------|---------------------------------------------------------------------------------------------|
| `WORKER_ENABLED`          | `true`  | Enable/disable the background worker. See [Webhooks](webhooks.md#background-worker).        |
| `WORKER_INTERVAL`         | `1m`    | Background worker processing interval. See [Webhooks](webhooks.md#background-worker).       |
| `WORKER_BATCH_SIZE`       | `500`   | Max items per worker processing cycle. See [Webhooks](webhooks.md#background-worker).       |
| `OUTBOX_MAX_ATTEMPTS`     | `7`     | Max webhook delivery attempts before marking failed. See [Webhooks](webhooks.md#retry-strategy).            |
| `OUTBOX_DRAIN_BATCH_SIZE` | `100`   | Webhook events processed per outbox drain cycle. See [Webhooks](webhooks.md#transactional-outbox-pattern).    |
| `OUTBOX_RETENTION_DAYS`   | `7`     | Days to keep completed/failed outbox events. See [Webhooks](webhooks.md#transactional-outbox-pattern).        |

For local E2E that asserts webhook delivery, set `WORKER_INTERVAL=5s` so the outbox drains before the script's poll window expires.

## OpenTelemetry

| Variable                       | Default          | Notes                                                                                              |
|--------------------------------|------------------|----------------------------------------------------------------------------------------------------|
| `OTEL_COLLECTOR_OTLP_ENDPOINT` | —                | Collector OTLP endpoint (e.g. `localhost:4318`). Read by `observability-go-otel`.                  |
| `OTEL_COLLECTOR_HEADERS`       | —                | Collector request headers. Read by `observability-go-otel`.                                        |
| `OTEL_COLLECTOR_ENABLED`       | `false`          | Enable/disable telemetry export. Read by `observability-go-otel`.                                  |
| `OTEL_EXPORTER_OTLP_INSECURE`  | —                | Standard OTel SDK var; set `true` for local plaintext collector.                                   |
| `KATANA_APP`                   | `budget-service` | OTel `service.name`. Provided by Katana in deployed environments.                                  |
| `KATANA_ARTIFACT_VERSION`      | `0.0.0`          | OTel `service.version`. Provided by Katana in deployed environments.                               |
| `GD_ENV`                       | `local`          | OTel `deployment.environment`. Provided by Katana in deployed environments.                        |
| `OTEL_CLOUD_PLATFORM`          | `aws_ecs`        | OTel `cloud.platform`.                                                                             |

See [Observability](observability.md) for the full signal list and local collector setup.
