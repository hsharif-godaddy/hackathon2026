#!/bin/sh

# fail immediately if anything fails
set -e

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"
git config --global user.name "Airo AI Builder"
git config --global user.email "ai@airo.dev"

if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Existing application detected, restoring all tracked files and dependencies"

    # Restore all tracked files
    git checkout .

    # Restore dependencies
    CI=true pnpm install --registry=https://registry.npmjs.org/

    # dotenv-local needs to be installed so that publishing works
    # this can be removed once all apps are reloaded in dev and prod
    DOTENV_VERSION=$(jq -r '.dependencies["dotenv-local"]' "$BASE_APP_DIR/package.json")
    pnpm add "dotenv-local@$DOTENV_VERSION"

    # sync upstream dev-tools from base app template
    # we need to eventually create a public repo for dev-tools and sync them from there
    cp -r "$BASE_APP_DIR/dev-tools" "$CUSTOMER_APP_DIR/dev-tools"

    # if changes then commit them
    git add . && git commit -m "Sync upstream dev tools $(date +%s)" || true

    echo "Completed: Existing application detected, restored all tracked files and dependencies"
fi

if [ ! -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Fresh application detected, initializing git repository"

    # Initialize git repository
    git init --initial-branch=main

    # Copy template files, including hidden files (.gitignore, .api, .version, .npmrc and etc)
    cp -r "$BASE_APP_DIR"/. "$CUSTOMER_APP_DIR"

    # Install dependencies
    CI=true pnpm install --frozen-lockfile --registry=https://registry.npmjs.org/

    # Initial commit
    git add .
    git commit -m "Initial application setup"

    echo "Completed: Fresh application detected, copied template files and initialized git repository"
fi

# run `npm run dev` from $CUSTOMER_APP_DIR
echo "Running npm run dev from $CUSTOMER_APP_DIR"
cd "$CUSTOMER_APP_DIR" && exec npm run dev
