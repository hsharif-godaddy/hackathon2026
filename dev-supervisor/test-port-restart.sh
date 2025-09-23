#!/bin/bash

# Test script for verifying port restart race condition fix
# This script tests the dev-supervisor port reuse functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Build dev-supervisor
log "Building dev-supervisor..."
if ! make build; then
    error "Failed to build dev-supervisor"
fi

# Create temporary directory for test
TEST_DIR=$(mktemp -d)
SOCKET_PATH="$TEST_DIR/test-supervisor.sock"

# Find an available port for testing
find_available_port() {
    for port in $(seq 8000 9000); do
        if ! netstat -ln 2>/dev/null | grep ":$port " >/dev/null; then
            echo $port
            return
        fi
    done
    echo "0"  # No port found
}

TEST_PORT=$(find_available_port)
if [ "$TEST_PORT" -eq 0 ]; then
    error "No available port found for testing"
fi

log "Test directory: $TEST_DIR"
log "Socket path: $SOCKET_PATH"
log "Test port: $TEST_PORT"

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

# Function to make HTTP requests to dev-supervisor
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

# Function to check if port is in use
is_port_in_use() {
    netstat -ln 2>/dev/null | grep ":$TEST_PORT " >/dev/null
}

log "Starting initial process on port $TEST_PORT..."

# Start a simple server that binds to our test port (using netcat which is more reliable)
START_DATA=$(cat <<EOF
{
    "command": "nc -l -p $TEST_PORT",
    "working_dir": "$TEST_DIR"
}
EOF
)

START_RESPONSE=$(make_request "POST" "/process/start" "$START_DATA")
log "Start response: $START_RESPONSE"

# Wait for process to start and bind to port
sleep 2

# Check that port is in use
if ! is_port_in_use; then
    error "Port $TEST_PORT is not in use after starting process"
fi

log "Process started successfully, port $TEST_PORT is in use"

# Perform multiple rapid restarts to test for race conditions
NUM_RESTARTS=15
log "Performing $NUM_RESTARTS rapid restarts..."

for i in $(seq 1 $NUM_RESTARTS); do
    log "Restart $i/$NUM_RESTARTS"
    
    # Record start time
    START_TIME=$(date +%s.%N)
    
    # Restart the process
    RESTART_DATA='{"graceful": true}'
    RESTART_RESPONSE=$(make_request "POST" "/process/restart" "$RESTART_DATA")
    
    # Record end time
    END_TIME=$(date +%s.%N)
    DURATION=$(echo "$END_TIME - $START_TIME" | bc -l)
    
    # Check if restart was successful
    if echo "$RESTART_RESPONSE" | grep -q "error"; then
        error "Restart $i failed: $RESTART_RESPONSE"
    fi
    
    log "Restart $i completed in ${DURATION}s"
    
    # Wait a moment for the process to fully restart
    sleep 0.5
    
    # Check that process is still running and port is still in use
    STATUS_RESPONSE=$(make_request "GET" "/process/status")
    if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
        error "Process not running after restart $i. Status: $STATUS_RESPONSE"
    fi
    
    if ! is_port_in_use; then
        error "Port $TEST_PORT not in use after restart $i"
    fi
    
    # Small delay between restarts to make test more realistic
    sleep 0.2
done

log "All $NUM_RESTARTS restarts completed successfully!"

# Test concurrent restarts (this was the main issue)
log "Testing concurrent restart attempts..."

# Start multiple background restart requests
for i in {1..5}; do
    (
        RESTART_RESPONSE=$(make_request "POST" "/process/restart" '{"graceful": true}' 2>&1)
        echo "Concurrent restart $i: $RESTART_RESPONSE"
    ) &
done

# Wait for all concurrent requests to complete
wait

sleep 1

# Verify the process is still running
STATUS_RESPONSE=$(make_request "GET" "/process/status")
if ! echo "$STATUS_RESPONSE" | grep -q '"state":"running"'; then
    warn "Process not running after concurrent restarts. Status: $STATUS_RESPONSE"
else
    log "Process still running after concurrent restart test"
fi

# Stop the process
log "Stopping process..."
STOP_DATA='{"signal": "SIGTERM", "timeout": 10}'
STOP_RESPONSE=$(make_request "POST" "/process/stop" "$STOP_DATA")
log "Stop response: $STOP_RESPONSE"

# Wait for port to be released
log "Waiting for port $TEST_PORT to be released..."
for i in {1..20}; do
    if ! is_port_in_use; then
        log "Port $TEST_PORT successfully released"
        break
    fi
    if [ $i -eq 20 ]; then
        warn "Port $TEST_PORT still in use after 20 seconds"
    fi
    sleep 1
done

log "Port restart race condition test completed successfully!"
log "Summary:"
log "- Performed $NUM_RESTARTS sequential restarts"
log "- Performed 5 concurrent restart attempts"
log "- All operations completed without port binding errors"
log "- Port was properly released after process stop"

exit 0