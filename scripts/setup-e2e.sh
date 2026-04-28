#!/usr/bin/env bash
# One-shot setup for running Playwright E2E tests locally.
#
# Idempotent: safe to re-run. Validates tooling, installs workspace deps,
# downloads Playwright browser binaries, and creates tests/.env interactively
# if missing or incomplete.
#
# Usage:
#   ./scripts/setup-e2e.sh
#
# After it completes:
#   pnpm test:e2e --env=test --project=e2e   # critical-path test (~10 min)

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

step() { echo ""; echo -e "${BLUE}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}! $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}  Playwright E2E Setup${NC}"
echo -e "${BLUE}=================================================${NC}"

# 1. Tooling
step "[1/5] Checking tooling"
command -v node >/dev/null 2>&1 || fail "node not found (install Node.js 18+)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  fail "node $(node -v) is too old (Node.js 18+ required)"
fi
ok "node $(node -v)"

command -v corepack >/dev/null 2>&1 || fail "corepack not found (ships with Node.js 16.10+)"
# Corepack-managed pnpm respects the pinned version in package.json's
# packageManager field; without it pnpm may resolve to an arbitrary global
# version and produce a different lockfile.
if COREPACK_OUTPUT="$(corepack enable 2>&1)"; then
  ok "corepack enabled"
else
  warn "corepack enable failed; pnpm version may not match package.json"
  if [[ -n "$COREPACK_OUTPUT" ]]; then
    printf '%s\n' "$COREPACK_OUTPUT" | sed 's/^/    /'
  fi
fi

command -v pnpm >/dev/null 2>&1 || fail "pnpm not available after corepack enable"
ok "pnpm $(pnpm --version)"

# 2. Workspace deps
step "[2/5] Installing workspace dependencies (pnpm install)"
pnpm install
ok "dependencies installed"

# 3. Playwright browsers
step "[3/5] Installing Playwright browsers"
# Skip --with-deps so this stays sudo-free on Linux. The Linux-only system
# library install is mentioned in the next-steps banner if it's needed.
pnpm exec playwright install
ok "browsers installed"

# 4. tests/.env credentials
step "[4/5] Configuring tests/.env"
ENV_FILE="$REPO_ROOT/tests/.env"

# A valid file has a non-empty USERNAME/PASSWORD pair for at least one of
# the env prefixes recognised by tests/helpers/constants.ts. Any of them is
# enough — the test harness picks the right one based on --env.
has_credential_pair() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local prefix
  for prefix in E2E TEST DEV PROD LOCAL PRE_TEST; do
    # `=[^[:space:]]` rejects whitespace-only values that would silently
    # pass `=.+` here and then fail at test time inside getCredentials().
    if grep -qE "^${prefix}_USERNAME=[^[:space:]]" "$file" \
       && grep -qE "^${prefix}_PASSWORD=[^[:space:]]" "$file"; then
      return 0
    fi
  done
  return 1
}

prompt_for_credentials() {
  if [[ ! -t 0 ]]; then
    fail "non-interactive shell; populate tests/.env manually (see tests/README.md)"
  fi

  echo ""
  echo "  Enter shared test SSO credentials. Stored unencrypted at"
  echo "  tests/.env (gitignored, mode 0600). Use a shared test account,"
  echo "  not your personal one."
  echo ""
  local username password
  # Without explicit EOF handling, Ctrl-D returns non-zero from `read` and
  # `set -e` aborts with no message, leaving the shell prompt mid-line.
  read -rp  "  E2E_USERNAME (e.g. someone@example.com): " username || { echo ""; fail "input cancelled"; }
  read -rsp "  E2E_PASSWORD (input hidden): " password           || { echo ""; fail "input cancelled"; }
  echo ""
  [[ -n "$username" && -n "$password" ]] || fail "username and password are required"

  # dotenv treats unquoted `#` as a comment and `$VAR` / backticks as
  # interpolation, silently corrupting passwords like `hunter2#secret`.
  # Single-quote everything; refuse values that contain a literal `'`
  # since dotenv format has no in-band escape — the user can edit the
  # file by hand for that rare case.
  if [[ "$username" == *"'"* || "$password" == *"'"* ]]; then
    fail "values containing single quotes aren't supported here; add E2E_USERNAME/E2E_PASSWORD to tests/.env manually (see tests/README.md)"
  fi

  # Backup an existing file so a re-run can recover. mktemp avoids
  # same-second collisions where `date +%s` would silently overwrite a
  # previous backup.
  if [[ -f "$ENV_FILE" && -s "$ENV_FILE" ]]; then
    local backup
    backup="$(mktemp "$ENV_FILE.bak.XXXXXX")"
    cp "$ENV_FILE" "$backup"
  fi

  # Tighten perms *before* writing secrets so there's no window where the
  # default-umask 0644 file is readable between `>>` and a later chmod.
  # `umask 077` only affects new files; the explicit chmod handles the
  # case where the file already exists with looser perms.
  ( umask 077 && touch "$ENV_FILE" )
  chmod 600 "$ENV_FILE"

  # An existing file without a trailing newline (common from some editors)
  # would cause the first appended line to concatenate onto the last
  # existing one, silently merging keys. tail -c1 returns the last byte;
  # command substitution strips a trailing newline so empty == newline.
  if [[ -s "$ENV_FILE" && -n "$(tail -c1 "$ENV_FILE")" ]]; then
    echo "" >> "$ENV_FILE"
  fi

  {
    echo "E2E_USERNAME='$username'"
    echo "E2E_PASSWORD='$password'"
  } >> "$ENV_FILE"
  ok "tests/.env credentials written (mode 0600)"
}

if has_credential_pair "$ENV_FILE"; then
  # Tighten perms even when we don't write — an older tests/.env may
  # have been created with the user's default umask (typically 0644)
  # and would otherwise stay world-readable indefinitely.
  chmod 600 "$ENV_FILE"
  ok "tests/.env already has credentials (mode 0600)"
else
  if [[ -f "$ENV_FILE" ]]; then
    warn "tests/.env exists but has no complete USERNAME/PASSWORD pair"
  else
    warn "tests/.env not found"
  fi
  prompt_for_credentials
fi

# 5. Verify Playwright resolves the config
step "[5/5] Verifying Playwright config"
# `--list` enumerates specs without running them; surfaces tsconfig / import /
# Playwright config errors in seconds rather than partway through a real run.
if pnpm exec playwright test --list --project=e2e >/dev/null 2>&1; then
  ok "Playwright resolves the e2e project"
else
  warn "playwright test --list failed; output below:"
  # `|| true` so we control the exit path explicitly; without it `set -e`
  # would abort here and skip the explicit fail() banner below, leaving
  # the user with raw Playwright output and no clear status signal.
  pnpm exec playwright test --list --project=e2e || true
  fail "Playwright config verification failed. Fix the errors above, then re-run."
fi

echo ""
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  Setup complete${NC}"
echo -e "${GREEN}=================================================${NC}"
echo ""
echo "Run the critical-path test:"
echo -e "  ${BLUE}pnpm test:e2e --env=test --project=e2e${NC}            # CI target (default)"
echo -e "  ${BLUE}pnpm test:e2e --env=local --project=e2e --headed${NC}  # against local dev"
echo ""
echo "Other entry points:"
echo "  pnpm test:e2e --project=regression          # full regression suite"
echo "  pnpm exec playwright show-report            # last run's HTML report"
echo ""
echo "Linux only: if browsers fail to launch with missing system libs, run:"
echo "  pnpm exec playwright install-deps"
