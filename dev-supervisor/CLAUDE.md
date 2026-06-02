# dev-supervisor

Containerized service providing process lifecycle management, health monitoring, HTTP/SMTP proxying, JWT authentication, and log streaming via Unix socket API.

**Key characteristics:** Go 1.25 + Rust, Linux-only (no Windows support intended), statically linked binaries.

## PID1 Architecture

The container runs a two-process init model:

```
PID1: airo-workspace (Rust)     — zombie reaping, signal forwarding,
                                   optional public-socket reverse proxy
  └── dev-supervisor (Go)        — business logic, HTTP API, separate-port proxies,
                                   binds the public Unix socket directly today;
                                   binds an internal socket when proxy is on
        └── child processes      — customer app, setup scripts, exec commands
```

`airo-workspace` is the Rust PID1 init. Since the strangler-fig migration began (PR #4332 staged the deps; PR #3 wired up the proxy), it can ALSO own the public Unix socket and reverse-proxy HTTP/1.1 to the Go binary on an internal socket. **The proxy is opt-in via `AIRO_WORKSPACE_PROXY=1`** and stays off in production until PR #4 moves the SO_PEERSEC auth check into Rust — otherwise the proxy presents its own SELinux context to dev-supervisor instead of the caller's, breaking the `PeerSec` middleware. With the proxy on, endpoints will flip Rust-side one at a time by short-circuiting them in `proxy.rs`; the public socket path never moves. The Go binary remains a child subreaper (`PR_SET_CHILD_SUBREAPER`) and still owns all HTTP routes until each is migrated.

## Integration with Monorepo

dev-supervisor is consumed by:

- `agents/src/services/DevSupervisorClient.ts` (primary HTTP client)
- `agents/src/workspace/adapters/http-tasks.ts` (task API adapter)

**Socket paths:**

- **Default (proxy off — production today):** Go binds `/tmp/supervisor/dev-supervisor.sock` directly. `DEV_SUPERVISOR_SOCKET_PATH` selects the path; same as pre-strangler.
- **Proxy on (`AIRO_WORKSPACE_PROXY=1`, test/staging only for now):** airo-workspace binds the public socket; Go binds an internal socket and only airo-workspace connects to it.
  - Public socket: configurable via `AIRO_PUBLIC_SOCKET_PATH` (preferred) or `DEV_SUPERVISOR_SOCKET_PATH` (compat).
  - Internal socket: `/tmp/supervisor/internal.sock` by convention. Fixed in production by SELinux co-residency contract once the proxy is on; configurable via `AIRO_INTERNAL_SOCKET_PATH` for tests.
- **Why opt-in for now:** with the proxy on, dev-supervisor's `PeerSec` middleware sees airo-workspace's SELinux context (`airo_app_container.process`) on accepted connections instead of the actual caller's (`airo_agent_container.process`), and rejects every request. PR #4 moves the peer-sec check into Rust at the listener; once that ships, prod can flip the flag.

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
- **`subproc`** — exec the built `dist/dev-supervisor` binary as a child and talk to it via its socket. Validates the real Go binary boot path. Used by `make test-integration-subproc`.
- **`strangler`** — exec airo-workspace with `AIRO_WORKSPACE_PROXY=1`, which binds the public socket and proxies to dev-supervisor on an internal socket. Validates the strangler topology end-to-end (proxy + Go server + cross-process boundary). Used by `make test-integration-strangler`. As we migrate handlers to Rust, this is what proves the same black-box test suite still passes. The harness sets the env var explicitly because the binary defaults to proxy-off.

Test bodies are black-box (no `suite.server.*` access). When adding new integration tests, keep them socket-only so they continue to work in every mode.

## Rust Component

The `rust/airo-workspace/` crate is the PID1 init process. It:
- Forks and execs the Go `dev-supervisor` binary; with the proxy on, injects `AIRO_SUPERVISOR_SOCKET_PATH` / `DEV_SUPERVISOR_SOCKET_PATH` so the child binds the internal socket instead of the public one
- Optionally owns the **public** Unix socket and reverse-proxies HTTP/1.1 to the Go child via the internal socket (`src/proxy.rs`, hyper 1.x + tokio). Off by default, opt-in via `AIRO_WORKSPACE_PROXY=1` until PR #4 moves the SO_PEERSEC auth check into Rust
- Reaps zombie processes (orphans that escape the Go subreaper)
- Forwards signals to the Go child (SIGTERM/SIGINT trigger graceful shutdown with 30s timeout)
- Exits with the Go child's exit code

**Config:**
- `AIRO_WORKSPACE_PROXY=1` — enable the reverse proxy. Default: off (Go binds the public socket directly).
- `AIRO_PUBLIC_SOCKET_PATH` (or `DEV_SUPERVISOR_SOCKET_PATH` compat) — path airo-workspace binds for callers when the proxy is on.
- `AIRO_INTERNAL_SOCKET_PATH` — path the Go child binds when the proxy is on (default `/tmp/supervisor/internal.sock`).
- `AIRO_WORKSPACE_VERBOSE=1` — stderr debug logging.

**Source layout:**
- `src/main.rs` — entry, env wiring.
- `src/supervisor.rs` — signal masking, signalfd loop (Linux) / sigsuspend loop (Darwin), child spawn + reap.
- `src/proxy.rs` — UDS reverse proxy with hyper 1.x and HTTP/1.1 Upgrade bridging.

**Rust toolchain:** Stable, targets `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` for static linking. Prerequisite: `rustup` (validated by dev-runner preflight). **CI builds and validates amd64 (`x86_64-unknown-linux-musl`) only**; arm64 (`aarch64-unknown-linux-musl`) is compiled natively in local dev and `make test-docker` on Apple Silicon, so an arm64-specific regression surfaces on a developer machine rather than in CI.

## PR Checklist

- [ ] `make fmt-fix` — code formatted
- [ ] `make lint` — no Go lint errors
- [ ] `make lint-rust` — no Rust lint errors
- [ ] `make test` — Go tests pass
- [ ] `make test-rust` — Rust tests pass
- [ ] `make test-docker` — if API changed
- [ ] TypeScript client updated in `app/src/lib/dev-environment/` — if API changed
- [ ] Platform-specific code uses build tags with fallback implementation
