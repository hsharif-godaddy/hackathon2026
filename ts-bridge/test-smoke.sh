#!/usr/bin/env bash
# Smoke test for the ts-bridge server.
# Starts the bridge, calls GET /health and GET /tools, then shuts down.
#
# Prerequisites:
#   pnpm install (from repo root)
#   pnpm --filter @airo/agents run build:deps
#
# Usage:
#   cd ts-bridge && bash test-smoke.sh

set -euo pipefail

SOCK="/tmp/ts-bridge-smoke-$$.sock"
cleanup() { kill "$PID" 2>/dev/null || true; rm -f "$SOCK"; }
trap cleanup EXIT

echo "Starting ts-bridge on $SOCK..."
TS_BRIDGE_SOCKET_PATH="$SOCK" npx tsx src/server.ts &
PID=$!

# Wait for socket to appear (up to 30s).
for i in $(seq 1 60); do
  [ -S "$SOCK" ] && break
  sleep 0.5
done
[ -S "$SOCK" ] || { echo "FAIL: socket never appeared"; exit 1; }

echo "Testing GET /health..."
HEALTH=$(curl -sf --unix-socket "$SOCK" http://localhost/health)
echo "  Response: $HEALTH"
echo "$HEALTH" | grep -q '"ok"' || { echo "FAIL: health check"; exit 1; }

echo "Testing GET /tools..."
TOOLS=$(curl -sf --unix-socket "$SOCK" http://localhost/tools)
TOOL_COUNT=$(echo "$TOOLS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
echo "  Tool count: $TOOL_COUNT"
[ "$TOOL_COUNT" -gt 0 ] 2>/dev/null || { echo "FAIL: no tools discovered"; exit 1; }

# Verify native Go tools are excluded.
for native in readFile directoryListing grepSearch terminalCommand str_replace_based_edit_tool fileEdit; do
  if echo "$TOOLS" | grep -q "\"name\":\"$native\""; then
    echo "FAIL: native Go tool '$native' should not be in bridge"
    exit 1
  fi
done
echo "  Native Go tools correctly excluded"

# Verify a known tool is present.
echo "$TOOLS" | grep -q '"todoList"' || { echo "FAIL: todoList not found"; exit 1; }
echo "  todoList tool present"

echo ""
echo "PASS: all smoke tests passed ($TOOL_COUNT tools available)"
