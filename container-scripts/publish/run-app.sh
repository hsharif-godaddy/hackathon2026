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

# Unified job mode: move publish config to task-local directory and create symlink
if [ -f "${NOMAD_ALLOC_DIR}/publish-config.json" ]; then
    mv "${NOMAD_ALLOC_DIR}/publish-config.json" "${NOMAD_TASK_DIR}/config.json"
    ln -sf "${NOMAD_TASK_DIR}/config.json" "${NOMAD_ALLOC_DIR}/config.json"
    echo "Configured secrets at ${NOMAD_TASK_DIR}/config.json (symlinked from ${NOMAD_ALLOC_DIR}/config.json)"
fi

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

# Extract archive
log "Extracting archive to: $APP_DIR"
tar zxf "$ARCHIVE_PATH" -C "$APP_DIR" || error_exit "Failed to extract archive"
log "Archive extracted successfully"

# Change to app directory
cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
log "Changed to app directory: $APP_DIR"

# Detect if archive contains pre-built artifacts or needs to be built
if [[ -f "${APP_DIR}/dist/server.bundle.cjs" ]]; then
    log "Detected pre-built artifacts (server.bundle.cjs) - using fast path"

    # Create .env file and start application
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
