#!/bin/sh

# fail immediately if anything fails
set -e

# Unified job mode: move agent config to task-local directory and create symlink
if [ -f "${NOMAD_ALLOC_DIR}/agent-config.json" ]; then
    mv "${NOMAD_ALLOC_DIR}/agent-config.json" "${NOMAD_TASK_DIR}/config.json"
    ln -sf "${NOMAD_TASK_DIR}/config.json" "${NOMAD_ALLOC_DIR}/config.json"
    echo "Configured agent secrets at ${NOMAD_TASK_DIR}/config.json (symlinked from ${NOMAD_ALLOC_DIR}/config.json)"
fi

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"

# create ~/.aws directory
mkdir -p ~/.aws

# create the .aws/config file, required for the agent to be able to access the gocode
echo -e "[profile ${GOCODE_AWS_PROFILE}]\nrole_arn=${GOCODE_AWS_ROLE_ARN}\nsource_profile=default\nregion=${GOCODE_AWS_REGION}" > ~/.aws/config

# Socket wait timeout (seconds) - default 300s (5 minutes)
SOCKET_TIMEOUT="${AIRO_SUPERVISOR_SOCKET_TIMEOUT:-300}"

# Function to wait for a socket with timeout
wait_for_socket() {
    local socket_path=$1
    local socket_name=$2
    local elapsed=0
    
    while [ ! -S "$socket_path" ]; do
        if [ $elapsed -ge $SOCKET_TIMEOUT ]; then
            echo "ERROR: Timeout waiting for ${socket_name} socket at ${socket_path}"
            echo "Waited ${SOCKET_TIMEOUT} seconds but socket was not created"
            exit 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
        
        # Log progress every 30 seconds
        if [ $((elapsed % 30)) -eq 0 ]; then
            echo "Still waiting for ${socket_name} socket... (${elapsed}s elapsed)"
        fi
    done
}

# Check if we're using v4 unified job (dual sockets) or v3 (single socket)
if [ -n "$AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH" ] && [ -n "$AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH" ]; then
    # V4 UNIFIED JOB: Wait for both preview and publish sockets
    echo "V4 unified job detected - waiting for both preview and publish sockets (timeout: ${SOCKET_TIMEOUT}s)..."
    echo "  Preview socket: ${AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH}"
    echo "  Publish socket: ${AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH}"
    
    # Wait for preview socket
    echo "Waiting for preview socket..."
    wait_for_socket "$AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH" "preview"
    echo "✓ Preview socket is available"
    
    # Wait for publish socket
    echo "Waiting for publish socket..."
    wait_for_socket "$AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH" "publish"
    echo "✓ Publish socket is available"
    
    echo "All airo-supervisor sockets are ready!"
    
    # Export socket paths for the agents to use
    export AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH
    export AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH
    
else
    # V3 LEGACY: Wait for single socket (using optimized wait function)
    SOCKET_PATH="${DEV_SUPERVISOR_SOCKET_PATH:-$NOMAD_ALLOC_DIR/tmp/$SITE_ID-dev-supervisor.sock}"
    echo "Waiting for dev-supervisor socket at ${SOCKET_PATH}..."
    wait_for_socket "$SOCKET_PATH" "dev-supervisor"
    echo "Dev-supervisor socket is available"
fi

# run the app
exec $@
