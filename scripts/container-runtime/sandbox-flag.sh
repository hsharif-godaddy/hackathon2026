#!/usr/bin/env bash
# Toggle the dev-supervisor sandbox flag by editing .envrc.local.
#
# Usage:
#   ./scripts/container-runtime/sandbox-flag.sh on      # add DEV_SUPERVISOR_SANDBOX_ENABLED=true
#   ./scripts/container-runtime/sandbox-flag.sh off     # remove it
#   ./scripts/container-runtime/sandbox-flag.sh status  # print current value
#
# This is independent of the container runtime (Docker Desktop, airo-sandbox
# Lima VM, etc.). Flip both toggles for full prod-parity sandbox testing.

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VAR="DEV_SUPERVISOR_SANDBOX_ENABLED"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVRC_LOCAL="${REPO_ROOT}/.envrc.local"

info() { printf "${BLUE}==>${NC} %s\n" "$1"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }

ensure_file() {
  if [[ ! -f "${ENVRC_LOCAL}" ]]; then
    cat > "${ENVRC_LOCAL}" <<'EOF'
# Untracked local overrides, loaded by .envrc. Safe to edit by hand.
EOF
  fi
}

# Portable in-place sed: GNU sed accepts `-i` with no argument; BSD/macOS sed
# requires an explicit backup suffix (empty string for no backup). Prefer gsed
# if installed (Homebrew `gnu-sed`), otherwise branch on OS.
sed_inplace() {
  if command -v gsed >/dev/null 2>&1; then
    gsed -i -E "$@"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' -E "$@"
  else
    sed -i -E "$@"
  fi
}

cmd_on() {
  ensure_file
  if grep -qE "^export ${VAR}=" "${ENVRC_LOCAL}"; then
    # Replace existing line (may have been =false)
    sed_inplace "s|^export ${VAR}=.*|export ${VAR}=true|" "${ENVRC_LOCAL}"
  else
    echo "export ${VAR}=true" >> "${ENVRC_LOCAL}"
  fi
  ok "${VAR}=true written to .envrc.local"
  maybe_reload_direnv
}

cmd_off() {
  if [[ ! -f "${ENVRC_LOCAL}" ]] || ! grep -qE "^export ${VAR}=" "${ENVRC_LOCAL}"; then
    ok "${VAR} already absent"
    return
  fi
  sed_inplace "/^export ${VAR}=/d" "${ENVRC_LOCAL}"
  ok "${VAR} removed from .envrc.local"
  maybe_reload_direnv
}

cmd_status() {
  local file_val="<unset>"
  if [[ -f "${ENVRC_LOCAL}" ]] && grep -qE "^export ${VAR}=" "${ENVRC_LOCAL}"; then
    file_val=$(grep -E "^export ${VAR}=" "${ENVRC_LOCAL}" | tail -1 | cut -d= -f2-)
  fi
  local shell_val="${!VAR:-<unset>}"
  info ".envrc.local: ${VAR}=${file_val}"
  info "current shell: ${VAR}=${shell_val}"
  if [[ "${file_val}" != "${shell_val}" && "${file_val}" != "<unset>" ]]; then
    warn "Values differ — run 'direnv reload' or open a new shell in this repo"
  fi
}

maybe_reload_direnv() {
  if command -v direnv >/dev/null 2>&1; then
    info "Run 'direnv reload' in your shell to pick up the change (or cd out and back in)"
  else
    warn "direnv not found — source .envrc.local manually or export ${VAR} in your shell"
  fi
}

case "${1:-}" in
  on)     cmd_on ;;
  off)    cmd_off ;;
  status) cmd_status ;;
  *)
    cat <<EOF >&2
Usage: $0 {on|off|status}

  on      Add 'export ${VAR}=true' to .envrc.local
  off     Remove the line from .envrc.local
  status  Print the current file and shell values
EOF
    exit 2
    ;;
esac
