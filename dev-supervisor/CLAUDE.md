# dev-supervisor

Containerized service providing process lifecycle management, health monitoring, HTTP/SMTP proxying, JWT authentication, and log streaming via Unix socket API.

**Key characteristics:** Go 1.25 + Rust, Linux-only (no Windows support intended), statically linked binaries.

## PID1 Architecture

The container runs a two-process init model:

```
PID1: airo-workspace (Rust)     — zombie reaping, signal forwarding
  └── dev-supervisor (Go)        — all business logic, HTTP API, proxy
        └── child processes      — customer app, setup scripts, exec commands
```

`airo-workspace` is a minimal Rust binary (~150 lines) that handles PID1 responsibilities. The Go binary runs as a child subreaper (`PR_SET_CHILD_SUBREAPER`) and continues to own all HTTP routes and process management. This split enables incremental migration of functionality from Go to Rust.

## Integration with Monorepo

dev-supervisor is consumed by:

- `agents/src/services/DevSupervisorClient.ts` (primary HTTP client)
- `agents/src/workspace/adapters/http-tasks.ts` (task API adapter)

**Socket paths:**

- Container: `/tmp/supervisor/dev-supervisor.sock`
- Host (local dev): `/tmp/dev-supervisor-{dockerSafeId}/dev-supervisor.sock` (mounted to `/tmp/supervisor` in container)
- Configurable: `AIRO_SUPERVISOR_SOCKET_PATH` (v4) or `DEV_SUPERVISOR_SOCKET_PATH` (v3 compat)

**When changing the API:** Update the TypeScript client in `agents/src/services/DevSupervisorClient.ts` and test end-to-end with Docker Compose.

## Key Commands

```bash
cd dev-supervisor
make build                    # Build all binaries (Go + Rust) to dist/
make build-supervisor         # Go dev-supervisor binary only
make build-airo-workspace    # Rust airo-workspace binary only
make test                     # Go tests (auto-skips Linux-only on macOS)
make test-rust                # Rust tests (integration tests Linux-only)
make test-docker              # Docker integration tests
make lint                     # golangci-lint
make lint-rust                # cargo clippy
make fmt-fix                  # Format Go files
make check                    # All checks (fmt, vet, lint, test — Go + Rust)
```

## Conventions That Differ from Monorepo

**Logging fields use snake_case** (`remote_addr`, `working_dir`), not the camelCase used in the TypeScript monorepo. Stay consistent within dev-supervisor.

**Structured logging** uses `log/slog`. Terminal gets text format, non-terminal (Docker) gets JSON.

**`/exec` output is mirrored into the log ring buffer** under a distinct `source: "exec"` (not `"stdout"`/`"stderr"`, which are reserved for the managed process's own streams) with a monotonic `command_id`, in addition to being returned on the HTTP response. Capped per command. The response body is still authoritative. Fetch all output for a single command with `GET /logs?source=exec&command_id=N`; `/exec` returns the `command_id` in its JSON response so callers can correlate. Customer-facing log consumers restrict to `source=stdout,stderr` so orchestration output stays out of end-user-visible surfaces. `GET /logs` is unsanitized; callers that surface it to end users must sanitize on their side.

## golangci-lint v2

**Version:** v2.8.0 (required for CI consistency). Config format is v2 (`linters.settings`, `formatters.settings`).

Enabled: gosec, errcheck, revive, gocritic, gocyclo (max 15), goconst, govet, staticcheck. Line limit: 120 chars. Disabled: `fieldalignment` (govet). Note: gosimple/stylecheck/typecheck removed in v2 (merged into staticcheck).

## Platform-Specific Code

**Target platform is Linux only.** Windows is not supported and never will be. macOS fallback stubs exist solely to enable `go build` and unit tests on developer machines — they are not a production path.

Uses build tags for platform separation — not runtime `GOOS` checks.

```
feature.go                  # Cross-platform interface
feature_linux.go            # //go:build linux — production implementation
feature_fallback.go         # //go:build !linux — dev-time stub (macOS)
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
├── rust/                           # Rust workspace (Cargo)
│   ├── Cargo.toml                  # Workspace root
│   └── airo-workspace/            # PID1 init binary (signal forwarding, zombie reaping)
│       ├── Cargo.toml
│       └── src/main.rs
├── cmd/                            # Go binaries
│   ├── dev-supervisor/             # Main binary (API, proxy, process management)
│   └── airo-sandbox/               # Landlock sandbox wrapper binary
├── internal/
│   ├── allocconfig/                # Config file loading (/alloc/config.json)
│   ├── auth/                       # JWT middleware, JWKS validation
│   ├── config/                     # Env-based configuration
│   ├── health/                     # Health checks (command, HTTP, TCP)
│   ├── logs/                       # Buffered log manager
│   ├── middleware/                 # Connection tracking, peer validation
│   ├── ports/                      # Linux port discovery via /proc
│   ├── process/                    # Exit codes, zombie reaping (subreaper mode)
│   ├── processmanager/             # Process lifecycle management
│   ├── proxy/http/                 # TLS reverse proxy, WebSocket, persistent assets
│   ├── proxy/smtp/                 # SMTP proxy with header injection + sender enforcement (localhost:25)
│   ├── proxy/emailhttp/            # HTTP email gateway, POST /api/email/send (localhost:2525)
│   ├── sandbox/                    # Sandbox config, profiles, command wrapping
│   └── validation/                 # Input validation (path traversal, env vars)
├── docs/SANDBOX.md                 # Sandbox architecture and configuration
├── Makefile
├── .golangci.yml
└── Dockerfile                      # Multi-stage Alpine build (Rust + Go)
```

## Testing

Three tiers:

1. **Cross-platform unit tests** — `make test` (runs everywhere)
2. **Linux-specific tests** — `*_linux_test.go` with `//go:build linux` (auto-skipped on macOS)
3. **Docker integration tests** — `make test-docker` (tests actual container PID1 behavior)

### Strangler-fig acceptance harness

The integration tests under `cmd/dev-supervisor/` boot the server through a pluggable harness (`strangler_harness_test.go`) selected by `DEV_SUPERVISOR_TEST_HARNESS`:

- **`inproc`** (default) — Go server in the test process. Fastest. Used by `make test-integration`.
- **`subproc`** — exec the built `dist/dev-supervisor` binary as a child and talk to it via the public socket. Validates the real binary boot path. Used by `make test-integration-subproc`.
- **`strangler`** — RESERVED. Future PR will boot a Rust listener forwarding to a Go subproc; the same suite must pass identically to inproc/subproc. This is the safety net for the Go-to-Rust migration.

Test bodies are black-box (no `suite.server.*` access). When adding new integration tests, keep them socket-only so they continue to work in every mode.

## Rust Component

The `rust/airo-workspace/` crate is the PID1 init process. It:
- Forks and execs the Go `dev-supervisor` binary with all args/env passed through
- Reaps zombie processes (orphans that escape the Go subreaper)
- Forwards signals to the Go child (SIGTERM/SIGINT trigger graceful shutdown with 30s timeout)
- Exits with the Go child's exit code

**Config:** `AIRO_WORKSPACE_VERBOSE=1` enables debug logging to stderr. No other configuration.

**Rust toolchain:** Stable, targets `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` for static linking. Prerequisite: `rustup` (validated by dev-runner preflight).

## PR Checklist

- [ ] `make fmt-fix` — code formatted
- [ ] `make lint` — no Go lint errors
- [ ] `make lint-rust` — no Rust lint errors
- [ ] `make test` — Go tests pass
- [ ] `make test-rust` — Rust tests pass
- [ ] `make test-docker` — if API changed
- [ ] TypeScript client updated in `app/src/lib/dev-environment/` — if API changed
- [ ] Platform-specific code uses build tags with fallback implementation
