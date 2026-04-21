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

# Serve status page if site is suspended (takes priority over customer app)
if [[ "${SUSPENDED:-}" == "true" ]]; then
    log "Site is suspended - serving status page"
    cp /publish/status-page.js "${APP_DIR}/app.js"
    cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
    exec /usr/local/bin/node ./app.js
fi

# Determine archive path from argument or current file
if [[ -n "${1:-}" ]]; then
    log "Archive argument provided: $1"
    readonly ARCHIVE_PATH="${DIST_DIR}/$1"
elif [[ -f "${DIST_DIR}/current" ]]; then
    log "No archive argument - using current"
    readonly ARCHIVE_PATH="${DIST_DIR}/current"
else
    log "No archive argument and no current file - serving status page"
    cp /publish/status-page.js "${APP_DIR}/app.js"
    log "Created status page app at ${APP_DIR}/app.js"
    cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
    exec /usr/local/bin/node ./app.js
fi

log "Starting application deployment process"

# Verify Distribution directory exists
[[ ! -d "$DIST_DIR" ]] && error_exit "Distribution directory not found: $DIST_DIR"

# Verify archive exists and is readable
[[ ! -f "$ARCHIVE_PATH" ]] && error_exit "Archive file not found: $ARCHIVE_PATH"
[[ ! -r "$ARCHIVE_PATH" ]] && error_exit "Archive file is not readable: $ARCHIVE_PATH"

# Log archive details
log "Archive path: $ARCHIVE_PATH"
log "Archive size: $(ls -lhL "$ARCHIVE_PATH" | awk '{print $5}')"

# Publish cleanup before extraction to remove stale files when explicitly enabled
AIRO_CONFIG_PATH="${APP_DIR}/.airo/config.json"
CLEANUP_ENABLED=$(jq -r '.cleanAppDirBeforeExtract // false' "$AIRO_CONFIG_PATH" 2>/dev/null || echo "false")

if [[ "$CLEANUP_ENABLED" == "true" ]]; then
    log "Cleanup enabled - cleaning app directory before extraction"
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
else
    log "Skipping cleanup (cleanAppDirBeforeExtract: ${CLEANUP_ENABLED})"
fi

# Extract archive
log "Extracting archive to: $APP_DIR"
EXTRACT_START_MS=$(($(date +%s%N)/1000000))
tar zxf "$ARCHIVE_PATH" -C "$APP_DIR" || error_exit "Failed to extract archive"
EXTRACT_END_MS=$(($(date +%s%N)/1000000))
EXTRACT_DURATION_MS=$((EXTRACT_END_MS - EXTRACT_START_MS))
log "Archive extracted successfully, extractDurationMs=${EXTRACT_DURATION_MS}"

# Change to app directory
cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
log "Changed to app directory: $APP_DIR"

# Detect if archive contains pre-built artifacts or needs to be built
# Check for ESM bundle first (current), then fall back to CJS (legacy archives)
# CROSS-SERVICE: Archive content strategy determined by agents/src/utils/git.ts createArchive()
# - dist-only archives: contain pre-built server.bundle.mjs/cjs → fast path below
# - full-source archives (PaaS): contain source + package.json → build-and-run.sh path
if [[ -f "${APP_DIR}/dist/server.bundle.mjs" ]]; then
    log "Detected pre-built artifacts (server.bundle.mjs) - using fast path"

    load_customer_environment_variables

    # Create .env file and start application
    create_env_file "${APP_DIR}/dist"

    log "Starting application script ./server.bundle.mjs"
    cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
    exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.mjs"
elif [[ -f "${APP_DIR}/dist/server.bundle.cjs" ]]; then
    log "Detected pre-built artifacts (server.bundle.cjs) - using legacy fast path"

    load_customer_environment_variables

    create_env_file "${APP_DIR}/dist"

    log "Starting application script ./server.bundle.cjs"
    cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
    exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.cjs"
else
    log "No pre-built artifacts detected - falling back to build process"
    log "Delegating to build-and-run.sh for build and deployment"

    # Archive has already been extracted, build-and-run.sh will build and run
    exec /publish/build-and-run.sh
fi
