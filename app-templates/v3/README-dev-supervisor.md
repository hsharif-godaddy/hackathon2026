# Using dev-supervisor with V3 App Template

This template has been enhanced to use `dev-supervisor` as PID 1 in Docker containers, providing better process management, health monitoring, and development experience.

## What is dev-supervisor?

`dev-supervisor` is a containerized service that acts as PID 1 in Docker containers, providing:
- **Process Lifecycle Management**: Start, stop, restart development processes
- **Health Monitoring**: Configurable health checks with automatic restart policies
- **HTTP API**: RESTful interface over Unix domain sockets
- **Graceful Shutdown**: Proper signal handling and process cleanup
- **Real-time Log Management**: Centralized logging with filtering

## Quick Start

### 1. Build with dev-supervisor

```bash
# From app-templates/v3 directory
./build-with-supervisor.sh
```

### 2. Run with Docker Compose

```bash
docker-compose -f docker-compose.dev.yml up
```

### 3. Access your application

- **Frontend**: http://localhost:5173 (or your PREFERRED_FRONTEND_PORT)
- **Backend API**: http://localhost:3000/api

## dev-supervisor API

The supervisor exposes an HTTP API over Unix domain socket at `/tmp/supervisor/dev-supervisor.sock`.

### Health & Status

```bash
# Check supervisor health
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/health

# Get detailed system info
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/info
```

### Process Management

```bash
# Get process status
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/process/status

# Restart the development process
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  -X POST http://localhost/process/restart

# Stop the process
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  -X POST http://localhost/process/stop
```

### Execute Commands

```bash
# Execute a command inside the container
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"command": "npm list", "timeout": 30}' \
  http://localhost/exec
```

### Log Management

```bash
# Get recent logs
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/logs

# Get logs with filtering
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  "http://localhost/logs?source=stdout&lines=100"
```

## Health Monitoring

Configure health checks for automatic restart on failure:

```bash
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "health_check": {
      "type": "http",
      "url": "http://localhost:5173/",
      "interval": "30s",
      "timeout": "10s",
      "failure_threshold": 3
    },
    "restart_policy": {
      "enabled": true,
      "max_restarts": 5,
      "restart_window": "5m"
    }
  }' \
  http://localhost/health-config
```

## Environment Variables

Key environment variables for dev-supervisor integration:

- `DEV_SUPERVISOR_SOCKET_PATH`: Socket path (default: `/tmp/supervisor/dev-supervisor.sock`)
- `PREFERRED_FRONTEND_PORT`: Frontend port preference
- `RUNNING_IN_DOCKER`: Enables Docker-specific configurations

## Benefits

### 1. **Better Process Management**
- Proper PID 1 behavior with zombie reaping
- Graceful shutdown handling
- Process restart capabilities

### 2. **Development Experience**
- Real-time process monitoring
- Command execution without container exec
- Centralized logging with filtering

### 3. **Production Readiness**
- Health monitoring with automatic recovery
- Structured logging (JSON in containers)
- Configurable timeouts and restart policies

### 4. **Debugging & Monitoring**
- REST API for process introspection
- Log streaming and filtering
- Process restart statistics

## File Structure

```
app-templates/v3/
├── Dockerfile.dev              # Enhanced with dev-supervisor
├── docker-compose.dev.yml      # Docker Compose configuration
├── build-with-supervisor.sh    # Build script
└── README-dev-supervisor.md    # This documentation
```

## Troubleshooting

### Container won't start
```bash
# Check supervisor logs
docker-compose -f docker-compose.dev.yml logs app

# Check if dev-supervisor binary exists
docker-compose -f docker-compose.dev.yml exec app ls -la /usr/local/bin/dev-supervisor
```

### Process not responding
```bash
# Check process status
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/process/status

# Get recent logs
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/logs?lines=50
```

### Health check failures
```bash
# Check health status
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/health-config/status

# Get restart statistics
curl --unix-socket /tmp/dev-supervisor-sockets/dev-supervisor.sock \
  http://localhost/health-config/restart-stats
```

## Integration with Airo AI Builder

This enhanced template integrates seamlessly with the Airo AI Builder's DockerAppService, providing:
- Better process lifecycle management
- Enhanced monitoring and debugging capabilities
- Production-ready container behavior
- Consistent development experience across all templates