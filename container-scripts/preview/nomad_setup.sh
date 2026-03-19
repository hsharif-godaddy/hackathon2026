#!/bin/bash

# Unified setup script for both first-start and restart scenarios.
# This script runs setup logic only - process start is handled by dev-supervisor.
#
# Detection relationship with dev-supervisor:
# - dev-supervisor (detectStartupMode) checks .git/config to decide WHEN to run this script:
#   immediate for first-start, deferred to first HTTP request for restart.
# - This script checks .git/config to decide WHAT work to do:
#   first-start (no .git/config) or restart (.git/config exists).
#
# Restart path always runs reset --hard + switch to main, then conditionally
# restores dependencies if node_modules is missing. This is idempotent —
# running on an already-clean workspace is a fast no-op.

# fail immediately if anything fails
set -e

# Helper function for timestamped logging
log_step() {
    echo "$1"
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

# Detect startup mode based on presence of .git/config
log_step "Checking for .git/config to determine startup mode..."

if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    # RESTART PATH: Always restore working tree and ensure main branch
    # Runs on every restart regardless of file state — reset --hard is idempotent
    # and handles: wiped ephemeral disk, partial state, dirty index, interrupted merges
    log_step "=== RESTART PATH detected ==="

    cd "$CUSTOMER_APP_DIR"

    # Clean stale lock files from crash/reschedule before any git operation
    log_step "Cleaning stale git lock files..."
    rm -f .git/index.lock .git/refs/heads/*.lock .git/packed-refs.lock

    # Restore working tree from HEAD
    # reset --hard clears index + working tree, handling more states than checkout .
    # Not a regression for uncommitted work: git checkout . also discards uncommitted
    # changes, and handleToolCallComplete commits after every tool call.
    log_step "Restoring working tree from HEAD..."
    git reset --hard
    log_step "Working tree restored"

    # Switch to main branch if not already there
    # No || true — if main doesn't exist something is fundamentally broken
    # and set -e should abort
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    log_step "Current branch: $CURRENT_BRANCH"
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log_step "Switching to main branch..."
        git checkout main
        log_step "Switched to main branch"
    fi

    # Sync package.json from template (handles both missing and outdated cases)
    if [ ! -f "$CUSTOMER_APP_DIR/package.json" ]; then
        log_step "package.json missing after reset, syncing from template..."
    else
        log_step "Syncing package.json updates from template..."
    fi
    /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"
    git add package.json && git commit -m "Sync upstream package.json $(date +%s)" || true

    if [ ! -d "$CUSTOMER_APP_DIR/node_modules" ]; then
        # Dependencies missing (ephemeral disk wiped node_modules)
        log_step "Installing dependencies with npm install (this may take a few minutes)..."
        CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
        log_step "Dependencies installed successfully"

        # Commit package-lock.json changes from npm install
        git add package-lock.json && git commit -m "Update package-lock.json $(date +%s)" || true
    fi

    # Sync upstream dev-tools and airo-secrets from base app template
    log_step "Syncing dev-tools and airo-secrets with rsync..."
    rsync -a --delete "$BASE_APP_DIR/dev-tools/" "$CUSTOMER_APP_DIR/dev-tools/"
    rsync -a --delete "$BASE_APP_DIR/airo-secrets/" "$CUSTOMER_APP_DIR/airo-secrets/"
    git add dev-tools airo-secrets && git commit -m "Sync upstream dev tools and airo-secrets $(date +%s)" || true
    log_step "dev-tools and airo-secrets synced"

    # Sync .npmrc from base app template
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
