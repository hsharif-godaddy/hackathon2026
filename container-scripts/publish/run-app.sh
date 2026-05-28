#!/bin/bash
set -euo pipefail

# Source common functions
# shellcheck source=./common.sh
source /publish/common.sh

# DIST_DIR is the directory where the distribution files are stored
# It is set to default to /dist for v4, override via environment variable
DIST_DIR="${DIST_DIR:-/dist}"

# Verify node binary exists
if [[ ! -x "/usr/local/bin/node" ]]; then
    error_exit "Node binary not found or not executable: /usr/local/bin/node"
fi
log "Node version: $(/usr/local/bin/node --version)"

# Verify app directory exists and is writable
[[ ! -d "$APP_DIR" ]] && error_exit "App directory not found: $APP_DIR"
[[ ! -w "$APP_DIR" ]] && error_exit "App directory is not writable: $APP_DIR"

# Suspended-site handling lives in dev-supervisor: it skips invoking this
# script entirely when SUSPENDED=true and serves the embedded status page
# from its HTTP proxy.
#
# Defense-in-depth: if the supervisor's variant detection ever drifts and
# this script does run while suspended, exit 0 so dev-supervisor sees a
# clean exit and the embedded Suspended HTML continues to be served.
if [[ "${SUSPENDED:-}" == "true" ]]; then
    log "SUSPENDED=true — exiting cleanly so dev-supervisor can serve status page"
    exit 0
fi

# Determine archive path from argument or current file
if [[ -n "${1:-}" ]]; then
    log "Archive argument provided: $1"
    readonly ARCHIVE_PATH="${DIST_DIR}/$1"
elif [[ -f "${DIST_DIR}/current" ]]; then
    log "No archive argument - using current"
    readonly ARCHIVE_PATH="${DIST_DIR}/current"
else
    # No publish archive yet. Exit cleanly so dev-supervisor's HTTP proxy
    # can serve the embedded "Coming Soon" status page in place of the
    # customer app. dev-supervisor only restarts on health-check policy
    # (not on clean exit), so this does not loop.
    log "No archive argument and no current file - exiting cleanly so dev-supervisor can serve status page"
    exit 0
fi

log "Starting application deployment process"

# ============================================================================
# FLOW DISPATCH
# ============================================================================
# PaaS owns its full lifecycle (cleanup → extract → install/build → start) and
# is dispatched BEFORE extraction. AAB extracts here, then picks a runtime
# path based on archive contents.
# ============================================================================
if is_paas_flow; then
    log "PaaS flow detected - delegating to paas-run.sh"
    export ARCHIVE_PATH
    exec /publish/paas-run.sh
else
    process_archive

    # ------------------------------------------------------------------------
    # AAB ARCHIVE TYPE DETECTION
    # ------------------------------------------------------------------------
    # Archives can be:
    # 1. AAB pre-built bundle (server.bundle.mjs/cjs) → fastest path, just run
    # 2. AAB source archive → delegate to build-and-run.sh (legacy/fallback)
    # CROSS-SERVICE: Archive content strategy determined by
    # agents/src/utils/git.ts createArchive()
    # ------------------------------------------------------------------------
    if [[ -f "${APP_DIR}/dist/server.bundle.mjs" ]]; then
        log "Detected pre-built artifacts (server.bundle.mjs) - using fast path"

        create_env_file "${APP_DIR}/dist"

        log "Starting application script ./server.bundle.mjs"
        cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
        exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.mjs"

    elif [[ -f "${APP_DIR}/dist/server.bundle.cjs" ]]; then
        log "Detected pre-built artifacts (server.bundle.cjs) - using legacy fast path"

        create_env_file "${APP_DIR}/dist"

        log "Starting application script ./server.bundle.cjs"
        cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
        exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.cjs"

    else
        log "No pre-built bundle detected - delegating to build-and-run.sh"
        exec /publish/build-and-run.sh
    fi
fi
