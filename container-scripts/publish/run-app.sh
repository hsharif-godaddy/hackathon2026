#!/bin/bash
set -euo pipefail

# =================================================================
# Self-Contained Publish Script for Local Development
# Adapted from production scripts in pioneer-infra
# =================================================================

# =================================================================
# Inline Utility Functions (from common.sh)
# =================================================================

# Error handler
error_exit() {
    echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
    exit "${2:-1}"
}

# Log informational message
log() {
    echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Log warning message
log_warn() {
    echo "[WARN] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Create .env file for runtime configuration
create_env_file() {
    local dist_dir="$1"
    log "Creating .env file for runtime configuration"
    cat <<-EOF > "${dist_dir}/.env"
SERVER_HOST=0.0.0.0
SERVER_PORT=${PORT:-8081}
EOF
    log "Environment configuration: HOST=0.0.0.0 PORT=${PORT:-8081}"
}

# =================================================================
# Configuration
# =================================================================

# DIST_DIR is where archives are stored (set by docker-compose)
DIST_DIR="${DIST_DIR:-/dist}"

# APP_DIR is where we extract and run the archive (matches production)
readonly APP_DIR="/app"

# =================================================================
# Main Execution Flow
# =================================================================

# Verify node binary exists
if [[ ! -x "/usr/local/bin/node" ]]; then
    error_exit "Node binary not found or not executable: /usr/local/bin/node"
fi
log "Node version: $(/usr/local/bin/node --version)"

# Use current symlink (created by supervisor's publish API)
readonly ARCHIVE_PATH="${DIST_DIR}/current"

# If no symlink exists yet, serve Coming Soon page
if [[ ! -f "$ARCHIVE_PATH" ]] && [[ ! -L "$ARCHIVE_PATH" ]]; then
    log "No current symlink - serving Coming Soon page"
    exec /usr/local/bin/node /publish/coming-soon.js
    exit 0
fi

log "Using current symlink: ${ARCHIVE_PATH}"
log "Starting application deployment process"

# Verify distribution directory exists
[[ ! -d "$DIST_DIR" ]] && error_exit "Distribution directory not found: $DIST_DIR"

# Verify archive exists and is readable
[[ ! -f "$ARCHIVE_PATH" ]] && error_exit "Archive file not found: $ARCHIVE_PATH"
[[ ! -r "$ARCHIVE_PATH" ]] && error_exit "Archive file is not readable: $ARCHIVE_PATH"

# Log archive details
log "Archive path: $ARCHIVE_PATH"
log "Archive size: $(ls -lhL "$ARCHIVE_PATH" | awk '{print $5}')"

# Verify app directory is writable
[[ ! -w "$APP_DIR" ]] && error_exit "App directory is not writable: $APP_DIR"

# Extract archive directly to /app (matches production behavior)
log "Extracting archive to: $APP_DIR"
tar zxf "$ARCHIVE_PATH" -C "$APP_DIR" || error_exit "Failed to extract archive"
log "Archive extracted successfully"

# =================================================================
# Use Pre-built Artifacts
# =================================================================

# Assume pre-built artifacts (server.bundle.cjs) exist in tarball
log "Using pre-built artifacts (server.bundle.cjs)"

# Create .env file and start application
create_env_file "${APP_DIR}/dist"

log "Starting application script ./server.bundle.cjs"
cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
exec /usr/local/bin/node "${APP_DIR}/dist/server.bundle.cjs"