# dev-supervisor

Go-based containerized service acting as PID1 in development Docker containers. Provides process lifecycle management, health monitoring, HTTP/SMTP proxying, JWT authentication, and log streaming via Unix socket API.

**Key characteristics:** Pure Go (no Node.js/pnpm), Go 1.25, cross-platform with Linux-optimized features, statically linked binary.

## Integration with Monorepo

dev-supervisor is called by:

- `app/src/lib/dev-environment/adapters/DockerAppService.ts`
- `app/src/lib/dev-environment/services/docker-compose-generator.ts`

**Socket paths:**

- Container: `/tmp/supervisor/dev-supervisor.sock`
- Host (local dev): `/tmp/dev-supervisor-{dockerSafeId}/dev-supervisor.sock` (mounted to `/tmp/supervisor` in container)
- Configurable: `AIRO_SUPERVISOR_SOCKET_PATH` (v4) or `DEV_SUPERVISOR_SOCKET_PATH` (v3 compat)

**When changing the API:** Update the TypeScript client in `app/src/lib/dev-environment/` and test end-to-end with Docker Compose.

## Key Commands

```bash
cd dev-supervisor
make build          # Build binary to dist/
make test           # Run tests (auto-skips Linux-only on macOS)
make test-docker    # Docker integration tests
make lint           # golangci-lint
make fmt-fix        # Format all files
make check          # All checks (fmt, vet, lint, test)
```

## Conventions That Differ from Monorepo

**Logging fields use snake_case** (`remote_addr`, `working_dir`), not the camelCase used in the TypeScript monorepo. Stay consistent within dev-supervisor.

**Structured logging** uses `log/slog`. Terminal gets text format, non-terminal (Docker) gets JSON.

## golangci-lint v2

**Version:** v2.8.0 (required for CI consistency). Config format is v2 (`linters.settings`, `formatters.settings`).

Enabled: gosec, errcheck, revive, gocritic, gocyclo (max 15), goconst, govet, staticcheck. Line limit: 120 chars. Disabled: `fieldalignment` (govet). Note: gosimple/stylecheck/typecheck removed in v2 (merged into staticcheck).

## Platform-Specific Code

Uses build tags for platform separation — not runtime `GOOS` checks.

```
feature.go                  # Cross-platform
feature_linux.go            # //go:build linux
feature_fallback.go         # //go:build !linux
```

Linux-specific features (auto-skipped on macOS): port discovery via `/proc`, zombie reaping, SELinux peer validation.

## Start-on-Request Mode

Preview variant supports auto-start/stop of idle apps:

- First request to stopped app starts the process
- Idle timeout stops the app (`DEV_SUPERVISOR_IDLE_TIMEOUT=30m`)
- **Safety:** Automatically disabled if `NOMAD_TASK_NAME != "preview"`

## Architecture Overview

```
dev-supervisor/
├── cmd/
│   ├── dev-supervisor/         # Main binary (PID 1, API, proxy)
│   └── airo-sandbox/           # Landlock sandbox wrapper binary
├── internal/
│   ├── allocconfig/            # Config file loading (/alloc/config.json)
│   ├── auth/                   # JWT middleware, JWKS validation
│   ├── config/                 # Env-based configuration
│   ├── health/                 # Health checks (command, HTTP, TCP)
│   ├── logs/                   # Buffered log manager
│   ├── middleware/             # Connection tracking, peer validation
│   ├── ports/                  # Linux port discovery via /proc
│   ├── process/                # Exit codes, zombie reaping
│   ├── processmanager/         # Process lifecycle management
│   ├── proxy/http/             # TLS reverse proxy, WebSocket, persistent assets
│   ├── proxy/smtp/             # SMTP proxy with header injection (localhost:2525 only)
│   ├── sandbox/                # Sandbox config, profiles, command wrapping
│   └── validation/             # Input validation (path traversal, env vars)
├── docs/SANDBOX.md             # Sandbox architecture and configuration
├── Makefile
├── .golangci.yml
└── Dockerfile                  # Multi-stage Alpine build
```

## Testing

Three tiers:

1. **Cross-platform unit tests** — `make test` (runs everywhere)
2. **Linux-specific tests** — `*_linux_test.go` with `//go:build linux` (auto-skipped on macOS)
3. **Docker integration tests** — `make test-docker` (tests actual container PID1 behavior)

## PR Checklist

- [ ] `make fmt-fix` — code formatted
- [ ] `make lint` — no lint errors
- [ ] `make test` — tests pass
- [ ] `make test-docker` — if API changed
- [ ] TypeScript client updated in `app/src/lib/dev-environment/` — if API changed
- [ ] Platform-specific code uses build tags with fallback implementation
