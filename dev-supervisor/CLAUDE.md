# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# dev-supervisor: Go Development Guidelines

**Read this before modifying dev-supervisor code.**

## Project Overview

dev-supervisor is a **Go-based** containerized service that acts as PID 1 in development Docker containers. It provides centralized process lifecycle management, health monitoring, HTTP/SMTP proxying, JWT authentication, and log streaming through a Unix socket API.

**Key Characteristics:**
- Pure Go project (no Node.js/pnpm) using Go 1.25
- Cross-platform with Linux-optimized features
- Unix socket API for IPC (with optional TCP mode for development)
- Container PID 1 process with proper init behavior
- TLS reverse proxy with WebSocket support
- JWT authentication with JWKS integration
- Start-on-request mode for preview deployments

## Repository Structure

This is a **standalone Go project** within the monorepo:

```
dev-supervisor/
├── main.go                         # Entry point, CLI, supervisor initialization
├── api.go                          # HTTP API server (Unix socket/TCP)
├── process_manager.go              # Process lifecycle management
├── pid1_manager_unix.go            # PID 1 behavior (signal forwarding, reaping)
├── http_proxy.go                   # Reverse proxy with TLS/WebSocket/static serving
├── smtp_proxy.go                   # SMTP proxy with header injection
├── health_monitor.go               # Configurable health checks
├── jwt_middleware.go               # JWT authentication middleware
├── jwt_validator.go                # JWT validation logic
├── jwks_client.go                  # JWKS client for public key fetching
├── command_executor.go             # Command execution with output capture
├── environment_manager.go          # Environment variable management
├── log_manager.go                  # Log buffering and management
├── port_discovery_linux.go         # Linux port discovery (procfs)
├── port_discovery_fallback.go     # Fallback for non-Linux platforms
├── peer_sec_linux.go              # SELinux peer security validation
├── internal/
│   ├── config/
│   │   ├── config.go              # Configuration struct and loading
│   │   └── env.go                 # Environment variable helpers
│   └── logs/
│       ├── manager.go             # Log management implementation
│       └── types.go               # Log types and interfaces
├── test/
│   ├── Dockerfile.integration     # Docker image for integration tests
│   ├── docker-integration-tests.sh # Bash test suite
│   └── run-docker-tests.sh        # Docker test runner
├── docs/DEVELOPMENT.md            # Comprehensive development guide
├── Makefile                       # Build, test, lint targets
├── .golangci.yml                  # Linter configuration
├── Dockerfile                     # Multi-stage Alpine build
└── go.mod                         # Go module definition (Go 1.25)

Platform-specific files:
├── *_linux.go                     # Linux-only (//go:build linux)
├── *_darwin.go                    # macOS-only (//go:build darwin)
├── *_windows.go                   # Windows-only (//go:build windows)
└── *_fallback.go                  # Non-Linux fallback (//go:build !linux)
```

## Key Commands

**Setup:**
```bash
cd dev-supervisor
go mod download                  # Install dependencies
make deps                        # Alternative: download + tidy
```

**Development:**
```bash
make build                       # Build binary to dist/
make run                         # Build and run locally
make test                        # Run tests (auto-skips Linux-only on macOS)
make test-coverage               # Generate coverage.html
make test-docker                 # Run Docker integration tests
make lint                        # Run golangci-lint
make fmt                         # Check formatting (fails if incorrect)
make fmt-fix                     # Format and fix all files
make clean                       # Remove build artifacts
make check                       # Run all checks (fmt, vet, lint, test)
```

**Testing individual components:**
```bash
go test -v -run TestProcessManager    # Run specific test
go test -v ./internal/config          # Test specific package
go test -race -v ./...                # Run all tests with race detector
go test -v -tags=docker_integration   # Run Docker integration tests
```

**Multi-platform builds:**
```bash
make build-all                   # linux/darwin/windows amd64/arm64
GOOS=linux GOARCH=amd64 go build -o dev-supervisor-linux .
```

## Code Quality Standards

<go_formatting>
**ALWAYS run before commits:**

```bash
make fmt-fix                     # Format code
make lint                        # Check linting
```

**Or individually:**
```bash
go fmt ./...                     # Standard formatting
gofmt -s -w .                    # Format with simplify
golangci-lint run --timeout=5m   # Comprehensive linting
```

Formatting is **enforced** - CI will fail on unformatted code.
</go_formatting>

<golangci_lint_configuration>
See `.golangci.yml` for enabled linters:

- **Security:** gosec, errcheck
- **Style:** gofmt, goimports, stylecheck, revive
- **Performance:** gocritic (performance tag)
- **Complexity:** gocyclo (max 15), goconst
- **Correctness:** govet, staticcheck, typecheck

**Line length:** 120 characters (lll linter)

**Disabled checks:**
- `fieldalignment` (govet) - not worth refactoring for minimal gain
</golangci_lint_configuration>

<error_handling>
**Required patterns:**

```go
// Always check errors immediately
result, err := operation()
if err != nil {
    return fmt.Errorf("descriptive context: %w", err)  // Use %w for wrapping
}

// Validate at boundaries
if req.Command == "" {
    return fmt.Errorf("command cannot be empty")
}
```

**Never:**
- Ignore errors with `_` unless justified
- Use naked `return err` (add context with fmt.Errorf)
- Panic except in init/main for unrecoverable errors
</error_handling>

<naming_conventions>
Follow Go standard conventions:

- **Packages:** lowercase, single word (`config`, not `configManager`)
- **Exported:** PascalCase (`ProcessManager`, `HealthCheck`)
- **Unexported:** camelCase (`processState`, `startTime`)
- **Interfaces:** noun or `-er` suffix (`Logger`, `CommandExecutor`)
- **Constants:** PascalCase or ALL_CAPS for exported, camelCase unexported
- **Acronyms:** preserve case (`HTTPProxy`, `JSONData`, `APIResponse`, `JWTValidator`, `SMTPProxy`)

**File naming:**
- `feature.go` - cross-platform implementation
- `feature_linux.go` - Linux-specific (requires `//go:build linux`)
- `feature_fallback.go` - Non-Linux fallback (requires `//go:build !linux`)
- `feature_test.go` - standard tests
- `feature_integration_test.go` - integration tests
</naming_conventions>

<comments_and_documentation>
**Required:**
- Exported functions/types must have doc comments
- Build tags must be at the very top with blank line after
- WHY not WHAT (code should be self-documenting)

```go
//go:build linux

package main

// PortDiscovery finds listening ports by reading /proc/net/tcp.
// This Linux-specific implementation provides zero-overhead discovery.
type PortDiscovery struct {
    // ... fields
}
```

**Avoid:**
- Obvious comments ("This function starts the process")
- Commented-out code (delete it, use git)
- TODO comments without issue numbers
</comments_and_documentation>

## Architecture Patterns

<platform_abstraction>
**Interface-based platform separation:**

```go
// Interface (cross-platform)
type PortDiscovery interface {
    FindListeningPorts(pid int) ([]int, error)
}

// Linux implementation (port_discovery_linux.go)
//go:build linux

func NewPortDiscovery() PortDiscovery {
    return &linuxPortDiscovery{}
}

// Fallback implementation (port_discovery_fallback.go)
//go:build !linux

func NewPortDiscovery() PortDiscovery {
    return &fallbackPortDiscovery{}  // Returns empty, logs warning
}
```

**Benefits:**
- No runtime platform checks (`if runtime.GOOS == "linux"`)
- Compiler enforces correctness
- Easy to test each implementation
- Clear separation of concerns
</platform_abstraction>

<unix_socket_api>
**API exposed over Unix domain socket (or TCP in dev mode):**

```go
// Default socket path: /tmp/airo-supervisor.sock
// Configurable via AIRO_SUPERVISOR_SOCKET_PATH (v4) or DEV_SUPERVISOR_SOCKET_PATH (v3)
http.HandleFunc("/process/start", handleProcessStart)
http.HandleFunc("/health", handleHealth)
http.HandleFunc("/info", handleSystemInfo)
http.HandleFunc("/health-config", handleHealthConfig)
```

**Client usage:**
```bash
curl --unix-socket /tmp/supervisor/dev-supervisor.sock http://localhost/health
```

**TCP mode (development only):**
```bash
# Enable TCP mode for easier debugging
DEV_SUPERVISOR_USE_TCP=true DEV_SUPERVISOR_TCP_PORT=8080 ./dev-supervisor
curl http://localhost:8080/health
```

**Key patterns:**
- Request/response structs for JSON serialization
- Validation at API boundary
- Structured error responses
- Graceful shutdown handling
</unix_socket_api>

<configuration_management>
**Environment variable driven with `internal/config` package:**

```go
// Configuration is centralized in internal/config/config.go
type Config struct {
    SocketPath      string
    ProxyEnabled    bool
    JWTEnabled      bool
    // ... other fields
}

// Load configuration with defaults
config := config.LoadConfig()
```

**Environment variable conventions:**
- **Primary prefix:** `DEV_SUPERVISOR_*` (most settings)
- **v4 socket path:** `AIRO_SUPERVISOR_SOCKET_PATH` (preferred)
- **v3 socket path:** `DEV_SUPERVISOR_SOCKET_PATH` (backward compatibility)
- **Global vars:** `SITE_ID`, `NOMAD_TASK_NAME`, `ALLOWED_ORIGINS`

**Helper functions in `internal/config/env.go`:**
```go
GetEnvStringWithDefault(key, defaultValue string) string
GetEnvBoolWithDefault(key string, defaultValue bool) bool
GetEnvIntWithDefault(key string, defaultValue int) int
GetEnvDurationWithDefault(key string, defaultValue time.Duration) time.Duration
```

**Validation:**
- Validate on load, fail fast
- Provide sensible defaults
- Document in README.md and config.go comments
</configuration_management>

<http_proxy_architecture>
**TLS reverse proxy with multiple modes:**

1. **Proxy mode** (`http_proxy.go`):
   - TLS termination with configurable cert/key
   - Reverse proxy to backend (typically localhost:port)
   - WebSocket support with automatic upgrade detection
   - Static file serving with cache headers
   - SPA fallback mode for client-side routing
   - Request/response logging with CF-Ray tracing
   - Retry logic with configurable backoff

2. **JWT authentication** (`jwt_middleware.go`, `jwt_validator.go`, `jwks_client.go`):
   - JWKS-based public key validation (RFC 7517)
   - Site-scoped token validation (siteId claim)
   - Hybrid auth failure handling (browser redirect vs API 401)
   - Public key caching (5 minute TTL)
   - Path exclusions for health checks

3. **CORS handling**:
   - Configurable allowed origins via `ALLOWED_ORIGINS`
   - Aligned with Vite configuration for consistency
   - OPTIONS preflight support

**Configuration:**
```bash
DEV_SUPERVISOR_ENABLE_PROXY=true
DEV_SUPERVISOR_PROXY_PORT=443
DEV_SUPERVISOR_PROXY_TARGET_HOST=localhost
DEV_SUPERVISOR_PROXY_TARGET_PORT=3000
DEV_SUPERVISOR_PROXY_CERT_PATH=/path/to/cert.pem
DEV_SUPERVISOR_PROXY_KEY_PATH=/path/to/key.pem
DEV_SUPERVISOR_SERVE_STATIC=true
DEV_SUPERVISOR_STATIC_ROOT=/app/dist/client
```
</http_proxy_architecture>

<smtp_proxy_architecture>
**SMTP proxy with header injection** (`smtp_proxy.go`):

- Listens on `127.0.0.1:2525` (localhost only)
- Forwards to configurable destination (default: `relay-hosting.secureserver.net:25`)
- Automatically injects tracking headers from environment variables

**Injected headers:**
```
X-SITE-UID: ${SITE_ID}
X-PRODUCT: ${PRODUCT} (default: airo-app-builder)
X-ENVIRONMENT: ${NODE_ENV}
X-DATACENTER: ${NOMAD_DC}
```

**Configuration:**
```bash
SMTP_DESTINATION=smtp.example.com:587
SITE_ID=app-123
PRODUCT=my-app
```
</smtp_proxy_architecture>

<start_on_request_mode>
**Start-on-request for preview deployments:**

Preview variant supports automatic start/stop of idle apps to reduce resource usage:

- **Auto-start:** First request to stopped app starts the process
- **Auto-stop:** Apps idle for configured duration are automatically stopped
- **Safety:** Only enabled when `NOMAD_TASK_NAME=preview`

**Configuration:**
```bash
DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true
DEV_SUPERVISOR_IDLE_TIMEOUT=30m        # Stop after 30 minutes of inactivity
DEV_SUPERVISOR_IDLE_CHECK_INTERVAL=30s # Check idle status every 30 seconds
```

**Safety check:** Start-on-request is automatically disabled if `NOMAD_TASK_NAME != "preview"` to prevent accidental use in production.
</start_on_request_mode>

## Testing Strategy

<three_tier_testing>
**Tier 1: Cross-Platform Unit Tests** (90% of tests)
- Run on macOS, Linux, Windows
- Test business logic, API, health monitoring
- No build tags needed
```bash
make test
go test -v -race ./...
```

**Tier 2: Linux-Specific Unit Tests**
- Automatic on Linux, skipped on macOS/Windows
- Files: `*_linux_test.go` with `//go:build linux`
- Tests port discovery, orphan reaping, SELinux peer validation
```bash
go test ./...  # Auto-skips on non-Linux
```

**Tier 3: Docker Integration Tests**
- Tests actual container behavior as PID 1
- Runs from any platform with Docker
- Tag: `//go:build docker_integration`
```bash
make test-docker
go test -v -tags=docker_integration
```
</three_tier_testing>

<test_patterns>
**Standard test structure:**

```go
func TestFeature_Scenario(t *testing.T) {
    // Arrange
    subject := NewFeature(config)

    // Act
    result, err := subject.DoSomething()

    // Assert
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if result != expected {
        t.Errorf("got %v, want %v", result, expected)
    }
}
```

**Table-driven tests for multiple cases:**

```go
func TestValidation(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"valid", "good", false},
        {"empty", "", true},
        {"invalid", "bad!", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := Validate(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

**Linux-specific test:**

```go
//go:build linux

package main

import "testing"

func TestLinuxOnlyFeature(t *testing.T) {
    // This test only compiles and runs on Linux
    result := LinuxSpecificFunction()
    // ... assertions
}
```

**Cleanup with t.Cleanup:**
```go
func TestWithCleanup(t *testing.T) {
    resource := setupResource()
    t.Cleanup(func() {
        resource.Close()
    })
    // Test code
}
```
</test_patterns>

## Critical Rules

<pid1_responsibilities>
When acting as PID 1 in containers:

1. **Signal forwarding:** Forward SIGTERM/SIGINT to supervised process
2. **Orphan reaping:** Reap zombie processes (Linux only, uses waitid syscall)
3. **Graceful shutdown:** Clean up resources, wait for process termination
4. **Exit code propagation:** Exit with supervised process's exit code

**Never:**
- Exit without cleaning up
- Ignore signals
- Leave orphaned processes
- Skip calling SetDefaultGOMAXPROCS() (container awareness)
</pid1_responsibilities>

<integration_with_monorepo>
**dev-supervisor is called by:**
- `app/src/lib/dev-environment/adapters/DockerAppService.ts`
- `app/src/lib/dev-environment/docker-compose-generator.ts`

**Socket is mounted at:**
- Container: `/tmp/supervisor/dev-supervisor.sock`
- Host: `/tmp/apps/{appId}/supervisor/dev-supervisor.sock`

**Logs are exposed via:**
- WebSocket API: `ws://localhost/logs/stream`
- Log manager: `internal/logs/`

**When changing the API:**
1. Update TypeScript client in `app/src/lib/dev-environment/`
2. Test end-to-end with Docker Compose
3. Update API documentation in README.md
4. Consider backward compatibility
</integration_with_monorepo>

<build_and_deployment>
**Docker multi-stage build with Alpine:**

```dockerfile
# Stage 1: Build
FROM golang:1.25-alpine AS builder
COPY . /build
RUN CGO_ENABLED=0 GOOS=linux go build -a -ldflags '-extldflags "-static" -w -s' -o dev-supervisor .

# Stage 2: Runtime
FROM alpine:3.22
COPY --from=builder /build/dev-supervisor /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/dev-supervisor"]
```

**Binary is statically linked** - no external dependencies required.

**Deployment:**
- Built in CI/CD pipeline
- Pushed to Docker registry
- Used in generated `docker-compose.yml` files
- Can be copied from Docker image using `COPY --from`
</build_and_deployment>

<security_considerations>
**SELinux peer validation** (`peer_sec_linux.go`):
- Validates peer SELinux context on Unix socket connections
- Only allows whitelisted types (default: `airo_agent_container.process`)
- Configurable via `DEV_SUPERVISOR_ALLOWED_SELINUX_TYPES`

**JWT authentication:**
- Site-scoped validation prevents cross-site token usage
- Public key caching with TTL (5 minutes)
- Generic error messages prevent information disclosure
- TLS verification for JWKS endpoint (skip only in local dev)

**SMTP proxy:**
- Localhost-only listening (127.0.0.1:2525)
- No authentication passthrough (adds tracking only)

**HTTP proxy:**
- TLS certificate/key validation
- CORS origin whitelisting
- Path-based auth exclusions for health endpoints
</security_considerations>

## Working with Claude

<default_to_implementation>
Implement changes directly. When asked to improve or fix something, make the changes. Don't just suggest them.
</default_to_implementation>

<read_before_editing>
**ALWAYS read the full function/file before editing:**
- Understand context and dependencies
- Check for existing patterns
- Ensure consistency with surrounding code
- Never guess at implementation details
</read_before_editing>

<go_idioms>
Follow standard Go idioms:

- Prefer small, focused functions
- Use early returns over deep nesting
- Accept interfaces, return structs
- Make zero values useful
- Use defer for cleanup
- Avoid premature optimization
- Errors are values, not exceptions
- Use context for cancellation and timeouts

**Resources:**
- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
</go_idioms>

<structured_logging>
Use `log/slog` with structured fields:

```go
slog.Info("process.started",
    "pid", pid,
    "command", command,
    "working_dir", workingDir)

slog.Error("process.start.failed",
    "error", err.Error(),
    "command", command)
```

**Logging behavior:**
- Terminal: human-readable text format with key=value pairs
- Non-terminal (Docker/pipe): JSON format for aggregation
- Log level: Info by default, Debug for troubleshooting
- No emojis or user-facing formatting
</structured_logging>

## Additional Documentation

- **Comprehensive guide:** `docs/DEVELOPMENT.md` - detailed architecture, testing, and development workflows
- **README:** `README.md` - features, API usage, configuration examples
- **Root project:** `../CLAUDE.md` - monorepo-wide guidelines
- **Integration:** `../app/DEPLOYMENT-ADAPTER-SYSTEM.md` - how app/ calls dev-supervisor

## Pull Request Checklist

Before submitting changes:

- [ ] `make fmt-fix` - Code is formatted
- [ ] `make lint` - No linting errors
- [ ] `make test` - All tests pass
- [ ] `make test-docker` - Docker integration tests pass (if API changed)
- [ ] Comments added for exported functions/types
- [ ] Error messages are descriptive with context (use `fmt.Errorf(..., %w, err)`)
- [ ] Platform-specific code uses appropriate build tags
- [ ] Integration tested with monorepo (`docker-compose up` in root)

**For API changes:**
- [ ] TypeScript client updated in `../app/src/lib/dev-environment/`
- [ ] End-to-end tested with real app lifecycle
- [ ] README.md API documentation updated
- [ ] Backward compatibility considered

**For new platform-specific code:**
- [ ] Interface defined for abstraction
- [ ] Linux implementation in `*_linux.go` with `//go:build linux`
- [ ] Fallback implementation in `*_fallback.go` with `//go:build !linux`
- [ ] Both implementations tested
- [ ] Linux-specific tests in `*_linux_test.go`

**For configuration changes:**
- [ ] Environment variables documented in README.md
- [ ] Default values are sensible
- [ ] Backward compatibility maintained (where possible)
- [ ] `internal/config/config.go` updated
