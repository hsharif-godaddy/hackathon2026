# Budget Service

Go HTTP API (Postgres-backed) for budgets, LLM sessions, session spend lines, session reports (reconciliation), products, and outbound webhooks.
Standalone service with its own deploy pipeline — not part of the agents/app/preview/publish runtime.

## Documentation

**Spec and architecture**

- [OpenAPI Spec](internal/openapi/openapi.yaml) — served at `/openapi.yaml`, Swagger UI at `/swagger/`
- [Budget Service Spec](docs/budget-service-spec.md) — flow, numbers, overage semantics, money in JSON, REST behavior
- [Endpoint Data Flow](docs/endpoint-data-flow.md) — end-to-end walkthrough with concrete request/response bodies
- [Service Architecture](docs/service-architecture.md) — context diagram, request flow, write path, webhook delivery, endpoint-to-table map
- [Database Schema](docs/database-schema.md) — current tables, columns, triggers, indexes
- [Database Design](docs/database-design.md) — rationale: ledger model, hybrid resets, soft-delete, history, migration policy
- [Threat Model](docs/threat-model.md) — STRIDE summary, JWT vs row-level access
- [Webhooks](docs/webhooks.md) — events, outbox, retries, URL rules

**Operations**

- [Configuration](docs/configuration.md) — full env-var reference
- [Observability](docs/observability.md) — logs, dashboards, OpenTelemetry
- [DevOps](docs/devops.md) — deploy, rollback, incident response
- [Alerts](docs/alerts.md) — alarm rules, triage steps, mitigation

**Development**

- [Local Development](docs/local-development.md) — run, build, JFrog Artifactory, JWT minting, Postgres
- [Local E2E](docs/local-e2e.md) — Docker webhook sink, scripted flow, dev UI
- [Testing](docs/testing.md) — strategy, CI jobs, running tests
- [Load Tests](load-test/README.md) — k6 scenarios for contention, throughput, and lifecycle

## Quick start

Launch the service locally with a test Postgres instance and auth disabled:

```bash
export DATABASE_URL='postgres://budget:budget@localhost:5432/budget_test?sslmode=disable'
export LOCAL_AUTH_DISABLE=true
make up     # Launch local Postgres
make dev    # Launch service with Air hot-reload; sources .env.local / .env
# Open http://localhost:8080/swagger/
```

In a separate terminal, launch the Dev UI that proxies to the local service:

```bash
make dev-budget-ui
# Open http://localhost:9980/ (default DEV_BUDGET_UI_ADDR)
```

For setup details (JFrog Artifactory, JWT minting, Postgres baseline, Makefile targets), see [Local Development](docs/local-development.md).

### Essential env vars

| Variable             | Notes                                                                                   |
|----------------------|-----------------------------------------------------------------------------------------|
| `DATABASE_URL`       | If unset, `Store` is nil: `/health` reports DB unconfigured; write paths return 503     |
| `LOCAL_AUTH_DISABLE` | Skip JWT (local dev only). When unset, `SSO_HOST` and the auth allowlists are required  |

Full reference — server, auth, database, HTTP, worker, outbox, OpenTelemetry — in [Configuration](docs/configuration.md).

## Layout

```
cmd/server/                                       # Service entry point
cmd/{mint-cert-jwt,mint-iam-jwt,dev-budget-ui}/   # Local dev tools
internal/api/                                     # HTTP handlers, routing, validation
internal/auth/                                    # gd-auth-lib wrapper
internal/store/                                   # Postgres data access (the "Store" interface)
internal/worker/                                  # Background worker: resets, expirations, webhook delivery
internal/credits/                                 # Money <-> credits math
internal/config/                                  # Env-driven Config struct (server, DB pool, TLS)
internal/migrate/                                 # golang-migrate runner (embedded SQL)
internal/observability/                           # OpenTelemetry registration (DB pool metrics)
internal/openapi/                                 # Embedded OpenAPI spec + Swagger UI handler
migrations/                                       # Embedded SQL (golang-migrate)
```
