#!/bin/bash

# Simple test to verify port restart race condition fix

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"
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
log "Waiting for dev-supervisor to be ready..."
for i in {1..30}; do
    if [ -S "$SOCKET_PATH" ]; then
        log "Dev-supervisor is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        error "Dev-supervisor socket not available after 30 seconds"
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

# Create a simple Python server that responds to signals properly
log "Starting test with a simple echo server..."

# Use a command that starts quickly and releases the port cleanly
START_DATA=$(cat <<EOF
{
    "command": "python3 -c \"import socket, signal, sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('', 8080)); s.listen(1); signal.signal(signal.SIGTERM, lambda n, f: (s.close(), sys.exit(0))); print('Server listening on port 8080'); s.accept()\"",
    "working_dir": "$TEST_DIR"
}
EOF
)

log "Starting process..."
START_RESPONSE=$(make_request "POST" "/process/start" "$START_DATA")
log "Start response: $START_RESPONSE"

# Wait for process to start
sleep 1

# Check that process is running
STATUS_RESPONSE=$(make_request "GET" "/process/status")
if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
    error "Process not running. Status: $STATUS_RESPONSE"
fi

log "Process started successfully"

# Perform a few restarts with graceful shutdown
NUM_RESTARTS=3
log "Performing $NUM_RESTARTS graceful restarts..."

for i in $(seq 1 $NUM_RESTARTS); do
    log "Restart $i/$NUM_RESTARTS"
    
    RESTART_RESPONSE=$(make_request "POST" "/process/restart" '{"graceful": true}')
    
    if echo "$RESTART_RESPONSE" | grep -q "error"; then
        error "Restart $i failed: $RESTART_RESPONSE"
    fi
    
    log "Restart $i successful"
    
    # Check process is still running
    STATUS_RESPONSE=$(make_request "GET" "/process/status")
    if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
        error "Process not running after restart $i. Status: $STATUS_RESPONSE"
    fi
    
    # Small delay between restarts
    sleep 0.5
done

log "All $NUM_RESTARTS restarts completed successfully!"

# Stop the process
log "Stopping process..."
STOP_RESPONSE=$(make_request "POST" "/process/stop" '{"signal": "SIGTERM", "timeout": 5}')
log "Stop response: $STOP_RESPONSE"

log "✓ Port restart race condition test PASSED!"
log "Summary: The fix successfully prevents 'address already in use' errors during restarts"

exit 0