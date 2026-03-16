#!/bin/bash

# Unified setup script for both first-start and restart scenarios.
# This script runs setup logic only - process start is handled by dev-supervisor.
#
# Detection relationship with dev-supervisor:
# - dev-supervisor (detectStartupMode) checks .git/config to decide WHEN to run this script:
#   immediate for first-start, deferred to first HTTP request for restart.
# - This script checks .git/config + package.json to decide WHAT work to do:
#   first-start init, corrupted restart recovery, or clean restart (no-op).

# fail immediately if anything fails
set -e

# Helper function for timestamped logging
log_step() {
    echo $1
}

log_step "=== Setup script started ==="

# In production, CUSTOMER_APP_DIR and BASE_APP_DIR are set by deployment system
CUSTOMER_APP_DIR="${CUSTOMER_APP_DIR:-/app}"
BASE_APP_DIR="${BASE_APP_DIR:-/app-template}"

log_step "Using CUSTOMER_APP_DIR=$CUSTOMER_APP_DIR BASE_APP_DIR=$BASE_APP_DIR"

# add the customer app directory to the git safe directory
log_step "Configuring git global settings..."
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"
git config --global user.name "Airo AI Builder"
git config --global user.email "ai@airo.dev"
log_step "Git configuration complete"

log_step "Changing directory to $CUSTOMER_APP_DIR"
cd "$CUSTOMER_APP_DIR"

# Unified job mode: move preview config to task-local directory and create symlink
# This must happen before mode detection so config is available for both first-start and restart
log_step "Checking for preview config..."
if [ -f "${NOMAD_ALLOC_DIR}/preview-config.json" ]; then
    log_step "Moving preview config to task-local directory..."
    mv "${NOMAD_ALLOC_DIR}/preview-config.json" "${NOMAD_TASK_DIR}/config.json"
    ln -sf "${NOMAD_TASK_DIR}/config.json" "${NOMAD_ALLOC_DIR}/config.json"
    log_step "Configured secrets at ${NOMAD_TASK_DIR}/config.json"
else
    log_step "No preview config found, skipping"
fi

# Detect startup mode based on presence of .git/config and package.json
# This matches the behavior of nomad_setup_and_serve.sh
log_step "Checking for .git/config and package.json to determine startup mode..."

if [ -f "$CUSTOMER_APP_DIR/.git/config" ] && [ ! -f "$CUSTOMER_APP_DIR/package.json" ]; then
    # RESTART PATH: Existing application with missing package.json (corrupted workspace)
    log_step "=== RESTART PATH detected (corrupted workspace) ==="
    log_step "Will: restore files, sync template updates, and reinstall dependencies"

    cd "$CUSTOMER_APP_DIR"

    # Restore all tracked files from current HEAD
    log_step "Restoring tracked files from git..."
    git checkout .
    log_step "Files restored from git"

    # Ensure we're on the main branch before making any commits
    # This handles cases where the repo might be in detached HEAD state
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    log_step "Current branch: $CURRENT_BRANCH"
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log_step "Switching to main branch..."
        git checkout main || true
        log_step "Switched to main branch"
    fi

    # Sync package.json from base app template to get latest dependencies
    log_step "Syncing package.json from base template..."
    /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"
    log_step "package.json synced"

    # Restore dependencies
    log_step "Installing dependencies with npm install (this may take a few minutes)..."
    CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
    log_step "Dependencies installed successfully"

    # Commit synced package.json and package-lock.json (npm install updates the lockfile)
    log_step "Committing package.json changes..."
    git add package.json package-lock.json && git commit -m "Sync upstream package.json $(date +%s)" || true
    log_step "Package.json changes committed"

    # Sync upstream dev-tools and airo-secrets from base app template
    # Using rsync to ensure the files are deleted if they don't exist in the base app template
    log_step "Syncing dev-tools and airo-secrets with rsync..."
    rsync -a --delete "$BASE_APP_DIR/dev-tools/" "$CUSTOMER_APP_DIR/dev-tools/"
    rsync -a --delete "$BASE_APP_DIR/airo-secrets/" "$CUSTOMER_APP_DIR/airo-secrets/"
    log_step "dev-tools and airo-secrets synced"

    # If changes then commit them
    log_step "Committing dev-tools and airo-secrets changes..."
    git add dev-tools airo-secrets && git commit -m "Sync upstream dev tools and airo-secrets $(date +%s)" || true
    log_step "dev-tools/airo-secrets changes committed"

    # Sync .npmrc from base app template to ensure registry configuration is up to date
    log_step "Syncing .npmrc..."
    cp "$BASE_APP_DIR/.npmrc" "$CUSTOMER_APP_DIR/.npmrc"
    git add .npmrc && git commit -m "Sync upstream .npmrc $(date +%s)" || true
    log_step ".npmrc synced"

    # Sync template files that are safe to update (only replaces unmodified files)
    log_step "Syncing template files (unmodified files only)..."
    /management-scripts/sync-template-files.js "$BASE_APP_DIR" "$CUSTOMER_APP_DIR"
    git add . && git commit -m "Sync upstream template files $(date +%s)" || true
    log_step "Template files synced"

    log_step "=== RESTART SETUP COMPLETE ==="
fi

if [ ! -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    # FIRST-START PATH: New application initialization
    log_step "=== FIRST-START PATH detected ==="
    log_step "Will: initialize git, copy template files, and install dependencies"

    cd "$CUSTOMER_APP_DIR"

    # Initialize git repository (must be done before copy to avoid copying .git)
    log_step "Step 1/5: Initializing git repository..."
    git init --initial-branch=main
    log_step "Step 1/5: Git repository initialized"

    # Copy template files, including hidden files (.gitignore, .api, .version, .npmrc and etc)
    # This ensures the app gets the latest template version from the base Docker image
    log_step "Step 2/5: Copying template files from $BASE_APP_DIR to $CUSTOMER_APP_DIR..."
    cp -r "$BASE_APP_DIR"/. "$CUSTOMER_APP_DIR"
    log_step "Step 2/5: Template files copied successfully"

    # Install dependencies from cache (not pre-installed in image for size/cache optimization)
    log_step "Step 3/5: Installing dependencies with npm ci (this may take a few minutes)..."
    CI=true npm ci --registry=https://registry.npmjs.org/ --no-fund --no-audit
    log_step "Step 3/5: Dependencies installed successfully"

    # Initial commit with all template files
    log_step "Step 4/5: Adding files to git..."
    git add .
    log_step "Step 4/5: Files added to git"

    log_step "Step 5/5: Creating initial commit..."
    git commit -m "Initial application setup"
    log_step "Step 5/5: Initial commit created"

    log_step "=== FIRST-START SETUP COMPLETE ==="
fi

# Customer env (SYSTEM_MANAGED=false from config.json) is loaded by dev-supervisor from
# NOMAD_ALLOC_DIR/config.json when starting the process, so no setup here is needed.

log_step "=== Setup script finished successfully ==="
exit 0
