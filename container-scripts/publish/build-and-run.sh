#!/bin/bash
set -euo pipefail

# Source common functions
# shellcheck source=./common.sh
source /publish/common.sh

# This script assumes the archive has already been extracted to $APP_DIR
# It performs the build and runs the application

# Change to app directory
cd "$APP_DIR" || error_exit "Failed to change directory to $APP_DIR"
log "Working in app directory: $APP_DIR"

# Verify critical files exist after extraction
if [[ ! -f "package.json" ]]; then
    error_exit "package.json not found. Archive may be corrupted or invalid."
fi
log "Found package.json"

# AAB supports only npm and pnpm; preserve existing priority (npm preferred).
detect_package_manager "npm pnpm"

# AAB-only runner. PaaS is dispatched to paas-run.sh from run-app.sh before
# reaching this script; see container-scripts/publish/run-app.sh.

check_nomad_config || true  # CONFIG_EXISTS gates db migrations below

# Install dependencies
log "Installing dependencies with $PACKAGE_MANAGER"
if [[ $PACKAGE_MANAGER == "pnpm" ]]; then
    CI=true pnpm install --frozen-lockfile || error_exit "Failed to install dependencies with pnpm"
else
    CI=true NODE_ENV=development npm install --legacy-peer-deps --no-fund --no-audit || error_exit "Failed to install dependencies with npm"
fi
log "Dependencies installed successfully"

# Build project. .airo/config.json is not read by this script, so AAB always
# runs the package-manager default regardless of whether the file is present
# in the archive.
log "Building project with command: $PACKAGE_MANAGER run build"
"$PACKAGE_MANAGER" run build || error_exit "Failed to build project"
log "Project built successfully"

# Push database migrations if applicable.
if [[ "$CONFIG_EXISTS" == "false" ]]; then
    log "Skipping database migrations because Nomad allocation config was not found"
elif [[ ! -d "drizzle" ]]; then
    log "Skipping database migrations because drizzle/ folder not found"
elif grep -q '"db:migrate"' package.json; then
    log "Running database migrations (db:migrate)"
    $PACKAGE_MANAGER run db:migrate || error_exit "Failed to migrate database with $PACKAGE_MANAGER"
    log "Database migrations completed successfully"
elif grep -q '"db:push"' package.json; then
    log "Running database migrations (db:push)"
    $PACKAGE_MANAGER run db:push || error_exit "Failed to push database migrations with $PACKAGE_MANAGER"
    log "Database migrations completed successfully"
else
    log "No db:push or db:migrate script found, skipping database migrations"
fi

# Execute built app by auto-detecting an entry point under dist/.
# Tries: dist/app.js, dist/index.js, dist/server.js, dist/main.js (first found wins).
# CROSS-SERVICE: These entry points match what app templates and common frameworks produce.
ENTRY_FILE=""
for candidate in "dist/app.js" "dist/index.js" "dist/server.js" "dist/main.js"; do
    if [[ -f "${APP_DIR}/${candidate}" ]]; then
        ENTRY_FILE="${candidate}"
        break
    fi
done

if [[ -z "$ENTRY_FILE" ]]; then
    error_exit "No entry point found in dist directory (tried: app.js, index.js, server.js, main.js). Build output may be incorrect or missing."
fi

log "Found entry point: ${ENTRY_FILE}"
create_env_file "${APP_DIR}/dist"
cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
log "Starting application with command: /usr/local/bin/node ./${ENTRY_FILE##*/}"
exec /usr/local/bin/node "./${ENTRY_FILE##*/}"
