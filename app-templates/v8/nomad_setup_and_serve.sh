#! /bin/bash

# fail immediately if anything fails
set -e

APP_DIR_READY="$CUSTOMER_APP_DIR"/.is_ready

while [ ! -f "$APP_DIR_READY" ]; do
    echo "Waiting for $APP_DIR_READY to appear..."
    sleep 2 # Wait for 2 seconds before checking again
done
echo "Completed: $APP_DIR_READY exists, proceeding with setup..."


if [ -d "$GIT_REPO_DIR/.git" ]; then
    echo "Started: Git repo exists on $GIT_REPO_DIR/.git"
    echo "Copying $GIT_REPO_DIR to $CUSTOMER_APP_DIR"
    cp -p -r "$GIT_REPO_DIR"/* "$CUSTOMER_APP_DIR"
    echo "Completed: Git repo exists on $GIT_REPO_DIR/.git"
else
    echo "Started: Git repo does not exist on $GIT_REPO_DIR/.git"
    echo "Copying $BASE_APP_DIR/* to $CUSTOMER_APP_DIR"
    # remove all files in $CUSTOMER_APP_DIR, including the hidden files and fail silently
    rm -r "$CUSTOMER_APP_DIR"/.git || true
    rm -r "$CUSTOMER_APP_DIR"/* || true
    cp -p -r "$BASE_APP_DIR"/* "$CUSTOMER_APP_DIR"
    echo "Completed: Git repo does not exist on $GIT_REPO_DIR/.git"
fi

# run `npm run dev` from $CUSTOMER_APP_DIR
echo "Running npm run dev from $CUSTOMER_APP_DIR"
cd "$CUSTOMER_APP_DIR" && npm run dev
