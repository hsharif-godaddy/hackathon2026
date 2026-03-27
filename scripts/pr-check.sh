#!/bin/bash
#
# Local PR Check Script
# Runs the same checks as the GitHub Actions PR workflow
#
# Usage:
#   ./scripts/pr-check.sh          # Run all checks
#   ./scripts/pr-check.sh --quick  # Skip build (faster)
#   ./scripts/pr-check.sh --help   # Show help
#

set -uo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track timing
SECONDS=0

# Parse arguments
QUICK_MODE=false
SKIP_AGENTS_TESTS=true  # Matches CI behavior
RUN_DEV_SUPERVISOR=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --with-agent-tests)
            SKIP_AGENTS_TESTS=false
            shift
            ;;
        --with-dev-supervisor)
            RUN_DEV_SUPERVISOR=true
            shift
            ;;
        --help|-h)
            echo "Usage: ./scripts/pr-check.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --quick              Skip build step (faster iteration)"
            echo "  --with-agent-tests   Include agent tests (skipped by default, like CI)"
            echo "  --with-dev-supervisor  Run dev-supervisor Go checks"
            echo "  --help, -h           Show this help message"
            echo ""
            echo "This script runs the same checks as the GitHub Actions PR workflow:"
            echo "  1. Lint (agents + app)"
            echo "  2. Typecheck (agents + app)"
            echo "  3. Tests (app only by default)"
            echo "  4. Build (agents + app, skipped with --quick)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Ensure we're in the repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Local PR Check${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Track failures
FAILED_CHECKS=()

run_check() {
    local name="$1"
    local cmd="$2"

    echo -e "${YELLOW}▶ $name${NC}"
    if bash -c "$cmd"; then
        echo -e "${GREEN}✓ $name passed${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}✗ $name failed${NC}"
        echo ""
        FAILED_CHECKS+=("$name")
        return 1
    fi
}

# 1. Lint
echo -e "${BLUE}[1/4] Running Lint...${NC}"
echo ""

run_check "Lint: agents" "pnpm --filter @airo/agents lint" || true
run_check "Lint: app" "pnpm --filter website lint" || true

# 2. Typecheck
echo -e "${BLUE}[2/4] Running Typecheck...${NC}"
echo ""

run_check "Typecheck: agents" "pnpm --filter @airo/agents typecheck" || true
run_check "Typecheck: app" "pnpm --filter website typecheck" || true

# 3. Tests
echo -e "${BLUE}[3/4] Running Tests...${NC}"
echo ""

if [ "$SKIP_AGENTS_TESTS" = true ]; then
    echo -e "${YELLOW}⏭ Skipping agent tests (matches CI behavior, use --with-agent-tests to include)${NC}"
    echo ""
else
    run_check "Test: agents" "pnpm --filter @airo/agents test" || true
fi

run_check "Test: app" "pnpm --filter website test" || true

# 4. Build
if [ "$QUICK_MODE" = true ]; then
    echo -e "${BLUE}[4/4] Build${NC}"
    echo -e "${YELLOW}⏭ Skipping build (--quick mode)${NC}"
    echo ""
else
    echo -e "${BLUE}[4/4] Running Build...${NC}"
    echo ""

    run_check "Build: agents" "pnpm --filter @airo/agents build" || true
    run_check "Build: app" "pnpm --filter website build" || true
fi

# 5. Dev-supervisor (optional)
if [ "$RUN_DEV_SUPERVISOR" = true ]; then
    echo -e "${BLUE}[Extra] Running dev-supervisor checks...${NC}"
    echo ""

    if command -v go &> /dev/null; then
        run_check "dev-supervisor: vet" "cd dev-supervisor && go vet ./..." || true
        run_check "dev-supervisor: fmt" "cd dev-supervisor && files=\$(gofmt -s -l .); if [ -n \"\$files\" ]; then echo \"Files need formatting:\"; echo \"\$files\"; exit 1; fi" || true
        run_check "dev-supervisor: test" "cd dev-supervisor && go test -v ./..." || true

        if command -v golangci-lint &> /dev/null; then
            run_check "dev-supervisor: lint" "cd dev-supervisor && golangci-lint run --timeout=5m ./..." || true
        else
            echo -e "${YELLOW}⏭ Skipping golangci-lint (not installed)${NC}"
        fi
    else
        echo -e "${YELLOW}⏭ Skipping dev-supervisor checks (Go not installed)${NC}"
    fi
    echo ""
fi

# Summary
ELAPSED=$SECONDS
MINUTES=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "Time: ${MINUTES}m ${SECS}s"
echo ""

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Your PR should pass CI quality checks."
    exit 0
else
    echo -e "${RED}✗ ${#FAILED_CHECKS[@]} check(s) failed:${NC}"
    for check in "${FAILED_CHECKS[@]}"; do
        echo -e "  ${RED}• $check${NC}"
    done
    echo ""
    echo "Fix these issues before pushing."
    exit 1
fi
