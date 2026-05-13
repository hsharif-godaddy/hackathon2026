# local-control-plane

Fake mgmt-airo API server for local development. Implements the same REST API surface as the production mgmt-airo service, backed by SQLite and Docker Compose instead of MySQL and Nomad.

## Purpose

Replaces all legacy adapter code in `app/` by providing a local HTTP API that the V2 control plane adapter can talk to. This means `app/` always uses the same V2 code path locally and in production -- only the `MGMT_AIRO_BASE_URL` differs.

## Key Commands

```bash
cd local-control-plane
make build          # Build binary to dist/
make run            # Build and run
make test           # Run tests
make lint           # golangci-lint
make check          # All checks (fmt, vet, lint, test)
```

## Configuration

| Variable           | Default                  | Description                            |
| ------------------ | ------------------------ | -------------------------------------- |
| `PORT`             | `4100`                   | HTTP server port                       |
| `APPS_BASE_DIR`    | `/tmp/airo-app-builder`  | Base directory for app workspaces      |
| `APP_TEMPLATE_DIR` | `../app-templates/v8`    | Path to app template                   |
| `DB_PATH`          | `local-control-plane.db` | SQLite database path                   |
| `PROJECT_ROOT`     | `..`                     | Project root for Docker build contexts |
| `AUTH_TYPE`        | `none`                   | `jwt` to enable SSO JWT validation     |
| `SSO_HOST`         | `sso.dev-godaddy.com`    | GoDaddy SSO host for token validation  |

## Architecture

```
cmd/server/main.go       # Entry point, HTTP server
internal/
  api/
    router.go            # Route registration
    customers.go         # GET /customers/me
    subscriptions.go     # Subscription endpoints
    systems.go           # System endpoints
    apps.go              # App CRUD + deploy
    jobs.go              # Job status polling
    secrets.go           # Secrets management
    stubs.go             # Static responses for domains, transfers, etc.
  auth/
    jwt.go               # JWT signing for agent registration
  docker/
    compose.go           # Docker compose YAML generation
    manager.go           # docker compose up/down execution
    mysql.go             # MySQL container provisioning
    ports.go             # Port allocation
  store/
    db.go                # SQLite storage layer
    models.go            # Data models
  setup/
    template.go          # Template copying, git init, alloc/config.json
```

## API Surface

Implements the mgmt-airo API routes used by `AiroMgmtClient` in `app/src/lib/mgmt-airo/client.ts`. All routes are under `/api/airo/v1/`.

Auth: When `AUTH_TYPE=jwt`, SSO tokens are validated and the shopper ID from the token is used as the customer ID (per-request). When `AUTH_TYPE=none` (default), all requests use a fixed customer ID (`local-customer-001`). Each customer ID gets isolated data: subscriptions, apps, plans, credits, grants. The service mints JWTs (via AWS Secrets Manager signing keys) only for outbound agent registration calls.

## Local Dev Logs

All slog output is automatically written to `local-control-plane/dev.log` alongside stdout. The file is truncated on each restart. Use this log to troubleshoot issues — read it to see recent errors, startup failures, or unexpected behavior.

## Prerequisites

- Go 1.25
- Docker (for container management)
- golangci-lint (for `make lint`)

`make fmt` / `make fmt-fix` only need `gofmt -s` from the standard Go toolchain.

## Conventions

- **Logging fields use snake_case** (matching dev-supervisor, not the TypeScript monorepo's camelCase)
- **Structured logging** uses `log/slog`
- **Pure Go** -- no Node.js/pnpm dependencies
