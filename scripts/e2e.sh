#!/usr/bin/env bash
# Thin wrapper around `playwright test` that adds an
#   --env=<local|dev|pre-test|test|prod>
# (or `--env <value>`) flag. Translates the flag to PLAYWRIGHT_ENV — which
# playwright.config.ts and tests/helpers/constants.ts already consume to
# resolve baseURL and credentials — then forwards every remaining argument
# to `playwright test` unchanged.
#
# Usage:
#   ./scripts/e2e.sh --env=local --project=e2e --headed
#   ./scripts/e2e.sh --env prod --project=regression authentication.spec.ts
#   pnpm test:e2e --env=local --project=e2e --headed   # via package.json script

set -eo pipefail

# Allowlist must mirror tests/helpers/constants.ts `environments` keys.
# Without validation a typo (e.g. --env=prd) silently sets PLAYWRIGHT_ENV=prd,
# constants.ts used to fall back to `test`, and the run targets the wrong
# baseURL with no warning. Reject unknown values up front instead.
VALID_ENVS=("local" "dev" "pre-test" "test" "prod")

validate_env() {
  local value="$1"
  for valid in "${VALID_ENVS[@]}"; do
    if [[ "$value" == "$valid" ]]; then
      return 0
    fi
  done
  echo "error: unknown --env value '$value' (expected: ${VALID_ENVS[*]})" >&2
  exit 1
}

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env=*)
      validate_env "${1#*=}"
      export PLAYWRIGHT_ENV="${1#*=}"
      shift
      ;;
    --env)
      if [[ $# -lt 2 ]]; then
        echo "error: --env requires a value (${VALID_ENVS[*]})" >&2
        exit 1
      fi
      validate_env "$2"
      export PLAYWRIGHT_ENV="$2"
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

exec npx playwright test "${ARGS[@]}"
