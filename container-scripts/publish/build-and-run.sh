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

# Check if package-lock.json or pnpm-lock.yaml exists, if so set package manager to npm or pnpm
if [[ -f "package-lock.json" ]]; then
    PACKAGE_MANAGER="npm"
    log "Found package-lock.json"
elif [[ -f "pnpm-lock.yaml" ]]; then
    PACKAGE_MANAGER="pnpm"
    log "Found pnpm-lock.yaml"
else
    error_exit "No package-lock.json or pnpm-lock.yaml found. This runner only supports npm or pnpm package managers."
fi

# Verify package manager is available
if ! command -v "$PACKAGE_MANAGER" &> /dev/null; then
    error_exit "$PACKAGE_MANAGER command not found. Ensure $PACKAGE_MANAGER is installed."
fi
log "$PACKAGE_MANAGER version: $($PACKAGE_MANAGER --version)"

CONFIG_EXISTS=false
if [[ ! -f "${NOMAD_ALLOC_DIR}/config.json" ]]; then
    log_warn "Nomad allocation config not found at ${NOMAD_ALLOC_DIR}/config.json. Proceeding without it."
else
    log "Nomad allocation config found at ${NOMAD_ALLOC_DIR}/config.json"
    CONFIG_EXISTS=true
fi

# Install dependencies
log "Installing dependencies with $PACKAGE_MANAGER"
if [[ $PACKAGE_MANAGER == "pnpm" ]]; then
    CI=true pnpm install --frozen-lockfile || error_exit "Failed to install dependencies with pnpm"
else
    CI=true NODE_ENV=development npm install --legacy-peer-deps --no-fund --no-audit || error_exit "Failed to install dependencies with npm"
fi
log "Dependencies installed successfully"

# Build project - check for custom build command in .airo/config.json
BUILD_CMD="$PACKAGE_MANAGER run build"
if [[ -f ".airo/config.json" ]]; then
    CUSTOM_BUILD_CMD=$(jq -er '.runtime.build.command // empty' .airo/config.json 2>/dev/null || echo "")
    if [[ -n "$CUSTOM_BUILD_CMD" ]]; then
        BUILD_CMD="$CUSTOM_BUILD_CMD"
        log "Using custom build command from .airo/config.json"
    fi
fi
log "Building project with command: $BUILD_CMD"
sh -c "$BUILD_CMD" || error_exit "Failed to build project"
log "Project built successfully"

# Verify dist directory was created
if [[ ! -d "dist" ]]; then
    error_exit "dist directory not found after build. Build may have failed silently."
fi
log "Found dist directory"

# Push database migrations if applicable
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

# Execute built app - check for custom serve command in .airo/config.json
# Try to read custom serve command (handles missing file, empty file, invalid JSON, or missing field)
CUSTOM_SERVE_CMD=$(jq -er '.runtime.serve.command // empty' .airo/config.json 2>/dev/null || echo "")

load_customer_environment_variables

if [[ -n "$CUSTOM_SERVE_CMD" ]]; then
    # Custom config path - use the serve command from .airo/config.json
    log "Using custom serve command from .airo/config.json: $CUSTOM_SERVE_CMD"
    exec sh -c "$CUSTOM_SERVE_CMD"
else
    # Default path - requires dist/app.js
    if [[ ! -f "${APP_DIR}/dist/app.js" ]]; then
        error_exit "app.js not found in dist directory. Build output may be incorrect."
    fi
    log "Found app.js in dist directory"
    create_env_file "${APP_DIR}/dist"
    cd "${APP_DIR}/dist" || error_exit "Failed to change to directory: ${APP_DIR}/dist"
    log "Starting application with default command: /usr/local/bin/node ./app.js"
    exec /usr/local/bin/node ./app.js
fi
