# budget-service

HTTP API for budgets, LLM sessions, session spend lines, session reports (reconciliation), products, and outbound webhooks.

- **Spec (flow, numbers, routes):** [`docs/budget-service-spec.md`](docs/budget-service-spec.md)
- **Auth:** [`packages/go-auth`](../packages/go-auth). By default `/api/v1/*` uses **`AuthenticateAWSIAMService`** — AWS IAM, Cert, or Cert2S JWT via **`Authorization: Bearer`** or **`Authorization: sso-jwt`**. The middleware does **not** read the **`auth_idp`** cookie. Set **`LOCAL_AUTH_DISABLE=true`** (local only) to skip JWT validation.
- **Database:** Optional. If `DATABASE_URL` is unset, `Store` is nil: `/health` reports DB unconfigured; budget/product/webhook handlers return 503 on write paths.
- **Local E2E:** [docs/local-e2e.md](docs/local-e2e.md) — Docker profile `e2e` (webhook sink), `make e2e-local`, optional `make dev-budget-ui` (proxied CRUD UI). Not used in production.

## API summary

| Method                    | Path                                                            | Notes                                           |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `GET`, `HEAD`             | `/health`                                                       | No auth                                         |
| `GET`                     | `/api/v1/auth-check`                                            | Auth probe                                      |
| `GET`, `POST`             | `/api/v1/products`                                              |                                                 |
| `DELETE`                  | `/api/v1/products/{productKey}`                                 | 409 if active budgets reference product         |
| `POST`                    | `/api/v1/webhooks`                                              | Register webhook; response matches webhook GET  |
| `GET`, `DELETE`           | `/api/v1/webhooks/{webhookId}`                                  | DELETE archives row to `webhooks_history`       |
| `POST`                    | `/api/v1/budgets`                                               | Response matches budget GET                     |
| `GET`, `PATCH`, `DELETE`  | `/api/v1/budgets/{budgetId}`                                    | DELETE 409 if open sessions or session reports  |
| `POST`, `PATCH`, `DELETE` | `/api/v1/budgets/{budgetId}/budget-items`, `.../{budgetItemId}` | POST/PATCH responses match item GET             |
| `POST`                    | `/api/v1/budgets/{budgetId}/sessions`                           | Response matches session GET                    |
| `GET`, `PATCH`            | `/api/v1/budgets/{budgetId}/sessions/{sessionId}`               | PATCH response matches GET; GET 404 when closed |
| `POST`, `GET`             | `.../sessions/{sessionId}/reports`, `.../reports/{reportId}`    | POST response matches report GET                |

Successful write endpoints (`POST`/`PATCH`) return the same payload format as the corresponding resource `GET`.

**Money in JSON:** `creditsTotal`, `cost`, costs in report lines, etc. are strings in responses (6 decimal places). Requests often accept **string or number** for those fields (`flexAmount`). **`costToCreditRatio`** is **USD per credit** (same as stored **`credit_spend_ratio`**); **credits used** = `budget_cost_usd / credit_spend_ratio` (see `internal/credits`).

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

`github.com/gdcorp-golang/*` resolves through GoDaddy’s Artifactory Go virtual repo (`go-virt`), same as [`Dockerfile`](Dockerfile) builds. To match **`go.sum`** checksums, use that proxy (not a direct Git fetch) and skip the public sum DB for those paths.

**Recommended — persist for all `go` commands on this machine** (writes `go env GOENV`, usually under your user config dir; no shell variable expansion, so embed the token in `GOPROXY`):

```bash
go env -w GOPROXY='https://:YOUR_JFROG_TOKEN@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct'
go env -w GONOPROXY=none
go env -w GONOSUMDB='github.com/gdcorp-golang/*'
go env -u GOPRIVATE
```

Use a real JFrog identity token for `YOUR_JFROG_TOKEN`. If you previously set `GOPRIVATE` for `gdcorp-golang`, clear it (`go env -u GOPRIVATE`); leaving it set can pull different zips than CI and cause **checksum mismatch** against `go.sum`.

Inspect or clear: `go env GOPROXY GONOPROXY GOPRIVATE GONOSUMDB`, `go env -u GOPROXY`, etc.

**Shell alternative:** export the same variables in `~/.zshrc` (or source a gitignored file). **`make dev`** sources **`.env.local`** or **`.env`** for the Air parent process (handy for `GOPROXY` and related vars). **`make build`**, **`make test`**, and **`make dev-budget-ui`** do not load `.env` — export vars in the shell or prefix the command. The **`go`** toolchain does not read `.env` by itself; `go env -w` or exported env applies to every module download.

## Testing JWT locally

Server: `SSO_HOST` (unless `LOCAL_AUTH_DISABLE=true`), then `go run ./cmd/server`.

```bash
curl -sS -H "Authorization: Bearer YOUR_JWT" "http://localhost:8080/api/v1/auth-check"
```

With **`AUTH_LOG_LEVEL=debug`**, look for **`branch=sso_service_bearer`** / **`sso_service_sso_jwt`** and **`domain=sso_service`**.

### Cert JWT (`cmd/mint-cert-jwt`)

PEM cert/key under **`./.certs/`** (gitignored). **`SSO_HOST`** must match the server.

- **`CERT_PEM_PATH`**, **`CERT_KEY_PATH`**

```bash
cd budget-service
TOKEN="$(go run ./cmd/mint-cert-jwt)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

`gdmock`-signed tokens do not validate against real **`gdsso`**.

### IAM JWT (`cmd/mint-iam-jwt`)

Run from **`budget-service`** so **`.env`** loads (`godotenv`). Required: **`SSO_HOST`**. Optional: **`IAM_ROLE_ARN`** (`sts:AssumeRole` before exchange), **`AWS_PROFILE`**.

```bash
aws sso login --profile airobuild-dev-private-sso
export AWS_PROFILE=airobuild-dev-private-sso
# JFrog / module proxy: configure once via go env -w (see "Private modules" above).

TOKEN="$(go run ./cmd/mint-iam-jwt)"
curl -sS -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/auth-check"
```

**`IAM_ROLE_ARN`** must be an **IAM role ARN**, not an `sts:...assumed-role/...` session ARN.

## Environment

| Variable                              | Default | Notes                                                                                           |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `BUDGET_SERVICE_ADDR`                 | `:8080` | Listen address                                                                                  |
| `LOCAL_AUTH_DISABLE`                  | —       | `true`/`1`/`yes`/`on` skips JWT (local dev only)                                                |
| `AUTH_LOG_LEVEL`                      | `info`  | `debug` → more `go-auth` slog                                                                   |
| `SSO_HOST`                            | —       | Required when auth enabled; e.g. `sso.dev-godaddy.com`                                          |
| `IAM_ROLE_ARN`                        | —       | **`mint-iam-jwt` only**                                                                         |
| `AWS_PROFILE`                         | —       | **`mint-iam-jwt`** / AWS CLI                                                                    |
| `CERT_PEM_PATH`, `CERT_KEY_PATH`      | —       | **`mint-cert-jwt` only**                                                                        |
| `DATABASE_URL`                        | —       | If unset, no Store                                                                              |
| `AUTO_MIGRATE`                        | —       | If unset and `DATABASE_URL` is set, **on**: run golang-migrate after ping. Set `false` to skip. |
| `MIGRATE_DATABASE_URL`                | —       | Optional DDL-capable DSN for migrations only; requires `DATABASE_URL` for the app pool.         |
| `DB_MAX_OPEN_CONNS`                   | `25`    |                                                                                                 |
| `DB_MAX_IDLE_CONNS`                   | `5`     |                                                                                                 |
| `DB_CONN_MAX_LIFETIME`                | `5m`    | Go duration                                                                                     |
| `SERVER_CERT_PATH`, `SERVER_KEY_PATH` | —       | Both or neither → TLS                                                                           |
| `HTTP_READ_TIMEOUT`                   | `30s`   |                                                                                                 |
| `HTTP_WRITE_TIMEOUT`                  | `60s`   |                                                                                                 |
| `HTTP_IDLE_TIMEOUT`                   | `120s`  |                                                                                                 |
| `WEBHOOK_SECRET`                      | —       | Secret token sent as `X-BMS-Secret` header on webhooks                                          |

## Postgres

`make up` starts Postgres (`budget` / `budget_test` on `localhost:5432`). Local Docker Postgres is built from [`Dockerfile.postgres`](Dockerfile.postgres) with `pg_cron` installed and `shared_preload_libraries=pg_cron`. On a fresh volume, [`docker-entrypoint-initdb.d/001_pg_cron.sql`](docker-entrypoint-initdb.d/001_pg_cron.sql) creates the extension in `budget_test`. The database starts **empty**; run the server with `DATABASE_URL` set (or integration tests with `TEST_DATABASE_URL`) so **golang-migrate** applies embedded SQL from [`migrations/`](migrations/) after a successful ping (`schema_migrations` tracks versions).

Renewable budget items use **hybrid reset handling**. A periodic `pg_cron` job runs `public.process_due_budget_item_resets(NULL, 500)` to sweep due rows in the background, and the service also lazily applies the same reset logic inside `CreateBudgetSession`, `AppendSessionItems`, and `CreateSessionReport` transactions before it checks capacity or allocates credits. Reset credit movement is still ledger-backed: due items with positive `credits_used` get a `periodic_reset` ledger entry, while already-zero items simply advance `resets_at`.

**Existing volumes** from the old `docker-entrypoint-initdb.d` flow: if tables exist but `schema_migrations` was never populated, baseline once (see **Migration** in [docs/database-design.md](docs/database-design.md)) or reset the volume (`make down -v` then `make up`). If the volume predates `pg_cron`, restart Postgres with the new Docker image so `pg_cron` is installed and preloaded, then recreate the volume so [`docker-entrypoint-initdb.d/001_pg_cron.sql`](docker-entrypoint-initdb.d/001_pg_cron.sql) can create the extension during initdb. Recreating the volume also reinitializes the cron setup.

**Seed:** `make data` runs `seed/seed_test_data.sql` inside the container (requires schema applied and `make up`).

**Integration:** set `TEST_DATABASE_URL` (tests run `migrate.Up` automatically), optional `make data`. Example: `TestGoCodeSpendMathOverHTTP` in `internal/api/budget_handlers_test.go`.

## Makefile

Targets: `up`, `down`, `logs` (Postgres), `data` (seed), `dev` (Air), `build`, `test`, `clean`, `e2e-up`, `e2e-down`, `e2e-local`, `dev-budget-ui`. See [`Makefile`](Makefile) and [docs/local-e2e.md](docs/local-e2e.md).

## Related

- Other `go-auth` helpers (`AuthenticateCert`, etc.) live in `packages/go-auth` for other apps.
- Older service: `budget-service/`.
