#!/usr/bin/env bash
#
# Test wrapper script that validates arguments and prevents common mistakes.
#
# When running "pnpm test -- some-filter", the filter is passed to ALL packages
# in the monorepo, running every test suite. This causes memory exhaustion.
#
# Correct usage:
#   pnpm --filter @airo/agents test:unit -- "pattern"
#   pnpm --filter website test -- "pattern"
#
set -e

# Check if any arguments were passed (indicating -- was used)
if [ $# -gt 0 ]; then
  echo ""
  echo "ERROR: Test filters cannot be used with root 'pnpm test' command."
  echo ""
  echo "The root test command runs tests across ALL packages. Using '--' here"
  echo "passes the filter to every package, running all test suites and causing"
  echo "memory exhaustion (OOM)."
  echo ""
  echo "CORRECT USAGE - filter to a specific package first:"
  echo ""
  echo "  # Run filtered tests in agents package"
  echo "  pnpm --filter @airo/agents test:unit \"pattern\""
  echo "  pnpm --filter @airo/agents test:unit -t \"test name\""
  echo ""
  echo "  # Run filtered tests in app package"
  echo "  pnpm --filter website test \"pattern\""
  echo "  pnpm --filter website test -t \"test name\""
  echo ""
  echo "  # Run ALL tests (no filter)"
  echo "  pnpm test"
  echo ""
  echo "See CLAUDE.md 'Test Filtering (Vitest)' for syntax reference."
  echo ""
  exit 1
fi

# Run tests across all packages
exec turbo run test
