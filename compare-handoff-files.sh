#!/bin/bash

# Compare handoff-related files between two repositories
# This repo: /home/jeichorn/s/airo-app-builder (testing-consolidated branch)
# Working repo: /home/jeichorn/s/airo-ai-builder (with working handoffs)

WORKING_REPO="/home/jeichorn/s/airo-ai-builder"
CURRENT_REPO="/home/jeichorn/s/airo-app-builder"

echo "========================================="
echo "Comparing handoff files between:"
echo "  Current: $CURRENT_REPO (testing-consolidated)"
echo "  Working: $WORKING_REPO"
echo "========================================="
echo ""

# Function to compare a file
compare_file() {
    local rel_path="$1"
    local current_file="$CURRENT_REPO/$rel_path"
    local working_file="$WORKING_REPO/$rel_path"
    
    if [ ! -f "$current_file" ]; then
        echo "❌ MISSING in current: $rel_path"
        return
    fi
    
    if [ ! -f "$working_file" ]; then
        echo "⚠️  MISSING in working: $rel_path"
        return
    fi
    
    if ! diff -q "$current_file" "$working_file" > /dev/null 2>&1; then
        echo "🔄 DIFFERS: $rel_path"
        echo "   To see diff: diff $current_file $working_file"
    else
        echo "✅ SAME: $rel_path"
    fi
}

echo "=== AI-LIB Handoff Files ==="
echo ""

compare_file "packages/ai-lib/src/tools/handoff-helpers.ts"
compare_file "packages/ai-lib/src/tools/handoff-state-manager.ts"
compare_file "packages/ai-lib/src/tools/delegate-tool.ts"
compare_file "packages/ai-lib/src/websocket/experimental-websocket-server.ts"

echo ""
echo "=== Agents Handoff Files ==="
echo ""

compare_file "agents/src/agents/ai-lib-agents/index.ts"
compare_file "agents/src/agents/develop-agent.ts"
compare_file "agents/src/agents/color-scheme-agent.ts"
compare_file "agents/src/server/ai-lib-websocket-server.ts"

echo ""
echo "=== Agent Tools Files ==="
echo ""

compare_file "agents/src/tools/ai-lib-tools/index.ts"
compare_file "agents/src/tools/ai-lib-tools/file-edit.ts"
compare_file "agents/src/tools/ai-lib-tools/css-color.ts"

echo ""
echo "=== Summary ==="
echo ""
echo "To view detailed differences for a file:"
echo "  diff -u $CURRENT_REPO/<path> $WORKING_REPO/<path> | less"
echo ""
echo "To copy a file from working to current:"
echo "  cp $WORKING_REPO/<path> $CURRENT_REPO/<path>"
