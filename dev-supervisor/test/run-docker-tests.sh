#!/bin/bash
set -e

# Build the real production image (dev-supervisor/Dockerfile) so these tests
# validate the actual shipped build path end-to-end — not a separate test-only
# Dockerfile that can drift from it.
echo "Building Docker image for integration tests..."
docker build -f Dockerfile -t dev-supervisor:test .

echo ""
echo "Running integration tests in Docker..."

# Start container with airo-workspace as PID 1 wrapping dev-supervisor
CONTAINER_NAME="dev-supervisor-test-$$"

# Start container in detached mode with no command arguments. This makes
# airo-workspace PID 1 supervising dev-supervisor with no managed child.
# AIRO_WORKSPACE_PROXY=1 exercises the airo-workspace -> dev-supervisor proxy
# topology (airo-workspace owns the public socket); the test script is mounted
# read-only rather than baked into the image.
if ! docker run -d --name "$CONTAINER_NAME" \
    --init=false \
    -e AIRO_WORKSPACE_PROXY=1 \
    -e DEV_SUPERVISOR_SANDBOX_ENABLED=true \
    -v "$(pwd)/test/docker-integration-tests.sh:/test/docker-integration-tests.sh:ro" \
    dev-supervisor:test; then
    echo "❌ Failed to start container"
    exit 99
fi

# Give dev-supervisor a moment to start up
sleep 2

# The production image ships only ca-certificates/tzdata. The test harness
# needs bash (script shebang), curl (--unix-socket API calls) and procps
# (ps -p/-o comm=, which busybox lacks). Install them into the throwaway test
# container at runtime so the shipped image stays minimal.
docker exec "$CONTAINER_NAME" apk add --no-cache bash curl procps

# Execute test script as external client via docker exec
if docker exec "$CONTAINER_NAME" bash /test/docker-integration-tests.sh; then
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
