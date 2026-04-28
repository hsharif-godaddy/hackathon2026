# budget-service

HTTP API for budgets, LLM sessions, session spend lines, session reports (reconciliation), products, and outbound webhooks.

- **Spec (flow, numbers, routes):** [`docs/budget-service-spec.md`](docs/budget-service-spec.md)
- **OpenAPI / Swagger:** [`internal/openapi/openapi.yaml`](internal/openapi/openapi.yaml) — `GET /openapi.yaml` (raw YAML), `GET /swagger/` (Swagger UI). Same host, **no auth** on those routes; **`/api/v1/*` still uses JWT** for actual API calls (use Authorize in Swagger or `LOCAL_AUTH_DISABLE=true` locally).
- **Auth:** Uses `gd-auth-lib` (via `internal/auth`). By default `/api/v1/*` uses **`AuthenticateAWSIAMService`** — AWS IAM, Cert, or Cert2S JWT via **`Authorization: Bearer`** or **`Authorization: sso-jwt`**. The middleware does **not** read the **`auth_idp`** cookie. Set **`LOCAL_AUTH_DISABLE=true`** (local only) to skip JWT validation and omit allowlists. With JWT auth enabled, **`AUTH_ALLOWED_ROLES`** and **`AUTH_ALLOWED_CERTS`** must both be set (non-empty); the process exits at startup otherwise (see [Environment](#environment)).
- **Database:** Optional. If `DATABASE_URL` is unset, `Store` is nil: `/health` reports DB unconfigured; budget/product/webhook handlers return 503 on write paths.
- **Local E2E:** [docs/local-e2e.md](docs/local-e2e.md) — Docker profile `e2e` (webhook sink), `make e2e-local`, optional `make dev-budget-ui` (proxied CRUD UI). Not used in production.

## Documentation

**Security and architecture**

- [Threat model](docs/threat-model.md) — STRIDE summary, assets, trust boundaries, JWT vs row-level access.
- [Service architecture](docs/service-architecture.md) — context diagram (Mermaid).
- [Database schema (summary)](docs/database-schema.md) — table inventory and sensitivity; full detail in [database-design.md](docs/database-design.md).
- [Endpoint data flow](docs/endpoint-data-flow.md) — middleware path and endpoint-to-table map.

**Reference**

- [budget-service-spec.md](docs/budget-service-spec.md) — flows, numbers, REST behavior.
- [Webhooks](docs/webhooks.md) — events, outbox, retries, URL rules.
- [Local E2E](docs/local-e2e.md), [DevOps](docs/devops.md).
- OpenAPI: [`internal/openapi/openapi.yaml`](internal/openapi/openapi.yaml) (`GET /openapi.yaml`, `GET /swagger/`).

## Observability

- **Logs:** Structured JSON to **stdout** via `log/slog` (same idea as `knowledge-service`). Default level is **info**. The logger is configured from **`LOG_LEVEL`** before config load so early failures (e.g. invalid env) still emit JSON on stdout.
- **HTTP access:** The mux router is wrapped so **every response** (including **404** / **405** and OpenAPI routes) emits **`http.request.complete`** with `method`, `path`, `status`, `durationMs`, `userAgent`. Path and user-agent are sanitized and truncated for log safety. Set **`LOG_REQUEST_BODIES=true`** to also log **`requestBody`** for **POST** and **PATCH** (sanitized, 64KiB rune cap; opt-in to avoid shipping large or sensitive payloads by default).
- **Session report (reconciliation):** When **`POST /api/v1/sessions/{sessionId}/reports`** returns **201** with the **full report JSON** (the usual path: report is stored, session report is loaded, and the response is built), the service emits **`budget.session.report.success`** with **`productKey`**, **`budgetId`**, **`sessionId`**, **`reportId`**, string **`productCostTotal`** and **`budgetCostTotal`** (same fixed-scale formatting as the API), and numeric **`productCostTotalUsd`** / **`budgetCostTotalUsd`** for Kibana sum / time-series. If the report is persisted but loading or building the full response fails, the handler can still return **201** with only **`budgetId`**, **`sessionId`**, and **`reportId`**; that path **does not** emit this line (see error logs **`budget.post_session_report_get`** / **`budget.post_session_report_response`**).
- **Shutdown:** `SIGINT` / `SIGTERM` triggers graceful **`http.Server.Shutdown`** (15s timeout).

## Session API (routing vs create)

- **`GET` / `PATCH` / session reports** use **`/api/v1/sessions/{sessionId}`** (and `.../reports/...`) only — no `budgetId` in the path; the service resolves the budget from the session row.
- **`POST /api/v1/sessions`** still requires **`budgetId` in the JSON body** because `budget_sessions.budget_id` is non-null at insert time. Dropping `budgetId` from clients would need a product decision (e.g. nullable `budget_id`, or server-derived budget from auth/context) plus schema and OpenAPI updates.

## API summary

| Method                    | Path                                                             | Notes                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                     | `/openapi.yaml`                                                  | OpenAPI 3 spec; no auth                                                                                                                                                               |
| `GET`                     | `/swagger/`, `/swagger`                                          | Swagger UI → `/openapi.yaml`; no auth                                                                                                                                                 |
| `GET`, `HEAD`             | `/health`                                                        | No auth                                                                                                                                                                               |
| `GET`                     | `/api/v1/auth-check`                                             | Auth probe                                                                                                                                                                            |
| `GET`, `POST`             | `/api/v1/products`                                               | POST revives soft-deleted key when safe; else 409                                                                                                                                     |
| `DELETE`                  | `/api/v1/products/{productKey}`                                  | 409 if active budgets reference product                                                                                                                                               |
| `POST`                    | `/api/v1/webhooks`                                               | Register webhook; response matches webhook GET                                                                                                                                        |
| `GET`, `DELETE`           | `/api/v1/webhooks/{webhookId}`                                   | DELETE soft-deletes webhook row                                                                                                                                                       |
| `POST`                    | `/api/v1/budgets`                                                | Response matches budget GET                                                                                                                                                           |
| `GET`, `PATCH`, `DELETE`  | `/api/v1/budgets/{budgetId}`                                     | DELETE soft-deletes; 409 if open sessions                                                                                                                                             |
| `POST`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}/budget-items`, `.../{budgetItemId}`  | POST/PATCH responses match item GET                                                                                                                                                   |
| `POST`                    | `/api/v1/sessions`                                               | Body: `budgetId`; response matches session GET                                                                                                                                        |
| `GET`, `PATCH`            | `/api/v1/sessions/{sessionId}`                                   | PATCH response matches GET; GET 404 when closed                                                                                                                                       |
| `POST`, `GET`             | `/api/v1/sessions/{sessionId}/reports`, `.../reports/{reportId}` | POST response matches report GET                                                                                                                                                      |
| `GET`                     | `/api/v1/reports`                                                | Filter, pagination, summary row per item (ids + `productKey` + `createdAt`)                                                                                                           |
| `GET`                     | `/api/v1/reports/aggregate`                                      | Sums `budgetCost` / `productCost` over `report` `created_at` (`from`/`to` or default last month). **At least one** of `productKey` and `label` (optionally both; each max 256 chars). |

Successful write endpoints (`POST`/`PATCH`) return the same payload format as the corresponding resource `GET`.

**Money in JSON:** `creditsTotal`, `cost`, costs in report lines, etc. are strings in responses (6 decimal places). Requests often accept **string or number** for those fields (`flexAmount`). **`costToCreditRatio`** is **USD per credit** (same as stored **`cost_credit_ratio`**); **credits used** = `budget_cost_usd / cost_credit_ratio` (see `internal/credits`).

## Run

```bash
cd budget-service
# Server loads `.env` from cwd (process env wins).
go run ./cmd/server
# or
make build && ./bin/budget-service
# or hot reload (sources `.env.local` or `.env` for the air parent process)
make dev
```

### Private modules (JFrog Artifactory)

`github.com/gdcorp-identity/*` resolves through GoDaddy's Artifactory Go virtual repo (`go-virt`), same as [`Dockerfile`](Dockerfile) builds. To match **`go.sum`** checksums, use that proxy (not a direct Git fetch) and skip the public sum DB for those paths.

**Recommended — persist for all `go` commands on this machine** (writes `go env GOENV`, usually under your user config dir; no shell variable expansion, so embed the token in `GOPROXY`):

```bash
go env -w GOPROXY='https://:YOUR_JFROG_TOKEN@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct'
go env -w GONOPROXY=none
go env -w GONOSUMDB='github.com/gdcorp-identity/*'
go env -u GOPRIVATE
```

Use a real JFrog identity token for `YOUR_JFROG_TOKEN`. If you previously set `GOPRIVATE` for `gdcorp-identity`, clear it (`go env -u GOPRIVATE`); leaving it set can pull different zips than CI and cause **checksum mismatch** against `go.sum`.

Inspect or clear: `go env GOPROXY GONOPROXY GOPRIVATE GONOSUMDB`, `go env -u GOPROXY`, etc.

**Shell alternative:** export the same variables in `~/.zshrc` (or source a gitignored file). **`make dev`** sources **`.env.local`** or **`.env`** for the Air parent process (handy for `GOPROXY` and related vars). **`make build`** and **`make test`** do not load `.env` — export vars in the shell or prefix the command. **`make dev-budget-ui`** sources **`.env.local`** or **`.env`** (same as **`make dev`**), so `BUDGET_SERVICE_URL` there is picked up. Raw **`go run ./cmd/dev-budget-ui`** does not. The **`go`** toolchain does not read `.env` by itself; `go env -w` or exported env applies to every module download.

## Testing JWT locally

Server: `SSO_HOST` (unless `LOCAL_AUTH_DISABLE=true`), then `go run ./cmd/server`.

```bash
curl -sS -H "Authorization: sso-jwt YOUR_JWT" "http://localhost:8080/api/v1/auth-check"
```

With **`LOG_LEVEL=debug`**, look for **`branch=sso_service_bearer`** / **`sso_service_sso_jwt`** and **`domain=sso_service`** in auth-related slog output.

### Cert JWT (`cmd/mint-cert-jwt`)

PEM cert/key under **`./.certs/`** (gitignored). **`SSO_HOST`** must match the server.

- **`CERT_PEM_PATH`**, **`CERT_KEY_PATH`**

```bash
cd budget-service
TOKEN="$(go run ./cmd/mint-cert-jwt)"
curl -sS -H "Authorization: sso-jwt $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

`gdmock`-signed tokens do not validate against real **`gdsso`**.

### IAM JWT (`cmd/mint-iam-jwt`)

Run from **`budget-service`** so **`.env`** loads (`godotenv`). Required: **`SSO_HOST`**. Optional: **`AWS_PROFILE`** (or other AWS credential chain config).

```bash
aws sso login --profile airobuild-dev-private-sso
export AWS_PROFILE=airobuild-dev-private-sso
# JFrog / module proxy: configure once via go env -w (see "Private modules" above).

TOKEN="$(go run ./cmd/mint-iam-jwt)"
curl -sS -H "Authorization: sso-jwt $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

**All-in-one check** (STS identity, mint, `GET /api/v1/auth-check`): after `aws sso login`, run from `budget-service/`

`./scripts/verify-iam-auth.sh` or `AWS_PROFILE=your-profile ./scripts/verify-iam-auth.sh`. Optional: `-p profile`, `-u baseUrl` (or `BUDGET_SERVICE_URL`), `-r <role-arn>` to `sts assume-role` first. Same env as the server: `LOCAL_AUTH_DISABLE` off, `SSO_HOST` in `.env`, non-empty `AUTH_ALLOWED_ROLES` / `AUTH_ALLOWED_CERTS`, and roles including the minted role. `make verify-iam-auth` runs the script (env-only flags; use the script for `-p`/`-r`).

## Environment

| Variable                              | Default | Notes                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUDGET_SERVICE_ADDR`                 | `:8080` | Listen address                                                                                                                                                                                                                                                                                                                                                      |
| `LOCAL_AUTH_DISABLE`                  | —       | `true`/`1`/`yes`/`on` skips JWT (local dev only). See [local E2E](docs/local-e2e.md#quick-start-auth-disabled).                                                                                                                                                                                                                                                     |
| `AUTH_ALLOWED_ROLES`                  | —       | **Required** when JWT auth is enabled (`LOCAL_AUTH_DISABLE` unset/false): non-empty JSON array of IAM role ARN patterns (no empty strings). Supports exact match and trailing `*` (e.g. `["arn:aws:iam::123:role/airo-*"]`). With `LOCAL_AUTH_DISABLE=true`, unset/empty is allowed for local open API; values are still parsed—malformed JSON still fails startup. |
| `AUTH_ALLOWED_CERTS`                  | —       | **Required** when JWT auth is enabled: non-empty JSON array of cert CommonName patterns (no empty strings). Supports exact match and trailing `*` (e.g. `["airo-builder.godaddy.com/*"]`). Same local-dev vs parsing behavior as `AUTH_ALLOWED_ROLES`.                                                                                                              |
| `LOG_LEVEL`                           | `info`  | slog level for the process: `debug` / `info` / `warn` / `error` (includes auth middleware noise when `debug`)                                                                                                                                                                                                                                                       |
| `LOG_REQUEST_BODIES`                  | `false` | Log sanitized request bodies for POST/PATCH in `http.request.complete` (64 KiB cap)                                                                                                                                                                                                                                                                                 |
| `SSO_HOST`                            | —       | Required when auth enabled; e.g. `sso.dev-godaddy.com`. See [local E2E](docs/local-e2e.md#optional-jwt-prod-like-auth).                                                                                                                                                                                                                                             |
| `AWS_PROFILE`                         | —       | **`mint-iam-jwt`** / AWS CLI                                                                                                                                                                                                                                                                                                                                        |
| `CERT_PEM_PATH`, `CERT_KEY_PATH`      | —       | **`mint-cert-jwt` only**                                                                                                                                                                                                                                                                                                                                            |
| `DATABASE_URL`                        | —       | If unset, no Store. See [database design](docs/database-design.md#migration) and [local E2E](docs/local-e2e.md).                                                                                                                                                                                                                                                    |
| `AUTO_MIGRATE`                        | —       | If unset and `DATABASE_URL` is set, **on**: run golang-migrate after ping. Set `false` to skip. See [migration](docs/database-design.md#migration).                                                                                                                                                                                                                 |
| `MIGRATE_DATABASE_URL`                | —       | Optional DDL-capable DSN for migrations only; requires `DATABASE_URL` for the app pool. See [migration](docs/database-design.md#migration).                                                                                                                                                                                                                         |
| `DB_MAX_OPEN_CONNS`                   | `25`    |                                                                                                                                                                                                                                                                                                                                                                     |
| `DB_MAX_IDLE_CONNS`                   | `5`     |                                                                                                                                                                                                                                                                                                                                                                     |
| `DB_CONN_MAX_LIFETIME`                | `5m`    | Go duration                                                                                                                                                                                                                                                                                                                                                         |
| `SERVER_CERT_PATH`, `SERVER_KEY_PATH` | —       | Both or neither → TLS                                                                                                                                                                                                                                                                                                                                               |
| `HTTP_READ_TIMEOUT`                   | `30s`   |                                                                                                                                                                                                                                                                                                                                                                     |
| `HTTP_WRITE_TIMEOUT`                  | `60s`   |                                                                                                                                                                                                                                                                                                                                                                     |
| `HTTP_IDLE_TIMEOUT`                   | `120s`  |                                                                                                                                                                                                                                                                                                                                                                     |
| `WORKER_ENABLED`                      | `true`  | Enable/disable the background worker (resets, expirations, webhook delivery). See [webhooks](docs/webhooks.md#background-worker).                                                                                                                                                                                                                                   |
| `WORKER_INTERVAL`                     | `1m`    | Background worker processing interval. See [webhooks](docs/webhooks.md#background-worker).                                                                                                                                                                                                                                                                          |
| `WORKER_BATCH_SIZE`                   | `500`   | Max items per worker processing cycle. See [webhooks](docs/webhooks.md#background-worker).                                                                                                                                                                                                                                                                          |
| `OUTBOX_MAX_ATTEMPTS`                 | `7`     | Maximum webhook delivery attempts before marking failed. See [webhooks](docs/webhooks.md#retry-strategy).                                                                                                                                                                                                                                                           |
| `OUTBOX_DRAIN_BATCH_SIZE`             | `100`   | Webhook events processed per outbox drain cycle. See [webhooks](docs/webhooks.md#outbox-configuration).                                                                                                                                                                                                                                                             |
| `OUTBOX_RETENTION_DAYS`               | `7`     | Days to keep completed/failed outbox events. See [webhooks](docs/webhooks.md#outbox-configuration).                                                                                                                                                                                                                                                                 |

## Postgres

`make up` starts Postgres 15 (`budget` / `budget_test` on `localhost:5432`) from the official `postgres:15` image. The database starts **empty**; run the server with `DATABASE_URL` set (or integration tests with `TEST_DATABASE_URL`) so **golang-migrate** applies embedded SQL from [`migrations/`](migrations/) after a successful ping (`schema_migrations` tracks versions).

Renewable budget items use **hybrid reset handling**: the Go background worker (`internal/worker`) calls `Store.ProcessDueResetsWithOutbox` on a configurable interval to sweep due rows and write webhook outbox events, while `CreateBudgetSession`, `AppendSessionItems`, and `CreateSessionReport` invoke the SQL function `public.process_due_budget_item_resets` for the target budget in the same transaction before capacity or consumption decisions. Reset credit movement is ledger-backed: due items with positive `credits_used` get a `periodic_reset` ledger entry, while already-zero items simply advance `resets_at`. Older migrations optionally used `pg_cron` when present; [`000009_remove_pg_cron.up.sql`](migrations/000009_remove_pg_cron.up.sql) removed the DB-scheduled job in favor of the worker.

**Existing volumes:** if tables exist but `schema_migrations` was never populated, baseline once (see **Migration** in [docs/database-design.md](docs/database-design.md)) or reset the volume (`make down -v` then `make up`).

**Seed:** `make data` runs `seed/seed_test_data.sql` inside the container (requires schema applied and `make up`).

**Integration:** set `TEST_DATABASE_URL` (tests run `migrate.Up` automatically), optional `make data`. Example: `TestGoCodeSpendMathOverHTTP` in `internal/api/budget_handlers_test.go`.

## Makefile

Targets: `up`, `down`, `logs` (Postgres), `data` (seed), `dev` (Air), `build`, `test`, `clean`, `e2e-up`, `e2e-down`, `e2e-local`, `dev-budget-ui`. See [`Makefile`](Makefile) and [docs/local-e2e.md](docs/local-e2e.md).

## DevOps

Deployment, monitoring, rollbacks, and dashboards: [`docs/devops.md`](docs/devops.md).

## Related

- Auth implementation uses `gd-auth-lib` wrapped by `internal/auth`.
