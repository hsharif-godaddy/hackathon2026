#!/usr/bin/env bash
# Manage the airo-sandbox Lima VM and its docker context.
#
# Usage:
#   ./scripts/container-runtime/lima/manage.sh setup       # install lima (macOS), start VM, create context, health-check
#   ./scripts/container-runtime/lima/manage.sh teardown    # stop + delete VM, remove context
#   ./scripts/container-runtime/lima/manage.sh status      # print VM + context state
#
# Idempotent: every subcommand is safe to re-run.

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTANCE="airo-sandbox"
CONTEXT="airo-sandbox"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${SCRIPT_DIR}/airo-sandbox.yaml"
SOCKET="${HOME}/.lima/${INSTANCE}/sock/docker.sock"

info()  { printf "${BLUE}==>${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
fail()  { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "This runtime is macOS-only. On Linux, use native Docker (already prod-parity). WSL support is a future addition."
  fi
}

ensure_lima_installed() {
  if command -v limactl >/dev/null 2>&1; then
    ok "limactl already installed ($(limactl --version 2>&1 | head -1))"
    return
  fi
  info "limactl not found — installing via Homebrew"
  if ! command -v brew >/dev/null 2>&1; then
    fail "Homebrew is not installed. Install from https://brew.sh and re-run, or install Lima manually."
  fi
  brew install lima
  ok "limactl installed"
}

ensure_docker_cli() {
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker CLI not found. Install Docker Desktop, Colima, or \`brew install docker\` (the CLI alone is enough)."
  fi
}

limactl_available() { command -v limactl >/dev/null 2>&1; }
vm_exists()  { limactl_available && limactl list --format '{{.Name}}' 2>/dev/null | grep -qx "${INSTANCE}"; }
vm_running() { limactl_available && [[ "$(limactl list --format '{{if eq .Name "'${INSTANCE}'"}}{{.Status}}{{end}}' 2>/dev/null)" == "Running" ]]; }

ensure_vm_started() {
  if vm_exists; then
    if vm_running; then
      ok "VM ${INSTANCE} already running"
    else
      info "Starting existing VM ${INSTANCE}"
      limactl start --tty=false "${INSTANCE}"
      ok "VM ${INSTANCE} started"
    fi
  else
    info "Creating and starting VM ${INSTANCE} (first run downloads the AlmaLinux 9 cloud image, ~1–2 min)"
    limactl start --tty=false --name="${INSTANCE}" "${CONFIG}"
    # Lima's hostagent opened its SSH session for docker-socket forwarding
    # before provisioning ran `usermod -aG docker`. The lima user's existing
    # session doesn't see the new group, so the forwarded socket is
    # inaccessible. Stop/start cycles the hostagent so the next session
    # authenticates with the updated group set.
    info "Restarting VM to refresh hostagent credentials (post-provision docker group pickup)"
    limactl stop "${INSTANCE}"
    limactl start --tty=false "${INSTANCE}"
    ok "VM ${INSTANCE} created and started"
  fi
}

ensure_docker_host_gateway() {
  # Docker's `host-gateway` magic token defaults to docker0 (172.17.0.1), which
  # is only reachable from containers on the default bridge. Preview/publish
  # containers run on a user-defined network, so `extra_hosts: host-gateway`
  # silently points them at an unreachable IP. Pin it to host.lima.internal
  # (the macOS host as seen from the VM) so the token resolves correctly on
  # every Docker network.
  local host_ip current_ip
  # Let limactl errors surface so VM connectivity problems abort with a visible
  # message. Swallow only getent's NXDOMAIN exit (2) so the empty-check below
  # runs — without this, `set -eo pipefail` aborts before the warn path.
  host_ip=$(limactl shell "${INSTANCE}" -- bash -c 'getent hosts host.lima.internal || true' | awk '{print $1}' | head -1)
  if [[ -z "${host_ip}" ]]; then
    warn "could not resolve host.lima.internal inside ${INSTANCE}; skipping host-gateway pin"
    return
  fi
  # jq is in the provision script for fresh VMs; install on demand for older ones.
  limactl shell "${INSTANCE}" -- bash -c 'command -v jq >/dev/null || sudo dnf install -y jq >/dev/null'
  # `|| true` is inside bash -c so it only swallows jq failures (missing file);
  # a limactl failure still aborts via set -e with its own error.
  current_ip=$(limactl shell "${INSTANCE}" -- bash -c 'jq -r ".\"host-gateway-ip\" // \"\"" /etc/docker/daemon.json 2>/dev/null || true')
  if [[ "${current_ip}" == "${host_ip}" ]]; then
    ok "docker host-gateway pinned to ${host_ip}"
    return
  fi
  info "Pinning docker host-gateway to ${host_ip} (host.lima.internal)"
  # Merge into existing daemon.json, preserving other keys. Warns and falls
  # back to `{}` if the file is invalid JSON so the data loss is visible.
  limactl shell "${INSTANCE}" -- sudo env HOST_GATEWAY_IP="${host_ip}" bash -c '
    set -euo pipefail
    mkdir -p /etc/docker
    existing="{}"
    if [[ -s /etc/docker/daemon.json ]]; then
      if jq -e . /etc/docker/daemon.json >/dev/null 2>&1; then
        existing=$(cat /etc/docker/daemon.json)
      else
        echo "WARN: /etc/docker/daemon.json is not valid JSON; replacing with {}" >&2
      fi
    fi
    printf "%s" "$existing" | jq --arg ip "$HOST_GATEWAY_IP" ". + {\"host-gateway-ip\": \$ip}" > /etc/docker/daemon.json.tmp
    mv /etc/docker/daemon.json.tmp /etc/docker/daemon.json
  '
  limactl shell "${INSTANCE}" -- sudo systemctl restart docker
  ok "docker restarted with host-gateway-ip=${host_ip}"
}

ensure_context() {
  if docker context inspect "${CONTEXT}" >/dev/null 2>&1; then
    ok "docker context ${CONTEXT} already exists"
    return
  fi
  info "Creating docker context ${CONTEXT}"
  docker context create "${CONTEXT}" --docker "host=unix://${SOCKET}" >/dev/null
  ok "docker context ${CONTEXT} created"
}

health_check() {
  info "Health check"
  local kernel os line last_err attempts=20
  for ((i=1; i<=attempts; i++)); do
    last_err=$(docker --context "${CONTEXT}" info --format '{{.KernelVersion}}|{{.OperatingSystem}}' 2>&1 1>/tmp/airo-sandbox-docker-info.$$ || true)
    line=$(cat /tmp/airo-sandbox-docker-info.$$ 2>/dev/null || true)
    rm -f /tmp/airo-sandbox-docker-info.$$
    if [[ -n "${line}" ]]; then
      kernel="${line%%|*}"
      os="${line#*|}"
      ok "kernel:  ${kernel}"
      ok "os:      ${os}"
      return
    fi
    sleep 1
  done
  local hint="inspect with 'limactl shell ${INSTANCE} -- sudo journalctl -u docker'"
  if [[ -n "${last_err}" ]]; then
    fail "docker --context ${CONTEXT} info failed after ${attempts}s: ${last_err%%$'\n'*} — ${hint}"
  else
    fail "docker --context ${CONTEXT} info failed after ${attempts}s — ${hint}"
  fi
}

cmd_setup() {
  require_macos
  ensure_docker_cli
  ensure_lima_installed
  ensure_vm_started
  ensure_docker_host_gateway
  ensure_context
  health_check
  cat <<EOF

${GREEN}Setup complete.${NC}

Activate this runtime:
    docker context use ${CONTEXT}

Revert to your default runtime:
    docker context use default

Enable the dev-supervisor sandbox flag (independent toggle):
    pnpm run sandbox:on

Tear down entirely:
    pnpm run runtime:sandbox:teardown
EOF
}

cmd_teardown() {
  require_macos
  if docker context inspect "${CONTEXT}" >/dev/null 2>&1; then
    # Always switch to default before deleting. `docker context show` can fail
    # (e.g. DOCKER_CONTEXT points at garbage) and returning "" would skip the
    # switch, leaving the CLI pointed at a deleted context. `context use
    # default` is a no-op if already there.
    info "Switching active docker context back to default"
    docker context use default >/dev/null 2>&1 || true
    info "Removing docker context ${CONTEXT}"
    docker context rm "${CONTEXT}" >/dev/null
    ok "context removed"
  else
    ok "docker context ${CONTEXT} already absent"
  fi
  if vm_exists; then
    if vm_running; then
      info "Stopping VM ${INSTANCE}"
      limactl stop "${INSTANCE}"
    fi
    info "Deleting VM ${INSTANCE}"
    limactl delete "${INSTANCE}"
    ok "VM deleted"
  else
    ok "VM ${INSTANCE} already absent"
  fi
}

cmd_status() {
  if vm_exists; then
    if vm_running; then
      ok "VM ${INSTANCE}: Running"
    else
      warn "VM ${INSTANCE}: Stopped"
    fi
  else
    warn "VM ${INSTANCE}: not installed"
  fi
  if docker context inspect "${CONTEXT}" >/dev/null 2>&1; then
    ok "docker context ${CONTEXT}: present"
  else
    warn "docker context ${CONTEXT}: not present"
  fi
  local active
  active=$(docker context show 2>/dev/null || echo "<unknown>")
  info "active docker context: ${active}"
  if [[ "${active}" == "${CONTEXT}" ]] && vm_running; then
    health_check
  fi
}

case "${1:-}" in
  setup)    cmd_setup ;;
  teardown) cmd_teardown ;;
  status)   cmd_status ;;
  *)
    cat <<EOF >&2
Usage: $0 {setup|teardown|status}

  setup     Install Lima (if missing), start the ${INSTANCE} VM, create the ${CONTEXT} docker context, and health-check.
  teardown  Remove the docker context, stop and delete the VM.
  status    Report VM and context state.
EOF
    exit 2
    ;;
esac
