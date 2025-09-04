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

### Project Structure

```
dev-supervisor/
├── main.go                     # Main application entry point
├── api.go                      # HTTP API endpoint handlers
├── health_monitor.go           # Health monitoring and restart policies
├── process_manager.go          # Process lifecycle management  
├── command_executor.go         # Command execution functionality
├── environment_manager.go      # Environment variable management
├── logging.go                  # Logging configuration and management
├── *_test.go                   # Test files
├── integration_test.go         # Integration tests
├── go.mod                      # Go module definition
├── go.sum                      # Go module checksums
├── Makefile                    # Build and development commands
├── Dockerfile                  # Docker container definition
├── .golangci.yml               # Linter configuration
├── .gitignore                  # Git ignore patterns
└── README.md                   # This file
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
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting: `make check`
5. Submit a pull request

## License

[License to be determined]