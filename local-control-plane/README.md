# local-control-plane

Local development replacement for the mgmt-airo control plane. Provides the same REST API surface as the production mgmt-airo service, backed by SQLite and Docker Compose instead of MySQL and Nomad.

This means `app/` always uses the same V2 code path locally and in production -- only the `MGMT_AIRO_BASE_URL` differs.

## Quick Start

### Prerequisites

- Go 1.25 or later
- Docker (for managing app containers)
- gofumpt (`go install mvdan.cc/gofumpt@latest`, for `make fmt`)
- golangci-lint (for linting)

### Build and Run

```bash
# Build the binary
make build

# Build and run
make run

# Run tests
make test

# Run all checks (fmt, vet, lint, test)
make check
```

The server starts on port **4100** by default.

## Configuration

| Variable           | Default                  | Description                            |
| ------------------ | ------------------------ | -------------------------------------- |
| `PORT`             | `4100`                   | HTTP server port                       |
| `APPS_BASE_DIR`    | `/tmp/airo-app-builder`  | Base directory for app workspaces      |
| `APP_TEMPLATE_DIR` | `../app-templates/v8`    | Path to app template                   |
| `DB_PATH`          | `local-control-plane.db` | SQLite database path                   |
| `PROJECT_ROOT`     | `..`                     | Project root for Docker build contexts |

## Architecture

```
local-control-plane/
├── cmd/server/main.go               # Entry point, HTTP server
├── internal/
│   ├── api/                          # HTTP handlers (apps, jobs, secrets, etc.)
│   ├── auth/                         # JWT signing for agent registration
│   ├── docker/                       # Docker Compose generation, execution, MySQL provisioning
│   ├── store/                        # SQLite storage layer and data models
│   └── setup/                        # Template copying, git init, alloc/config.json
├── Makefile
├── .golangci.yml
└── go.mod
```

All routes are under `/api/airo/v1/` and implement the mgmt-airo API used by `AiroMgmtClient` in `app/src/lib/mgmt-airo/client.ts`.

No authentication is enforced. All requests use a default dev customer ID.

## Logs

All `slog` output is written to `local-control-plane/dev.log` alongside stdout. The file is truncated on each restart.

## Development

```bash
make fmt-fix        # Format all files (gofumpt)
make vet            # Go vet
make lint           # golangci-lint
make test           # Run tests
make check          # All of the above
```

See [CLAUDE.md](CLAUDE.md) for conventions, full directory tree, and integration details.
