#!/usr/bin/env bash
# Thin wrapper around `playwright test` that adds two non-Playwright flags:
#   --env=<local|dev|pre-test|test|prod>  → PLAYWRIGHT_ENV (baseURL + creds)
#   --no-delete / --delete                 → E2E_NO_DELETE (cleanup skip)
#
# Both env vars are read by `tests/helpers/constants.ts` and the spec
# beforeEach/afterEach hooks. Every other argument is forwarded to
# `playwright test` unchanged.
#
# `--no-delete` skips both per-spec cleanup (afterEach `deleteAppsWithPrefix`)
# and the eviction guard (beforeEach `evictOldestE2eAppsToFitLimit`), so
# apps created by the run survive for inspection. Defaulted ON for
# `--env=local` and `--env=dev` so devs iterating locally don't lose their
# work; CI envs (`pre-test`, `test`, `prod`) still clean up unless the flag
# is explicitly passed. Pass `--delete` to force cleanup on a local run.
#
# Usage:
#   ./scripts/e2e.sh --env=local --project=e2e --headed     # implicit --no-delete
#   ./scripts/e2e.sh --env=prod  --project=e2e --no-delete  # debug a prod-only failure without losing the app
#   ./scripts/e2e.sh --env=local --delete --project=e2e     # force cleanup locally
#   pnpm test:e2e --env=local --project=e2e --headed        # via package.json script

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
NO_DELETE_EXPLICIT=""

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
    --no-delete)
      export E2E_NO_DELETE=true
      NO_DELETE_EXPLICIT=true
      shift
      ;;
    --delete)
      export E2E_NO_DELETE=false
      NO_DELETE_EXPLICIT=true
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

# Default --no-delete ON for local/dev envs so devs iterating against their
# own backend don't have their apps deleted between runs. Only applies when
# neither --no-delete nor --delete was passed explicitly.
if [[ -z "$NO_DELETE_EXPLICIT" ]]; then
  case "${PLAYWRIGHT_ENV:-}" in
    local|dev)
      export E2E_NO_DELETE=true
      echo "ℹ️  Defaulting --no-delete=true for env '${PLAYWRIGHT_ENV}'. Pass --delete to force cleanup." >&2
      ;;
  esac
fi

exec npx playwright test "${ARGS[@]}"
