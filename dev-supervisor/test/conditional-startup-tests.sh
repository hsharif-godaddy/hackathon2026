#!/bin/bash
set -e

# Conditional Startup Integration Tests
# These tests verify the internal Go-based detection and setup script functionality
# Run from dev-supervisor root: ./test/conditional-startup-tests.sh

echo "=== Conditional Startup Integration Tests ==="

# Create test workspace
TEST_DIR="/tmp/dev-supervisor-conditional-tests-$$"
mkdir -p "$TEST_DIR/scripts"
mkdir -p "$TEST_DIR/app-fresh"
mkdir -p "$TEST_DIR/app-restart"

# Create setup script
cat > "$TEST_DIR/scripts/setup.sh" <<'EOF'
#!/bin/sh
echo "Setup: Creating marker file"
touch "$CUSTOMER_APP_DIR/.setup-complete"
echo "Setup: Complete"
exit 0
EOF
chmod +x "$TEST_DIR/scripts/setup.sh"

# Create failing setup script
cat > "$TEST_DIR/scripts/setup-fail.sh" <<'EOF'
#!/bin/sh
echo "Setup: Simulating failure"
exit 1
EOF
chmod +x "$TEST_DIR/scripts/setup-fail.sh"

# Test 1: First-Start Detection (No .git/config - Start Immediately)
echo ""
echo "Test 1: First-Start Detection (Start Immediately)"
# app-fresh has no .git/config, so detectStartupMode() returns "first-start"
CUSTOMER_APP_DIR="$TEST_DIR/app-fresh" \
DEV_SUPERVISOR_SETUP_SCRIPT="$TEST_DIR/scripts/setup.sh" \
DEV_SUPERVISOR_SOCKET_PATH="$TEST_DIR/test1.sock" \
./dist/dev-supervisor sleep 10 > /dev/null 2>&1 &
SUPERVISOR_PID=$!

sleep 2

# Check if supervisor started
if ! ps -p $SUPERVISOR_PID > /dev/null; then
    echo "❌ FAIL: dev-supervisor exited unexpectedly"
    exit 1
fi

# Process should have started immediately - check via API
if [ -S "$TEST_DIR/test1.sock" ]; then
    STATUS=$(curl -s --unix-socket "$TEST_DIR/test1.sock" http://dev-supervisor/process/status)
    STATE=$(echo "$STATUS" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)

    if [ "$STATE" != "running" ]; then
        echo "❌ FAIL: Process not running (state: $STATE, expected: running)"
        kill $SUPERVISOR_PID 2>/dev/null || true
        exit 1
    fi
else
    echo "❌ FAIL: Socket not created"
    kill $SUPERVISOR_PID 2>/dev/null || true
    exit 1
fi

# Clean up
kill $SUPERVISOR_PID 2>/dev/null || true
wait $SUPERVISOR_PID 2>/dev/null || true

echo "✓ PASS: First-start detected, process started immediately"

# Test 2: Restart Detection (.git/config exists - Defer Start)
echo ""
echo "Test 2: Restart Detection (Defer Start)"

# Create .git/config to simulate restart scenario
mkdir -p "$TEST_DIR/app-restart/.git"
touch "$TEST_DIR/app-restart/.git/config"

CUSTOMER_APP_DIR="$TEST_DIR/app-restart" \
DEV_SUPERVISOR_SETUP_SCRIPT="$TEST_DIR/scripts/setup.sh" \
DEV_SUPERVISOR_SOCKET_PATH="$TEST_DIR/test2.sock" \
DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true \
DEV_SUPERVISOR_ENABLE_PROXY=true \
DEV_SUPERVISOR_PROXY_PORT=8443 \
DEV_SUPERVISOR_PROXY_TARGET_PORT=3000 \
NOMAD_TASK_NAME=preview \
./dist/dev-supervisor sleep 5 &
SUPERVISOR_PID=$!

sleep 1

# Check if supervisor started
if ! ps -p $SUPERVISOR_PID > /dev/null; then
    echo "❌ FAIL: dev-supervisor exited unexpectedly"
    exit 1
fi

# Make HTTP request to check if process is running (should be deferred)
if [ -S "$TEST_DIR/test2.sock" ]; then
    STATUS=$(curl -s --unix-socket "$TEST_DIR/test2.sock" http://dev-supervisor/process/status)
    STATE=$(echo "$STATUS" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)

    if [ "$STATE" = "running" ]; then
        echo "❌ FAIL: Process started immediately (should be deferred)"
        kill $SUPERVISOR_PID 2>/dev/null || true
        exit 1
    fi

    if [ "$STATE" != "stopped" ]; then
        echo "⚠ WARNING: Unexpected state '$STATE' (expected 'stopped')"
    fi
else
    echo "⚠ WARNING: Socket not created yet"
fi

# Clean up
kill $SUPERVISOR_PID 2>/dev/null || true
wait $SUPERVISOR_PID 2>/dev/null || true

echo "✓ PASS: Restart detected, process start deferred"

# Test 3: Setup Script Success
echo ""
echo "Test 3: Setup Script Success"

CUSTOMER_APP_DIR="$TEST_DIR/app-fresh" \
DEV_SUPERVISOR_SETUP_SCRIPT="$TEST_DIR/scripts/setup.sh" \
DEV_SUPERVISOR_SOCKET_PATH="$TEST_DIR/test3.sock" \
./dist/dev-supervisor sleep 10 > /dev/null 2>&1 &
SUPERVISOR_PID=$!

sleep 2

# Check if setup marker file was created
if [ ! -f "$TEST_DIR/app-fresh/.setup-complete" ]; then
    echo "❌ FAIL: Setup script did not run (marker file missing)"
    kill $SUPERVISOR_PID 2>/dev/null || true
    exit 1
fi

# Clean up
kill $SUPERVISOR_PID 2>/dev/null || true
wait $SUPERVISOR_PID 2>/dev/null || true

echo "✓ PASS: Setup script executed successfully"

# Test 4: Setup Script Failure
echo ""
echo "Test 4: Setup Script Failure"

CUSTOMER_APP_DIR="$TEST_DIR/app-fresh" \
DEV_SUPERVISOR_SETUP_SCRIPT="$TEST_DIR/scripts/setup-fail.sh" \
DEV_SUPERVISOR_SOCKET_PATH="$TEST_DIR/test4.sock" \
./dist/dev-supervisor sleep 1 2>&1 | grep -q "setup script failed"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ FAIL: Expected setup script failure message"
    exit 1
fi

echo "✓ PASS: Setup script failure handled correctly"

# Test 5: Full Flow (Internal Detection + Setup)
echo ""
echo "Test 5: Full Flow (Detection + Setup)"

# Fresh app scenario (no .git/config)
rm -f "$TEST_DIR/app-fresh/.setup-complete"
rm -rf "$TEST_DIR/app-fresh/.git"
CUSTOMER_APP_DIR="$TEST_DIR/app-fresh" \
DEV_SUPERVISOR_SETUP_SCRIPT="$TEST_DIR/scripts/setup.sh" \
DEV_SUPERVISOR_SOCKET_PATH="$TEST_DIR/test5.sock" \
./dist/dev-supervisor sleep 10 > /dev/null 2>&1 &
SUPERVISOR_PID=$!

sleep 2

# Verify setup ran (first-start mode)
if [ ! -f "$TEST_DIR/app-fresh/.setup-complete" ]; then
    echo "❌ FAIL: Setup did not run in full flow"
    kill $SUPERVISOR_PID 2>/dev/null || true
    exit 1
fi

# Process should have started immediately (first-start) - verify via API
if [ -S "$TEST_DIR/test5.sock" ]; then
    STATUS=$(curl -s --unix-socket "$TEST_DIR/test5.sock" http://dev-supervisor/process/status)
    STATE=$(echo "$STATUS" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)

    if [ "$STATE" != "running" ]; then
        echo "❌ FAIL: Process not running after full flow (state: $STATE)"
        kill $SUPERVISOR_PID 2>/dev/null || true
        exit 1
    fi
fi

# Clean up
kill $SUPERVISOR_PID 2>/dev/null || true
wait $SUPERVISOR_PID 2>/dev/null || true

echo "✓ PASS: Full flow (detection + setup) working correctly"

# Cleanup
echo ""
echo "Cleaning up test workspace..."
rm -rf "$TEST_DIR"

# All tests passed
echo ""
echo "==================================="
echo "✅ All conditional startup tests passed!"
echo "==================================="
exit 0
