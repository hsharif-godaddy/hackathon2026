#!/bin/bash
set -e

echo "Building Docker image for integration tests..."
docker build -f test/Dockerfile.integration -t dev-supervisor:test .

echo ""
echo "Running integration tests in Docker..."

# Start container with dev-supervisor as PID 1 (no supervised process)
CONTAINER_NAME="dev-supervisor-test-$$"

# Start container in detached mode with no command arguments
# This makes dev-supervisor PID 1 but with no supervised child process
if ! docker run -d --name "$CONTAINER_NAME" \
    --init=false \
    -e DEV_SUPERVISOR_SANDBOX_ENABLED=true \
    -v /tmp/test-docker-integration:/tmp \
    dev-supervisor:test; then
    echo "❌ Failed to start container"
    exit 99
fi

# Give dev-supervisor a moment to start up
sleep 2

# Execute test script as external client via docker exec
if docker exec "$CONTAINER_NAME" /test/docker-integration-tests.sh; then
    TEST_EXIT=0
    echo ""
    echo "✅ All Docker integration tests passed"
else
    TEST_EXIT=$?
    echo ""
    echo "❌ Docker integration tests failed with exit code $TEST_EXIT"
    case $TEST_EXIT in
        1) echo "   Test 1 failed: PID 1 verification" ;;
        2) echo "   Test 2 failed: API health check" ;;
        3) echo "   Test 3 failed: Process lifecycle" ;;
        4) echo "   Test 4 failed: Orphan reaping" ;;
        5) echo "   Test 5 failed: Signal handling" ;;
        6) echo "   Test 6 failed: Sandbox blocks disallowed paths" ;;
        7) echo "   Test 7 failed: Sandbox allows allowed paths" ;;
        99) echo "   Test setup failed (Docker, socket, etc.)" ;;
    esac
fi

# Cleanup: stop and remove container
echo "Cleaning up container..."
docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

exit $TEST_EXIT
