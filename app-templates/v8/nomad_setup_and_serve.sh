#!/bin/sh

# fail immediately if anything fails
set -e

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"
git config --global user.name "Airo AI Builder"
git config --global user.email "ai@airo.dev"

if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Existing application detected, checking if restoration is needed"

    # Only restore tracked files if package.json doesn't exist
    cd "$CUSTOMER_APP_DIR"
    if [ ! -f "package.json" ]; then
        echo "package.json not found, restoring all tracked files"
        git checkout .
    else
        echo "package.json exists, skipping checkout to preserve uncommitted changes"
    fi

    # sync package.json from base app template
    /management-scripts/sync-package-additions.js "$BASE_APP_DIR/package.json" "package.json"

    # Restore dependencies
    CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit

    # if .gitignore contains package-lock.json, then sed it out
    # remove the node_modules and npm-cache directories
    # reinstall the dependencies to resolve the bloated npm cache issue
    # this can be removed once all apps are reloaded in dev and prod
    if grep -q "package-lock.json" .gitignore; then
        sed -i '/package-lock.json/d' .gitignore
        rm -rf node_modules/ /npm-cache/*
        CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit
    fi

    # sync upstream dev-tools from base app template
    # we need to eventually create a public repo for dev-tools and sync them from there
    cp -r "$BASE_APP_DIR/dev-tools" "$CUSTOMER_APP_DIR/dev-tools"

    # if changes then commit them
    git add dev-tools package.json && git commit -m "Sync upstream dev tools and package.json $(date +%s)" || true

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
