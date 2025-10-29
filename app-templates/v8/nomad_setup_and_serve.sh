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
