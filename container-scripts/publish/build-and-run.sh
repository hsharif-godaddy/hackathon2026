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

# =============================================================================
# PaaS OPTIMIZATION: Skip install/build if pre-packaged
# =============================================================================
# If node_modules exists, skip npm install (dependencies pre-packaged from preview)
# If dist exists, skip build (already built in preview)
SKIP_INSTALL=false
SKIP_BUILD=false

if [[ -d "node_modules" ]]; then
    log "Detected pre-packaged node_modules - skipping dependency installation"
    SKIP_INSTALL=true
fi

if [[ -d "dist" ]]; then
    log "Detected pre-built dist/ - skipping build step"
    SKIP_BUILD=true
fi
# =============================================================================

CONFIG_EXISTS=false
if [[ ! -f "${NOMAD_ALLOC_DIR}/config.json" ]]; then
    log_warn "Nomad allocation config not found at ${NOMAD_ALLOC_DIR}/config.json. Proceeding without it."
else
    log "Nomad allocation config found at ${NOMAD_ALLOC_DIR}/config.json"
    CONFIG_EXISTS=true
fi

# Install dependencies (skip if pre-packaged)
if [[ "$SKIP_INSTALL" == "true" ]]; then
    log "Skipping dependency installation (node_modules pre-packaged)"
else
    log "Installing dependencies with $PACKAGE_MANAGER"
    if [[ $PACKAGE_MANAGER == "pnpm" ]]; then
        CI=true pnpm install --frozen-lockfile || error_exit "Failed to install dependencies with pnpm"
    else
        CI=true NODE_ENV=development npm install --legacy-peer-deps --no-fund --no-audit || error_exit "Failed to install dependencies with npm"
    fi
    log "Dependencies installed successfully"
fi

# Read custom commands from .airo/config.json (if exists)
CUSTOM_BUILD_CMD=""
CUSTOM_SERVE_CMD=""
if [[ -f ".airo/config.json" ]]; then
    CUSTOM_BUILD_CMD=$(jq -er '.runtime.build.command // empty' .airo/config.json 2>/dev/null || echo "")
    CUSTOM_SERVE_CMD=$(jq -er '.runtime.serve.command // empty' .airo/config.json 2>/dev/null || echo "")
fi

# Build project (skip if pre-built)
if [[ "$SKIP_BUILD" == "true" ]]; then
    log "Skipping build (dist/ pre-built)"
else
    BUILD_CMD="$PACKAGE_MANAGER run build"
    if [[ -n "$CUSTOM_BUILD_CMD" ]]; then
        BUILD_CMD="$CUSTOM_BUILD_CMD"
        log "Using custom build command from .airo/config.json"
    fi
    log "Building project with command: $BUILD_CMD"
    sh -c "$BUILD_CMD" || error_exit "Failed to build project"
    log "Project built successfully"
fi

# Verify dist directory was created (only if using default serve command)
# Custom serve commands may not require a dist directory
# CROSS-SERVICE: Dist validation also exists in agents/src/utils/git.ts
# When modifying this check, verify the agents-side logic is consistent
if [[ -z "$CUSTOM_SERVE_CMD" ]]; then
    if [[ ! -d "dist" ]]; then
        error_exit "dist directory not found after build. Build may have failed silently."
    fi
    log "Found dist directory"
else
    log "Using custom serve command - skipping dist directory check"
fi

# Detect PaaS flow by checking productId from config files
# PaaS apps skip migrations here because preview already ran them on shared DB
IS_PAAS_FLOW=false

# Check .airo/config.json for productId (e.g., "paas-nodejs-v1")
if [[ -f ".airo/config.json" ]]; then
    PRODUCT_ID=$(jq -r '.productId // empty' .airo/config.json 2>/dev/null || echo "")
    if [[ "$PRODUCT_ID" == paas-* ]]; then
        IS_PAAS_FLOW=true
    fi
fi

# Fallback: check /alloc/config.json for PRODUCT_ID.VALUE
if [[ "$IS_PAAS_FLOW" == "false" && -f "${NOMAD_ALLOC_DIR}/config.json" ]]; then
    PRODUCT_ID=$(jq -r '.PRODUCT_ID.VALUE // empty' "${NOMAD_ALLOC_DIR}/config.json" 2>/dev/null || echo "")
    if [[ "$PRODUCT_ID" == paas-* ]]; then
        IS_PAAS_FLOW=true
    fi
fi

# Push database migrations if applicable (AAB only - PaaS runs migrations in preview)
if [[ "$IS_PAAS_FLOW" == "true" ]]; then
    log "Skipping database migrations (PaaS flow - preview handles migrations)"
elif [[ "$CONFIG_EXISTS" == "false" ]]; then
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

# Execute built app using custom serve command (if configured) or auto-detect entry point
# Default path tries: dist/app.js, dist/index.js, dist/server.js, dist/main.js (first found wins)

load_customer_environment_variables
load_database_environment_variables

if [[ -n "$CUSTOM_SERVE_CMD" ]]; then
    # Custom config path - use the serve command from .airo/config.json
    log "Using custom serve command from .airo/config.json: $CUSTOM_SERVE_CMD"
    exec sh -c "$CUSTOM_SERVE_CMD"
else
    # Default path - try common entry points in order of preference
    # CROSS-SERVICE: These entry points match what app templates and common frameworks produce
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
fi
