#!/bin/sh

# Development version of nomad_setup_and_serve.sh
# This script aligns dev environment with production git initialization

# fail immediately if anything fails
set -e

# In development, we use /app as both base and customer directories
CUSTOMER_APP_DIR="${CUSTOMER_APP_DIR:-/app}"
BASE_APP_DIR="${BASE_APP_DIR:-/app}"

# Create .is_ready file to indicate template files are ready
# In dev, this happens immediately since files are copied by Docker
touch "$CUSTOMER_APP_DIR"/.is_ready

APP_DIR_READY="$CUSTOMER_APP_DIR"/.is_ready

while [ ! -f "$APP_DIR_READY" ]; do
    echo "Waiting for $APP_DIR_READY to appear..."
    sleep 2 # Wait for 2 seconds before checking again
done
echo "Completed: $APP_DIR_READY exists, proceeding with setup..."

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"
git config --global user.name "Airo AI Builder"
git config --global user.email "ai@airo.dev"

if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Existing application detected, checking if restoration is needed"

    # Only restore tracked files if the directory is essentially empty (only .git exists)
    # This prevents discarding uncommitted changes
    cd "$CUSTOMER_APP_DIR"
    FILE_COUNT=$(find . -mindepth 1 -maxdepth 1 ! -name '.git' | wc -l)
    
    if [ "$FILE_COUNT" -eq 0 ]; then
        echo "Directory is empty (only .git exists), restoring all tracked files"
        git checkout .
    else
        echo "Directory contains files, skipping checkout to preserve uncommitted changes"
    fi

    CI=true npm install --registry=https://registry.npmjs.org/ --no-fund --no-audit

    echo "Completed: Existing application detected, restored all tracked files and dependencies"
fi

if [ ! -f "$CUSTOMER_APP_DIR/.git/config" ]; then
    echo "Fresh application detected, initializing git repository"

    # Initialize git repository
    git init --initial-branch=main

    # Files are already in place from Docker COPY, so just add them
    # Initial commit
    git add .
    git commit -m "Initial application setup"

    echo "Completed: Fresh application detected, initialized git repository"
fi

# run `npm run dev` from $CUSTOMER_APP_DIR
echo "Running development server from $CUSTOMER_APP_DIR"
cd "$CUSTOMER_APP_DIR"

exec npm run dev
