#!/bin/bash
set -euo pipefail

# Source common functions
# shellcheck source=./common.sh
source /publish/common.sh

# PaaS publish runner.
#
# Contract:
# - Dispatched from run-app.sh BEFORE extraction. Inherits $ARCHIVE_PATH via
#   exported env so it can own cleanup + extraction (preserving the
#   "cleanAppDirBeforeExtract" pre-extract semantic).
# - Preview (long-running) has already run install + build and shipped
#   node_modules in the archive. We trust that state.
# - Customer owns package.json scripts.start. Preview derives
#   runtime.serve.command in .airo/config.json from it (with minor massaging);
#   we prefer that custom command and fall back to "$PACKAGE_MANAGER" start.
# - If node_modules is missing (recovery), install via the detected package
#   manager's frozen-lockfile path, then run runtime.build.command from
#   .airo/config.json if set, else "$PACKAGE_MANAGER" run build.
# - No database migrations here (preview runs them for PaaS).

DIST_DIR="${DIST_DIR:-/dist}"
if [[ -z "${ARCHIVE_PATH:-}" ]]; then
    error_exit "PaaS: ARCHIVE_PATH not set (expected export from run-app.sh)"
fi

# Pre-extract cleanup: if .airo/config.json from the previous deployment has
# cleanAppDirBeforeExtract=true, wipe $APP_DIR so files the customer deleted
# between publishes don't resurrect. Only paas-nodejs-v1 sets this today
# (see AppRestartService.createPaasConfig).
AIRO_CONFIG_PATH="${APP_DIR}/.airo/config.json"

CLEANUP_ENABLED=false
if [[ -f "$AIRO_CONFIG_PATH" ]]; then
    if jq -e '.' "$AIRO_CONFIG_PATH" >/dev/null 2>&1; then
        CLEANUP_ENABLED=$(jq -r '.cleanAppDirBeforeExtract // false' "$AIRO_CONFIG_PATH")
    else
        log_warn "PaaS: pre-extract .airo/config.json is not valid JSON; defaulting cleanAppDirBeforeExtract=false"
    fi
fi

if [[ "$CLEANUP_ENABLED" == "true" ]]; then
    log "Cleanup enabled - cleaning app directory before extraction"
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + \
        || log_warn "PaaS: cleanup incomplete; stale files may remain"
else
    log "Skipping cleanup (cleanAppDirBeforeExtract: ${CLEANUP_ENABLED})"
fi

process_archive

[[ -f package.json ]] || error_exit "PaaS: package.json missing"

# PaaS supports pnpm, yarn, and npm — mirrors preview's nomad_setup.sh priority.
detect_package_manager "pnpm yarn npm"

# Custom build/serve commands from .airo/config.json. Preview always writes
# these during import (AppRestartService.createPaasConfig); prefer them when
# present and fall back to "$PACKAGE_MANAGER run build" / "$PACKAGE_MANAGER
# start" when the file is absent (edge case).
CUSTOM_BUILD_CMD=""
CUSTOM_SERVE_CMD=""
if [[ -f "$AIRO_CONFIG_PATH" ]]; then
    if jq -e '.' "$AIRO_CONFIG_PATH" >/dev/null 2>&1; then
        CUSTOM_BUILD_CMD=$(jq -r '.runtime.build.command // empty' "$AIRO_CONFIG_PATH")
        CUSTOM_SERVE_CMD=$(jq -r '.runtime.serve.command // empty' "$AIRO_CONFIG_PATH")
    else
        log_warn "PaaS: post-extract .airo/config.json is not valid JSON; using package-manager defaults"
    fi
fi

# Recovery path: preview normally ships node_modules in the archive.
if [[ -d node_modules ]]; then
    log "PaaS: node_modules present - trusting preview, skipping install + build"
else
    log "PaaS: node_modules missing - running install (recovery)"
    case "$PACKAGE_MANAGER" in
        pnpm)
            pnpm install --frozen-lockfile || error_exit "PaaS: pnpm install failed"
            ;;
        yarn)
            yarn install --frozen-lockfile || error_exit "PaaS: yarn install failed"
            ;;
        npm)
            npm ci --no-fund --no-audit || error_exit "PaaS: npm ci failed"
            ;;
    esac
    log "PaaS: dependencies installed"

    if [[ -n "$CUSTOM_BUILD_CMD" ]]; then
        log "PaaS: using custom build command from .airo/config.json: $CUSTOM_BUILD_CMD"
        sh -c "$CUSTOM_BUILD_CMD" || error_exit "PaaS: custom build failed"
    else
        log "PaaS: running build (recovery)"
        "$PACKAGE_MANAGER" run build || error_exit "PaaS: build failed"
    fi
fi

# Environment. Do NOT create_env_file — PaaS apps read process.env.PORT directly.
# Env loaders no-op if the Nomad alloc config is missing.
load_customer_environment_variables
load_database_environment_variables

# Start: prefer custom serve command from .airo/config.json (preview derives
# it from scripts.start / dev with minor massaging during import). Fall back to
# "$PACKAGE_MANAGER start" when config is absent (edge case).
if [[ -n "$CUSTOM_SERVE_CMD" ]]; then
    log "PaaS: starting via custom serve command from .airo/config.json: $CUSTOM_SERVE_CMD"
    exec sh -c "$CUSTOM_SERVE_CMD"
fi

if ! jq -e '.scripts.start' package.json >/dev/null 2>&1; then
    error_exit "PaaS: package.json must define scripts.start (or runtime.serve.command in .airo/config.json)"
fi

log "PaaS: starting via $PACKAGE_MANAGER start"
exec "$PACKAGE_MANAGER" start
