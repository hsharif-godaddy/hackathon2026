#!/usr/bin/env sh
set -eu

# Health check for dev-supervisor that supports both transport modes:
# - macOS local dev: TCP (DEV_SUPERVISOR_USE_TCP=true)
# - Linux local dev: Unix domain socket (DEV_SUPERVISOR_SOCKET_PATH)

if [ "${DEV_SUPERVISOR_USE_TCP:-}" = "true" ]; then
  port="${DEV_SUPERVISOR_TCP_PORT:-8877}"
  exec curl -fsS "http://localhost:${port}/health"
fi

socket_path="${DEV_SUPERVISOR_SOCKET_PATH:-/tmp/supervisor/dev-supervisor.sock}"
exec curl --unix-socket "${socket_path}" -fsS "http://localhost/health"
