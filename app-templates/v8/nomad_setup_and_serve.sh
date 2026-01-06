#!/bin/sh

# fail immediately if anything fails
set -e

# Unified job mode: select preview config and remove publish config for security
if [ -f "${NOMAD_ALLOC_DIR}/preview-config.json" ]; then
    mv "${NOMAD_ALLOC_DIR}/preview-config.json" "${NOMAD_ALLOC_DIR}/config.json"
    rm -f "${NOMAD_ALLOC_DIR}/publish-config.json"
    echo "Configured secrets at ${NOMAD_ALLOC_DIR}/config.json"
fi

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"
git config --global user.name "Airo AI Builder"
git config --global user.email "ai@airo.dev"

if [ -f "$CUSTOMER_APP_DIR/.git/config" ] && [ ! -f "$CUSTOMER_APP_DIR/package.json" ]; then
    echo "Existing application detected, package.json missing, restoring tracked files"

    cd "$CUSTOMER_APP_DIR"

    # Restore all tracked files from current HEAD
    git checkout .

    # Ensure we're on the main branch before making any commits
    # This handles cases where the repo might be in detached HEAD state
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo "Not on main branch (current: $CURRENT_BRANCH), switching to main..."
        git checkout main || true
    fi

    # sync package.json from base app template
    /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"

    # Restore dependencies
    CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit

    # sync package.json and package-lock.json, this needs to be done after npm install to ensure the lockfile is up to date
    git add package.json package-lock.json && git commit -m "Sync upstream package.json $(date +%s)" || true

    # if .gitignore contains package-lock.json, then sed it out
    # remove the node_modules and npm-cache directories
    # reinstall the dependencies to resolve the bloated npm cache issue
    # this can be removed once all apps are reloaded in dev and prod
    if grep -q "package-lock.json" .gitignore; then
        sed -i '/package-lock.json/d' .gitignore
        rm -rf node_modules/ /npm-cache/*
        CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
    fi

    # sync database and server configuration files from base app template if they don't exist
    # this ensures apps have the latest db client, schema, and server configuration
    # this can be removed once all apps are reloaded in dev and prod
    for file in "src/server/configure.js" "bundle.js" "drizzle.config.ts" "src/server/db/client.ts" "src/server/db/schema.ts" "src/server/db/config.ts"; do
        if [ ! -f "$file" ]; then
            echo "Syncing missing file: $file"
            mkdir -p "$(dirname "$file")"
            cp "$BASE_APP_DIR/$file" "$file"
            git add "$file" && git commit -m "Sync upstream file: $file $(date +%s)" || true
        fi
    done

    # sync upstream dev-tools and airo-secrets from base app template
    # we need to eventually create a public repo for dev-tools & airo-secrets and sync them from there
    # using rsync to ensure the files are deleted if they don't exist in the base app template
    rsync -a --delete "$BASE_APP_DIR/dev-tools/" "$CUSTOMER_APP_DIR/dev-tools/"
    rsync -a --delete "$BASE_APP_DIR/airo-secrets/" "$CUSTOMER_APP_DIR/airo-secrets/"

    # if changes then commit them
    git add dev-tools airo-secrets && git commit -m "Sync upstream dev tools and airo-secrets $(date +%s)" || true

    # sync commerce client and API from base app template
    # this ensures apps have the latest commerce integration for checkout flows
    for file in "src/lib/commerce-client.ts" "src/server/api/commerce/create-checkout-session/POST.ts"; do
        mkdir -p "$(dirname "$file")"
        cp "$BASE_APP_DIR/$file" "$file"
    done
    git add src/lib/commerce-client.ts src/server/api/commerce && git commit -m "Sync upstream commerce files $(date +%s)" || true

    # sync .npmrc from base app template to ensure registry configuration is up to date
    cp "$BASE_APP_DIR/.npmrc" "$CUSTOMER_APP_DIR/.npmrc"
    git add .npmrc && git commit -m "Sync upstream .npmrc $(date +%s)" || true

    # sync template files that are safe to update (only replaces unmodified files)
    /management-scripts/sync-template-files.js "$BASE_APP_DIR" "$CUSTOMER_APP_DIR"
    git add . && git commit -m "Sync upstream template files $(date +%s)" || true

    echo "Completed: Existing application detected, restored all tracked files and dependencies"
fi

if [ ! -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Fresh application detected, initializing git repository"

    # Initialize git repository
    git init --initial-branch=main

    # Copy template files, including hidden files (.gitignore, .api, .version, .npmrc and etc)
    cp -r "$BASE_APP_DIR"/. "$CUSTOMER_APP_DIR"

    # Install dependencies
    CI=true npm ci --registry=https://registry.npmjs.org/ --no-fund --no-audit

    # Initial commit
    git add .
    git commit -m "Initial application setup"

    echo "Completed: Fresh application detected, copied template files and initialized git repository"
fi

# run `npm run dev` from $CUSTOMER_APP_DIR
echo "Running npm run dev from $CUSTOMER_APP_DIR"
cd "$CUSTOMER_APP_DIR" && exec npm run dev
