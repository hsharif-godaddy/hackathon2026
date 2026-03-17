# dev-supervisor

A containerized service written in Go that acts as the primary process (PID 1) in development Docker containers, providing centralized control over development environments through an HTTP API served over Unix domain sockets.

## Features

- **Process Lifecycle Management**: Start, stop, restart development processes
- **PID 1 Behavior**: Proper init process behavior with signal forwarding and zombie reaping
- **Health Monitoring**: Configurable health checks with automatic restart policies
- **HTTP API over Unix Domain Socket**: RESTful interface for easy integration
- **Command Execution**: Execute arbitrary shell commands with output capture
- **Environment Management**: Dynamic environment variable control
- **Real-time Log Streaming**: WebSocket-based log streaming with buffering
- **Automatic Recovery**: Crash detection and automatic process restart with backoff
- **SMTP Proxy**: Built-in SMTP proxy for intercepting and modifying email traffic

## Quick Start

### Build and Run

```bash
# Build the binary
make build

# Run locally
make run

# Build Docker image
make docker-build
```

### API Usage

The service exposes an HTTP API over a Unix domain socket. In Docker containers, the socket is typically mounted at `/tmp/supervisor/dev-supervisor.sock` inside the container.

```bash
# Health check
curl --unix-socket /tmp/supervisor/dev-supervisor.sock http://localhost/health

# Get system info
curl --unix-socket /tmp/supervisor/dev-supervisor.sock http://localhost/info

# Start a development process
curl --unix-socket /tmp/supervisor/dev-supervisor.sock \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"command": "npm run dev", "working_dir": "/app"}' \
  http://localhost/process/start

# Configure health monitoring (with duration strings)
curl --unix-socket /tmp/supervisor/dev-supervisor.sock \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "health_check": {
      "type": "http",
      "url": "http://localhost:3000/health",
      "interval": "30s",
      "timeout": "10s",
      "retries": 3,
      "start_period": "60s",
      "success_threshold": 1,
      "failure_threshold": 3
    },
    "restart_policy": {
      "enabled": true,
      "max_restarts": 5,
      "restart_window": "5m",
      "backoff_multiplier": 2.0,
      "max_backoff": "5m",
      "initial_delay": "10s"
    }
  }' \
  http://localhost/health-config

# Get process status
curl --unix-socket /tmp/supervisor/dev-supervisor.sock http://localhost/process/status

# Execute a command and get output
curl --unix-socket /tmp/supervisor/dev-supervisor.sock \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la /app", "timeout": 30}' \
  http://localhost/exec
```

## Development

### Prerequisites

- Go 1.21 or later
- golangci-lint (for linting)

### Commands

```bash
# Install dependencies
make deps

# Run tests
make test

# Run integration tests
go test -v -timeout 60s

# Run linter
make lint

# Format code
make fmt

# Run all checks
make check

# Build for multiple platforms
make build-all
```

## Cross-Platform Development

dev-supervisor is designed for **production deployment on linux/amd64 only**, but supports **development and testing on macOS, Windows/WSL, and Linux**.

### Platform Support

| Platform      | Production | Development | Testing              |
| ------------- | ---------- | ----------- | -------------------- |
| Linux (amd64) | [YES] Full | [YES] Full  | [YES] All tests      |
| macOS         | [NO]       | [YES] Yes   | [YES] Cross-platform |
| Windows/WSL   | [NO]       | [YES] Yes   | [YES] Cross-platform |
| Linux (arm64) | [NO]       | [YES] Yes   | [YES] Cross-platform |

### Platform-Specific Features

Some features are only available on Linux due to kernel dependencies:

- **Orphan Reaping** (PID 1 only): Uses Linux-specific `waitid()` syscall for proper zombie process cleanup
- **Port Discovery**: Reads `/proc/net/tcp` and `/proc/PID/fd` to detect ports used by processes
- **Signal Handling**: Uses Linux signal semantics for process management

On non-Linux platforms:

- Port discovery returns empty results (process restarts still work, port conflicts detected at bind time)
- PID 1 features are stubbed out (not needed outside containers)
- Signal handling uses cross-platform Go abstractions

### Testing Strategy

dev-supervisor uses a **three-tier testing approach** for comprehensive coverage:

#### Tier 1: Cross-Platform Unit Tests

Run on all platforms (macOS, Windows, Linux):

```bash
make test           # Runs cross-platform tests
go test -v ./...    # Linux-specific tests auto-skipped on other platforms
```

**What's tested:**

- API endpoints and HTTP handling
- Process lifecycle management (start/stop/restart)
- Command execution
- Environment management
- Health monitoring
- Log management
- Configuration parsing

**Note:** Linux-specific tests are automatically skipped via build tags - no runtime checks needed.

#### Tier 2: Linux-Specific Unit Tests

Run only on Linux (automatic via build tags):

```bash
make test           # Includes Linux tests when run on Linux
```

**What's tested:**

- Port discovery from `/proc/net/tcp`
- PID 1 orphan reaping behavior
- Linux-specific signal handling

**Files:** `*_linux_test.go` (automatically excluded on non-Linux platforms)

#### Tier 3: Docker Integration Tests

Test actual production binary as PID 1 (runnable from any platform with Docker):

```bash
make test-docker    # Builds and tests linux/amd64 binary in Docker
```

**What's tested:**

- Actual PID 1 behavior in container
- Orphan reaping with real processes
- Signal handling and graceful shutdown
- API functionality over Unix socket
- Process lifecycle in production environment

**Requirements:** Docker installed and running

### Development Workflow

**On macOS/Windows:**

```bash
# 1. Install dependencies
make deps

# 2. Run cross-platform tests (90%+ coverage)
make test

# 3. Run Docker integration tests (full production validation)
make test-docker

# 4. Build for local platform
make build

# 5. Cross-compile for Linux production
GOOS=linux GOARCH=amd64 go build -o dist/dev-supervisor ./cmd/dev-supervisor
```

**On Linux:**

```bash
# All tests run, including Linux-specific features
make test           # Includes Linux-specific tests automatically
make test-docker    # Full integration tests
```

### Platform Compatibility Matrix

| Feature                  | Linux | macOS  | Windows/WSL | Notes                                 |
| ------------------------ | ----- | ------ | ----------- | ------------------------------------- |
| Build                    | [YES] | [YES]  | [YES]       | Go cross-compilation works everywhere |
| Unit Tests               | [YES] | [YES]  | [YES]       | 90%+ of tests are cross-platform      |
| Linux-Specific Tests     | [YES] | [SKIP] | [SKIP]      | Auto-skipped via build tags           |
| Docker Integration Tests | [YES] | [YES]  | [YES]       | Requires Docker                       |
| Port Discovery           | [YES] | [N/A]  | [N/A]       | Graceful fallback on non-Linux        |
| PID 1 Orphan Reaping     | [YES] | [N/A]  | [N/A]       | Only relevant in containers           |
| Production Deployment    | [YES] | [NO]   | [NO]        | linux/amd64 only                      |

**Legend:** [YES] Supported | [SKIP] Auto-skipped | [N/A] Not Available | [NO] Not Supported

### Troubleshooting

**"Tests are failing on my Mac"**

- Linux-specific tests are automatically skipped via build tags
- Run `go test -v ./...` to see which tests run
- Files like `*_linux_test.go` won't appear in test output on macOS

**"I need to test PID 1 behavior locally"**

- Use `make test-docker` to run full integration tests
- This builds and tests the actual linux/amd64 binary in a container
- Works from any platform with Docker installed

**"Port discovery isn't working on macOS"**

- This is expected behavior - port discovery only works on Linux
- Process restarts still work (port conflicts detected at bind time)
- Use `make test-docker` to verify port discovery in Linux container

### Project Structure

```
dev-supervisor/
├── main.go                        # Main application entry point
├── api.go                         # HTTP API endpoint handlers
├── internal/processmanager/        # Process lifecycle management
├── command_executor.go            # Command execution functionality
├── environment_manager.go         # Environment variable management
├── logging.go                     # Logging configuration and management
├── internal/                      # Internal packages
│   ├── auth/                      # JWT authentication
│   ├── config/                    # Configuration management
│   ├── health/                    # Health monitoring
│   ├── logs/                      # Log management
│   ├── ports/                     # Port discovery (Linux /proc, fallback)
│   ├── process/                   # Process management utilities
│   └── proxy/smtp/                # SMTP proxy
├── *_test.go                      # Cross-platform test files
├── *_linux_test.go                # Linux-specific test files
├── integration_test.go            # Cross-platform integration tests
├── docker_integration_test.go     # Docker integration test wrapper
├── test/
│   ├── Dockerfile.integration     # Docker image for integration tests
│   ├── docker-integration-tests.sh # Bash test suite for Docker
│   └── run-docker-tests.sh        # Docker test runner script
├── docs/
│   └── DEVELOPMENT.md             # Development guide
├── go.mod                         # Go module definition
├── go.sum                         # Go module checksums
├── Makefile                       # Build and development commands
├── Dockerfile                     # Docker container definition
├── .golangci.yml                  # Linter configuration
├── .gitignore                     # Git ignore patterns
└── README.md                      # This file
```

## API Endpoints

### Health and Status

- `GET /health` - Health check
- `GET /info` - System information

### Process Control

- `POST /process/start` - Start development process
- `POST /process/stop` - Stop current process
- `POST /process/restart` - Restart process
- `GET /process/status` - Get process status

### Command Execution

- `POST /exec` - Execute command with output capture

### Environment Management

- `GET /environment` - Get environment variables
- `PUT /environment` - Set environment variables
- `DELETE /environment` - Reset environment

### Log Management

- `GET /logs` - Get historical logs with filtering options

### Health Monitoring

- `GET /health-config` - Get health monitoring configuration and status
- `PUT /health-config` - Configure health checks and restart policies
- `GET /health-config/status` - Get current health status
- `GET /health-config/restart-stats` - Get restart statistics

## Docker Integration

### Using as PID 1 in containers

```dockerfile
FROM node:18-alpine
COPY dev-supervisor /usr/local/bin/dev-supervisor
ENTRYPOINT ["/usr/local/bin/dev-supervisor"]
CMD ["npm", "run", "dev"]
```

### Volume mounts for socket access

```yaml
# docker-compose.yml
services:
  app:
    build: .
    volumes:
      - /tmp/dev-sockets:/tmp:rw
```

## Configuration

### Environment Variables

- `DEV_SUPERVISOR_SOCKET_PATH`: Path for the Unix domain socket (default: `/tmp/dev-supervisor.sock`)

### Scheduler Awareness

Go 1.25 gives the runtime container-aware scheduling defaults. dev-supervisor calls `runtime.SetDefaultGOMAXPROCS` during startup so the process automatically honors cgroup CPU quotas even if `GOMAXPROCS` was previously fixed. To keep the automatic adjustments enabled, avoid setting `GOMAXPROCS` manually and ensure the new `GODEBUG` toggles remain active (the defaults are `containermaxprocs=1` and `updatemaxprocs=1`). Setting either toggle to `0` disables container detection or live updates; dev-supervisor logs a warning when those overrides are present to make diagnosing throttled containers easier.

### Logging

The service uses structured logging with the following behavior:

- **Terminal output**: Human-readable text format with key=value pairs
- **Non-terminal output**: JSON format for Docker containers, pipes, and log aggregation
- **Log level**: Info by default, includes debug messages for detailed troubleshooting

Example outputs:

```bash
# Terminal format
time=2025-09-03T13:15:00.000Z level=INFO msg="dev-supervisor starting" socket_path=/tmp/dev-supervisor.sock pid=12345

# JSON format (Docker/pipe)
{"time":"2025-09-03T13:15:00.000Z","level":"INFO","msg":"dev-supervisor starting","socket_path":"/tmp/dev-supervisor.sock","pid":12345}
```

### Default Settings

- **Socket Permissions**: `0666`
- **HTTP Timeouts**: 30s read/write, 60s idle
- **Shutdown Timeout**: 5s graceful shutdown

### Examples

```bash
# Use default socket path
./dev-supervisor

# Use custom socket path
DEV_SUPERVISOR_SOCKET_PATH=/custom/path/supervisor.sock ./dev-supervisor

# Docker container with custom socket path
docker run -e DEV_SUPERVISOR_SOCKET_PATH=/app/supervisor.sock myapp

# Configure SMTP proxy destination
SMTP_DESTINATION=smtp.example.com:587 ./dev-supervisor
```

## SMTP Proxy

dev-supervisor includes a built-in SMTP proxy that listens on localhost port 2525 and forwards email to a configurable destination. The proxy automatically injects tracking headers based on environment variables.

### Configuration

- **Listen Address**: `127.0.0.1:2525` (localhost only)
- **Default Destination**: `relay-hosting.secureserver.net:25`
- **Environment Variables**:
  - `SMTP_DESTINATION` - Set the target SMTP server (default: `relay-hosting.secureserver.net:25`)

### Injected Headers

The proxy automatically injects the following headers based on environment variables:

| Header          | Environment Variable | Default Value      |
| --------------- | -------------------- | ------------------ |
| `X-SITE-UID`    | `SITE_ID`            | `unknown`          |
| `X-PRODUCT`     | `PRODUCT`            | `airo-app-builder` |
| `X-ENVIRONMENT` | `NODE_ENV`           | `unknown`          |
| `X-DATACENTER`  | `NOMAD_DC`           | `unknown`          |

### Features

- Transparent SMTP proxy with automatic header injection
- Headers populated from environment variables
- Automatic startup/shutdown with dev-supervisor lifecycle
- Localhost-only listening for security
- Production-grade SMTP protocol handling

### Usage

Configure environment variables and start dev-supervisor:

```bash
# Use default SMTP destination with custom headers
SITE_ID="app-123" \
PRODUCT="my-app" \
NODE_ENV="production" \
NOMAD_DC="us-east-1" \
./dev-supervisor

# Configure custom SMTP destination
SMTP_DESTINATION=smtp.example.com:587 \
SITE_ID="app-456" \
./dev-supervisor

# In your application, configure email client to use:
# SMTP Host: 127.0.0.1
# SMTP Port: 2525
```

The proxy will intercept all email traffic and inject the configured headers before forwarding to the destination SMTP server.

## JWT Authentication

dev-supervisor includes JWT authentication for securing preview apps. It validates site-scoped JWT tokens issued by the builder app using public keys from a standard RFC 7517 JWKS endpoint.

### Configuration

JWT authentication is configured via environment variables and `/alloc/config.json`:

**Environment variables:**

| Variable                            | Required | Description                                                                                 |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `DEV_SUPERVISOR_ENABLE_JWT_AUTH`    | No       | Enable JWT authentication (default: `false`)                                                |
| `DEV_SUPERVISOR_JWKS_URL`           | Yes\*    | JWKS endpoint URL (e.g., `https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json`) |
| `DEV_SUPERVISOR_JWT_ISSUER`         | Yes\*    | Expected issuer claim (e.g., `airo-app`)                                                    |
| `DEV_SUPERVISOR_JWT_AUDIENCE`       | Yes\*    | Expected audience claim (e.g., `agents-service`)                                            |
| `DEV_SUPERVISOR_JWT_EXCLUDED_PATHS` | No       | Comma-separated paths to exclude from auth (default: `/airo/health`)                        |
| `SITE_ID`                           | Yes\*    | Site/app ID for siteId claim validation                                                     |
| `ALLOWED_ORIGINS`                   | No       | Comma-separated CORS allowed origins                                                        |

\*Required when JWT auth is enabled

**Values from `/alloc/config.json`:**

The alloc config path defaults to `/alloc/config.json` but respects `NOMAD_ALLOC_DIR` (e.g., `$NOMAD_ALLOC_DIR/config.json` in production).

| Key                | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `JWT_REDIRECT_URL` | Redirect URL for unauthenticated browser requests (smart redirect to builder) |

### Features

- **Standard RFC 7517 JWKS**: Fetches public keys from builder's `/.well-known/jwks.json` endpoint
- **Site-scoped validation**: Verifies JWT `siteId` claim matches container's `SITE_ID`
- **Hybrid mode**: Browser requests redirect to SSO, API requests return 401 JSON
- **Smart redirects**: Unauthenticated users redirected to builder with specific app opened
- **Key caching**: Public keys cached for 5 minutes to reduce JWKS endpoint load
- **CORS support**: Configurable origin whitelist for cross-domain requests

### JWKS Endpoint Format

The JWKS client expects standard RFC 7517 format:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "key-id",
      "use": "sig",
      "alg": "RS256",
      "n": "modulus-base64url",
      "e": "exponent-base64url"
    }
  ]
}
```

### Local Development Setup

For local development, set `NEXT_PUBLIC_APP_URL` in your builder app's environment:

```bash
# app/.env.local.dev
NEXT_PUBLIC_APP_URL=https://local.gasket.dev-godaddy.com:8443
```

This configures docker-compose to point dev-supervisor at your local JWKS endpoint instead of production.

### Example Configuration

```bash
# Enable JWT authentication
DEV_SUPERVISOR_ENABLE_JWT_AUTH=true

# JWKS endpoint (local development)
DEV_SUPERVISOR_JWKS_URL=https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json

# JWT claims validation
DEV_SUPERVISOR_JWT_ISSUER=airo-app
DEV_SUPERVISOR_JWT_AUDIENCE=agents-service

# Excluded paths (no auth required)
DEV_SUPERVISOR_JWT_EXCLUDED_PATHS=/airo/health

# Site ID for validation
SITE_ID=fc10ea7a-24ce-491e-9134-0604d423e8bc

# CORS allowed origins
ALLOWED_ORIGINS=https://local.gasket.dev-godaddy.com:8443,https://airo-builder.test-godaddy.com
```

And in `/alloc/config.json` (written by the builder's `config-json.ts` locally, `GenerateSystemSecretsTask` in production):

```json
{
  "JWT_REDIRECT_URL": {
    "SYSTEM_MANAGED": true,
    "VALUE": "https://local.gasket.dev-godaddy.com:8443/develop/fc10ea7a-24ce-491e-9134-0604d423e8bc?siteId=fc10ea7a-24ce-491e-9134-0604d423e8bc"
  }
}
```

### Security

- JWT signature validation using RS256 (RSA + SHA-256)
- Site ID enforcement prevents cross-site token usage
- Expiry validation ensures tokens are time-bound
- Generic error messages prevent information disclosure
- Public key caching with TTL to balance security and performance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting: `make check`
5. Submit a pull request

## License

[License to be determined]
