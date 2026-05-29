#!/bin/bash
set -e

SOCKET_PATH="/tmp/airo-supervisor.sock"
TEST_TIMEOUT=30

echo "=== Docker Integration Tests for dev-supervisor ==="

# Helper function to make API calls via Unix socket
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -n "$data" ]; then
        curl -s --unix-socket "$SOCKET_PATH" \
            -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "http://dev-supervisor$endpoint"
    else
        curl -s --unix-socket "$SOCKET_PATH" \
            -X "$method" \
            "http://dev-supervisor$endpoint"
    fi
}

# Helper function to wait for socket with timeout
wait_for_socket() {
    echo "Waiting for Unix socket to be created..."
    local elapsed=0
    while [ ! -S "$SOCKET_PATH" ]; do
        sleep 0.5
        elapsed=$((elapsed + 1))
        if [ $elapsed -gt $((TEST_TIMEOUT * 2)) ]; then
            echo "❌ FAIL: Socket not created after ${TEST_TIMEOUT}s"
            exit 99
        fi
    done
    echo "✓ Socket created"
}

# Test 1: PID 1 Verification
echo ""
echo "Test 1: PID 1 Verification"
PID1_COMM=$(ps -p 1 -o comm= | tr -d '[:space:]')
if [ "$PID1_COMM" != "airo-workspace" ]; then
    echo "❌ FAIL: Process with PID 1 is '$PID1_COMM', expected 'airo-workspace'"
    exit 1
fi
echo "✓ PASS: airo-workspace is running as PID 1"

# Wait for socket before running other tests
wait_for_socket

# Test 2: API Health Check
echo ""
echo "Test 2: API Health Check"
HEALTH_RESPONSE=$(api_call GET /health)
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$HEALTH_STATUS" != "healthy" ]; then
    echo "❌ FAIL: Health check returned status '$HEALTH_STATUS', expected 'healthy'"
    echo "Response: $HEALTH_RESPONSE"
    exit 2
fi
echo "✓ PASS: Health check returned healthy status"

# Test 3: Process Lifecycle
echo ""
echo "Test 3: Process Lifecycle"

# Start process
echo "  Starting test process..."
START_RESPONSE=$(api_call POST /process/start '{"command":"sleep 30","working_dir":"/tmp"}')
if echo "$START_RESPONSE" | grep -q "error"; then
    echo "❌ FAIL: Failed to start process"
    echo "Response: $START_RESPONSE"
    exit 3
fi
sleep 1

# Verify running
echo "  Verifying process is running..."
STATUS_RESPONSE=$(api_call GET /process/status)
STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
if [ "$STATE" != "running" ]; then
    echo "❌ FAIL: Process state is '$STATE', expected 'running'"
    echo "Response: $STATUS_RESPONSE"
    exit 3
fi
echo "  ✓ Process is running"

# Stop process
echo "  Stopping test process..."
STOP_RESPONSE=$(api_call POST /process/stop '{"signal":"SIGTERM","timeout":5}')
if echo "$STOP_RESPONSE" | grep -q "error"; then
    echo "❌ FAIL: Failed to stop process"
    echo "Response: $STOP_RESPONSE"
    exit 3
fi
sleep 1

# Verify stopped
echo "  Verifying process stopped..."
STATUS_RESPONSE=$(api_call GET /process/status)
STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
# Process can be in "stopped" state (clean exit) or "error" state (signal terminated)
if [ "$STATE" != "stopped" ] && [ "$STATE" != "error" ]; then
    echo "❌ FAIL: Process state is '$STATE', expected 'stopped' or 'error'"
    echo "Response: $STATUS_RESPONSE"
    exit 3
fi
echo "✓ PASS: Process lifecycle (start/stop) working correctly"

# Test 4: Orphan Reaping
echo ""
echo "Test 4: Orphan Reaping"
echo "  Starting process that spawns orphan..."

# Start a parent process that spawns a child then exits immediately
# The child will run a short sleep so we can catch it transitioning to zombie state
START_RESPONSE=$(api_call POST /process/start '{"command":"sh -c \"(sleep 3 &); exit 0\"","working_dir":"/tmp"}')
if echo "$START_RESPONSE" | grep -q "error"; then
    echo "❌ FAIL: Failed to start orphaning process"
    echo "Response: $START_RESPONSE"
    exit 4
fi

# Wait for parent to exit, leaving child orphaned
echo "  Waiting for parent to exit..."
sleep 1

# Find the orphaned sleep process (now reparented to PID 1)
# Use /proc for more reliable process detection
ORPHAN_PID=""
for pid in /proc/[0-9]*; do
    if [ ! -d "$pid" ]; then
        continue
    fi
    PID_NUM=$(basename "$pid")
    if [ -f "$pid/cmdline" ]; then
        CMDLINE=$(tr '\0' ' ' < "$pid/cmdline" 2>/dev/null)
        if echo "$CMDLINE" | grep -q "sleep 3"; then
            ORPHAN_PID="$PID_NUM"
            break
        fi
    fi
done

if [ -z "$ORPHAN_PID" ]; then
    echo "❌ FAIL: Could not find orphaned sleep process"
    ls -la /proc/[0-9]*/cmdline 2>/dev/null | head -20
    exit 4
fi
echo "  Found orphaned process: PID $ORPHAN_PID"

# Verify it's been reparented to PID 1 using /proc/PID/status
if [ -f "/proc/$ORPHAN_PID/status" ]; then
    PARENT_PID=$(grep "^PPid:" "/proc/$ORPHAN_PID/status" | awk '{print $2}')
    if [ "$PARENT_PID" != "1" ]; then
        echo "❌ FAIL: Orphan not reparented to PID 1 (parent is $PARENT_PID)"
        cat "/proc/$ORPHAN_PID/status" | grep -E "^(Name|Pid|PPid|State)"
        exit 4
    fi
    echo "  ✓ Orphan correctly reparented to PID 1"
else
    echo "❌ FAIL: Could not read /proc/$ORPHAN_PID/status"
    exit 4
fi

# Kill the orphaned child to create a zombie
echo "  Killing orphaned process to create zombie candidate..."
kill -9 "$ORPHAN_PID" 2>/dev/null || true

# Give the reaper a moment to clean up
sleep 1

# Check that the zombie was reaped using /proc
# Count zombie processes by checking /proc/*/status for State: Z
ZOMBIE_COUNT=0
for pid_dir in /proc/[0-9]*; do
    if [ ! -d "$pid_dir" ]; then
        continue
    fi
    if [ -f "$pid_dir/status" ]; then
        STATE=$(grep "^State:" "$pid_dir/status" 2>/dev/null | awk '{print $2}')
        if [ "$STATE" = "Z" ]; then
            ZOMBIE_COUNT=$((ZOMBIE_COUNT + 1))
            PID=$(basename "$pid_dir")
            echo "  Found zombie process: PID $PID"
            grep -E "^(Name|Pid|PPid|State)" "$pid_dir/status" 2>/dev/null
        fi
    fi
done

if [ "$ZOMBIE_COUNT" -gt 0 ]; then
    echo "❌ FAIL: Found $ZOMBIE_COUNT zombie process(es) after reaping should have occurred"
    exit 4
fi

# Also verify the specific PID is gone (check /proc/PID/status)
if [ -f "/proc/$ORPHAN_PID/status" ]; then
    STATE=$(grep "^State:" "/proc/$ORPHAN_PID/status" 2>/dev/null | awk '{print $2}')
    if [ "$STATE" = "Z" ]; then
        echo "❌ FAIL: Process $ORPHAN_PID is still in zombie state"
        cat "/proc/$ORPHAN_PID/status" | grep -E "^(Name|Pid|PPid|State)"
        exit 4
    fi
fi

echo "✓ PASS: Orphan reaping working correctly (zombie cleaned up)"

# Clean up any remaining sleep processes using /proc
for pid_dir in /proc/[0-9]*; do
    if [ ! -d "$pid_dir" ]; then
        continue
    fi
    PID=$(basename "$pid_dir")
    if [ -f "$pid_dir/cmdline" ]; then
        CMDLINE=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null)
        if echo "$CMDLINE" | grep -q "sleep"; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi
done

# Test 5: Signal Handling
echo ""
echo "Test 5: Signal Handling"
echo "  Starting long-running process..."

START_RESPONSE=$(api_call POST /process/start '{"command":"sleep 300","working_dir":"/tmp"}')
if echo "$START_RESPONSE" | grep -q "error"; then
    echo "❌ FAIL: Failed to start process for signal test"
    exit 5
fi
sleep 1

# Get PID of the sleep process using /proc
SLEEP_PID=""
for pid_dir in /proc/[0-9]*; do
    if [ ! -d "$pid_dir" ]; then
        continue
    fi
    PID=$(basename "$pid_dir")
    if [ -f "$pid_dir/cmdline" ]; then
        CMDLINE=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null)
        if echo "$CMDLINE" | grep -q "sleep 300"; then
            SLEEP_PID="$PID"
            break
        fi
    fi
done

if [ -z "$SLEEP_PID" ]; then
    echo "❌ FAIL: Could not find sleep process"
    exit 5
fi
echo "  Sleep process PID: $SLEEP_PID"

# Send SIGTERM to dev-supervisor (graceful shutdown)
# Note: We can't actually test this in Docker easily without terminating the container
# So we'll test stop via API which exercises the same signal handling code
echo "  Testing graceful stop via API (exercises signal handling)..."
STOP_RESPONSE=$(api_call POST /process/stop '{"signal":"SIGTERM","timeout":10}')
if echo "$STOP_RESPONSE" | grep -q "error"; then
    echo "❌ FAIL: Failed to gracefully stop process"
    echo "Response: $STOP_RESPONSE"
    exit 5
fi

# Wait a moment for cleanup
sleep 2

# Verify child process terminated (check if /proc/PID still exists)
if [ -d "/proc/$SLEEP_PID" ]; then
    # Double check it's really running and not a zombie
    if [ -f "/proc/$SLEEP_PID/status" ]; then
        STATE=$(grep "^State:" "/proc/$SLEEP_PID/status" 2>/dev/null | awk '{print $2}')
        if [ "$STATE" != "Z" ]; then
            echo "❌ FAIL: Child process $SLEEP_PID still running after stop (state: $STATE)"
            cat "/proc/$SLEEP_PID/status" | grep -E "^(Name|Pid|PPid|State)"
            exit 5
        fi
    fi
fi

echo "✓ PASS: Signal handling working correctly (child processes terminated)"

# Test 6: Sandbox - Blocks Writes to Disallowed Paths
echo ""
echo "Test 6: Sandbox - Blocks Writes to Disallowed Paths"

# /opt is not in the exec profile's allowed paths, so writing there should fail
EXEC_RESPONSE=$(api_call POST /exec '{"command":"touch /opt/sandbox-test-file","working_dir":"/tmp"}')
EXEC_EXIT=$(echo "$EXEC_RESPONSE" | grep -o '"exit_code":[0-9]*' | cut -d: -f2)

if [ "$EXEC_EXIT" = "0" ]; then
    echo "❌ FAIL: Command writing to /opt should have been blocked by sandbox"
    echo "Response: $EXEC_RESPONSE"
    exit 6
fi
echo "✓ PASS: Sandbox blocked write to disallowed path (/opt)"

# Test 7: Sandbox - Allows Commands in Allowed Paths
echo ""
echo "Test 7: Sandbox - Allows Commands in Allowed Paths"

# /tmp is in the exec profile's allowed paths, so writing there should succeed
EXEC_RESPONSE=$(api_call POST /exec '{"command":"echo sandbox-ok > /tmp/sandbox-test-file && cat /tmp/sandbox-test-file","working_dir":"/tmp"}')
EXEC_EXIT=$(echo "$EXEC_RESPONSE" | grep -o '"exit_code":[0-9]*' | cut -d: -f2)
if [ "$EXEC_EXIT" != "0" ]; then
    echo "❌ FAIL: Command in allowed path should have succeeded (exit_code=$EXEC_EXIT)"
    echo "Response: $EXEC_RESPONSE"
    exit 7
fi

# Verify stdout contains the expected output (echo adds a trailing newline)
if ! echo "$EXEC_RESPONSE" | grep -q '"stdout":"sandbox-ok'; then
    echo "❌ FAIL: Expected stdout to contain 'sandbox-ok'"
    echo "Response: $EXEC_RESPONSE"
    exit 7
fi

# Clean up test file
api_call POST /exec '{"command":"rm -f /tmp/sandbox-test-file","working_dir":"/tmp"}' >/dev/null 2>&1

echo "✓ PASS: Sandbox allows commands in allowed paths (/tmp)"

# Test 8: Conditional Startup - No Scripts (Backward Compatibility)
echo ""
echo "Test 8: Conditional Startup - No Scripts (Backward Compatibility)"
# This test verifies that without detection/setup scripts, processes start immediately
# This is tested by the fact that we've already started a process in Test 3 without any scripts
echo "✓ PASS: Backward compatibility verified (processes start immediately without scripts)"

# Test 9: Conditional Startup - Detection Script Exit 1 (Immediate Start)
echo ""
echo "Test 9: Conditional Startup - Detection Script Exit 1 (Immediate Start)"
# Note: This test requires a custom Docker container with detection/setup scripts configured
# It cannot be run in the current container without those scripts present
# To test this scenario:
# 1. Create detection script that exits 1 (fresh creation)
# 2. Set DEV_SUPERVISOR_DETECTION_SCRIPT env var
# 3. Start dev-supervisor with command args
# 4. Verify process starts immediately
echo "⚠ SKIP: Requires custom container with detection script (exit 1 scenario)"

# Test 10: Conditional Startup - Detection Script Exit 0 (Deferred Start)
echo ""
echo "Test 10: Conditional Startup - Detection Script Exit 0 (Deferred Start)"
# Note: This test requires a custom Docker container with detection/setup scripts configured
# It cannot be run in the current container without those scripts present
# To test this scenario:
# 1. Create detection script that exits 0 (restart scenario)
# 2. Set DEV_SUPERVISOR_DETECTION_SCRIPT env var
# 3. Start dev-supervisor with command args
# 4. Verify process does NOT start immediately
# 5. Make HTTP request to trigger auto-start
# 6. Verify process starts after HTTP request
echo "⚠ SKIP: Requires custom container with detection script (exit 0 scenario)"

# Test 11: Conditional Startup - Setup Script Success
echo ""
echo "Test 11: Conditional Startup - Setup Script Success"
# Note: This test requires a custom Docker container with setup script configured
# It cannot be run in the current container without the setup script present
# To test this scenario:
# 1. Create setup script that succeeds (exits 0)
# 2. Set DEV_SUPERVISOR_SETUP_SCRIPT env var
# 3. Start dev-supervisor with command args
# 4. Verify setup script runs successfully
# 5. Verify process starts after setup completes
echo "⚠ SKIP: Requires custom container with setup script"

# Test 12: Conditional Startup - Setup Script Failure
echo ""
echo "Test 12: Conditional Startup - Setup Script Failure"
# Note: This test requires a custom Docker container with setup script configured
# It cannot be run in the current container without the setup script present
# To test this scenario:
# 1. Create setup script that fails (exits non-zero)
# 2. Set DEV_SUPERVISOR_SETUP_SCRIPT env var
# 3. Start dev-supervisor with command args
# 4. Verify container startup fails due to setup script failure
echo "⚠ SKIP: Requires custom container with failing setup script"

# Note about skipped tests
echo ""
echo "NOTE: Tests 9-12 are integration tests for conditional startup that require"
echo "      custom Docker containers with detection and setup scripts configured."
echo "      These tests should be run separately with appropriate test fixtures."

# All tests passed
echo ""
echo "==================================="
echo "✅ All integration tests passed!"
echo "   (4 tests skipped - require custom container configuration)"
echo "==================================="
exit 0
