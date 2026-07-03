#!/bin/bash
set -euo pipefail

# Source common functions
# shellcheck source=./common.sh
source /publish/common.sh

export NODE_ENV=production

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

if [[ ! -f package.json ]]; then
    log_event "paas.run.package-json-missing" "error" '{}'
    error_exit "PaaS: package.json missing"
fi

PACKAGE_MANAGER=""

# Custom build/serve commands from .airo/config.json. Preview always writes
# these during import (AppRestartService.createPaasConfig); prefer them when
# present and fall back to "$PACKAGE_MANAGER run build" / "$PACKAGE_MANAGER
# start" when the file is absent (edge case).
CUSTOM_BUILD_CMD=""
CUSTOM_SERVE_CMD=""
AIRO_CONFIG_VALID=false
if [[ -f "$AIRO_CONFIG_PATH" ]]; then
    if jq -e '.' "$AIRO_CONFIG_PATH" >/dev/null 2>&1; then
        CUSTOM_BUILD_CMD=$(jq -r '.runtime.build.command // empty' "$AIRO_CONFIG_PATH")
        CUSTOM_SERVE_CMD=$(jq -r '.runtime.serve.command // empty' "$AIRO_CONFIG_PATH")
        AIRO_CONFIG_VALID=true
    else
        log_warn "PaaS: post-extract .airo/config.json is not valid JSON; using package-manager defaults"
    fi
fi

# jq --arg JSON-escapes each value, so embedded quotes/backslashes in the
# shell vars are safe; empty strings pass through as "".
log_event "paas.run.config-loaded" "info" "$(
    jq -cn \
        --arg hasAiroConfig "$AIRO_CONFIG_VALID" \
        --arg serveCommand "$CUSTOM_SERVE_CMD" \
        --arg buildCommand "$CUSTOM_BUILD_CMD" \
        --arg packageManager "$PACKAGE_MANAGER" \
        '{hasAiroConfig: ($hasAiroConfig == "true"), serveCommand: $serveCommand, buildCommand: $buildCommand, packageManager: $packageManager}'
)"

if [[ -d node_modules ]]; then
    log "PaaS: node_modules and build output present from preview - serving directly"
elif [[ -n "$CUSTOM_SERVE_CMD" ]] && ! lockfile_present; then
    log "PaaS: no node_modules and no lockfile - skipping install, using serve command"
elif lockfile_present; then
    resolve_package_manager "$AIRO_CONFIG_PATH"
    log "PaaS: node_modules missing - running install (recovery)"
    case "$PACKAGE_MANAGER" in
        pnpm)
            pnpm install --frozen-lockfile || error_exit "PaaS: pnpm install failed"
            ;;
        yarn)
            yarn install --frozen-lockfile --production=false || error_exit "PaaS: yarn install failed"
            ;;
        npm)
            npm ci --include=dev --no-fund --no-audit || error_exit "PaaS: npm ci failed"
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
else
    error_exit "PaaS: node_modules missing and no lockfile - cannot install dependencies"
fi

# Environment. Do NOT create_env_file — PaaS apps read process.env.PORT directly.
# Env loaders no-op if the Nomad alloc config is missing.
load_customer_environment_variables
load_database_environment_variables

# Start: prefer custom serve command from .airo/config.json (preview derives
# it from scripts.start / dev with minor massaging during import). Fall back to
# "$PACKAGE_MANAGER start" when config is absent (edge case).
if [[ -n "$CUSTOM_SERVE_CMD" ]]; then
    log_event "paas.run.start-command-resolved" "info" "$(
        jq -cn --arg source "airo-config" --arg command "$CUSTOM_SERVE_CMD" \
            '{source: $source, command: $command}'
    )"
    log "PaaS: starting via custom serve command from .airo/config.json: $CUSTOM_SERVE_CMD"
    log_event "paas.run.starting" "info" "$(
        jq -cn --arg source "airo-config" --arg command "$CUSTOM_SERVE_CMD" --arg pm "$PACKAGE_MANAGER" \
            '{source: $source, command: $command, packageManager: $pm}'
    )"
    exec sh -c "$CUSTOM_SERVE_CMD"
fi

# `jq -e '.scripts.start'` succeeds for "" (only null/false are falsy), so read
# the value and validate it's non-empty after leading/trailing trim — same rule
# as the TS preflight, so an empty/whitespace scripts.start fails the same way
# as a missing one instead of exec'ing `<pm> start` and hanging.
PKG_START_CMD=$(jq -r '.scripts.start // empty' package.json)
PKG_START_CMD="${PKG_START_CMD#"${PKG_START_CMD%%[![:space:]]*}"}"
PKG_START_CMD="${PKG_START_CMD%"${PKG_START_CMD##*[![:space:]]}"}"
if [[ -z "$PKG_START_CMD" ]]; then
    log_event "paas.run.missing-start-command" "error" "$(
        jq -cn \
            --arg hasAiroConfig "$AIRO_CONFIG_VALID" \
            '{hasAiroConfig: ($hasAiroConfig == "true"), hasStartScript: false, serveCommandFromAiroConfig: ""}'
    )"
    error_exit "PaaS: package.json must define a non-empty scripts.start (or runtime.serve.command in .airo/config.json)"
fi

resolve_package_manager "$AIRO_CONFIG_PATH"

log_event "paas.run.start-command-resolved" "info" "$(
    jq -cn --arg source "package.json" --arg command "$PKG_START_CMD" \
        '{source: $source, command: $command}'
)"
log "PaaS: starting via $PACKAGE_MANAGER start"
log_event "paas.run.starting" "info" "$(
    jq -cn --arg source "package.json" --arg command "$PACKAGE_MANAGER start" --arg pm "$PACKAGE_MANAGER" \
        '{source: $source, command: $command, packageManager: $pm}'
)"
exec "$PACKAGE_MANAGER" start
