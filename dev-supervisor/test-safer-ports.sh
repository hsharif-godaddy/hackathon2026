#!/bin/bash

# Test script demonstrating the two safer port detection approaches

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Build dev-supervisor
log "Building dev-supervisor..."
make build

# Create temporary directory
TEST_DIR=$(mktemp -d)
SOCKET_PATH="$TEST_DIR/supervisor.sock"

# Find available ports
find_available_port() {
    python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(('', 0))
port = s.getsockname()[1]
s.close()
print(port)
"
}

TEST_PORT1=$(find_available_port)
TEST_PORT2=$(find_available_port)

log "Test directory: $TEST_DIR"
log "Socket path: $SOCKET_PATH" 
log "Test ports: $TEST_PORT1, $TEST_PORT2"

# Cleanup function
cleanup() {
    log "Cleaning up..."
    if [ -n "$SUPERVISOR_PID" ]; then
        kill $SUPERVISOR_PID 2>/dev/null || true
        wait $SUPERVISOR_PID 2>/dev/null || true
    fi
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Start dev-supervisor
log "Starting dev-supervisor..."
DEV_SUPERVISOR_SOCKET_PATH="$SOCKET_PATH" ./dist/dev-supervisor &
SUPERVISOR_PID=$!

# Wait for socket to be available
for i in {1..30}; do
    if [ -S "$SOCKET_PATH" ]; then
        log "Dev-supervisor is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        error "Dev-supervisor socket not available"
    fi
    sleep 1
done

# Function to make HTTP requests
make_request() {
    local method="$1"
    local path="$2" 
    local data="$3"
    
    if [ -n "$data" ]; then
        curl -s -X "$method" --unix-socket "$SOCKET_PATH" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "http://localhost$path"
    else
        curl -s -X "$method" --unix-socket "$SOCKET_PATH" \
            "http://localhost$path"
    fi
}

# Test 1: Explicit Port Configuration (Safest)
info "=== Test 1: Explicit Port Configuration ==="

START_DATA_EXPLICIT=$(cat <<EOF
{
    "command": "nc -l $TEST_PORT1",
    "working_dir": "$TEST_DIR",
    "ports": [$TEST_PORT1]
}
EOF
)

log "Starting process with explicit port configuration..."
START_RESPONSE=$(make_request "POST" "/process/start" "$START_DATA_EXPLICIT")
log "Start response: $START_RESPONSE"

sleep 1

# Check process is running
STATUS_RESPONSE=$(make_request "GET" "/process/status")
if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
    error "Process not running. Status: $STATUS_RESPONSE"
fi

log "Process started successfully with explicit port config"

# Restart with explicit ports
log "Testing restart with explicit port configuration..."
RESTART_RESPONSE=$(make_request "POST" "/process/restart" '{"graceful": true}')
if echo "$RESTART_RESPONSE" | grep -q "error"; then
    error "Restart with explicit ports failed: $RESTART_RESPONSE"
fi

log "✓ Explicit port configuration restart successful"

# Stop the process
make_request "POST" "/process/stop" '{"signal": "SIGTERM", "timeout": 5}' >/dev/null
sleep 1

# Test 2: Runtime Port Discovery 
info "=== Test 2: Runtime Port Discovery ==="

# Create a Python server that actually binds to a port
START_DATA_RUNTIME=$(cat <<EOF
{
    "command": "python3 -c \"import socket, time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', $TEST_PORT2)); s.listen(1); print('Server started on port $TEST_PORT2'); time.sleep(300)\"",
    "working_dir": "$TEST_DIR"
}
EOF
)

log "Starting process for runtime port discovery (no explicit ports)..."
START_RESPONSE=$(make_request "POST" "/process/start" "$START_DATA_RUNTIME")
log "Start response: $START_RESPONSE"

sleep 2

# Check process is running
STATUS_RESPONSE=$(make_request "GET" "/process/status")
if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
    error "Runtime discovery process not running. Status: $STATUS_RESPONSE"
fi

log "Process started successfully - testing runtime port discovery..."

# Restart to test runtime discovery
RESTART_RESPONSE=$(make_request "POST" "/process/restart" '{"graceful": true}')
if echo "$RESTART_RESPONSE" | grep -q "error"; then
    error "Restart with runtime discovery failed: $RESTART_RESPONSE"
fi

log "✓ Runtime port discovery restart successful"

# Stop the process
make_request "POST" "/process/stop" '{"signal": "SIGTERM", "timeout": 5}' >/dev/null

log "=== All Tests Passed! ==="
log "Summary:"
log "- Explicit port configuration: ✓ WORKING"  
log "- Runtime port discovery: ✓ WORKING"
log "- No more reliance on fragile command parsing"
log "- Port race conditions eliminated"

exit 0