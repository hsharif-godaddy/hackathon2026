#!/bin/sh

# This script is used to initialize the directories and files required for both the agent and the dev container
# It is run as the root user as a pre-start task to ensure the directories and files are created before the agent or dev container is started with the correct permissions

# fail immediately if anything fails
set -e

OWNER="${USER_ID:-agent}"

# create the necessary directories
mkdir -p "${CUSTOMER_APP_DIR}" "${CEPH_STORAGE_DIR}/git-repo" "${CEPH_STORAGE_DIR}/agent"

# set ownership of the directories
chown -R "$OWNER" "${CUSTOMER_APP_DIR}" "${CEPH_STORAGE_DIR}/git-repo" "${CEPH_STORAGE_DIR}/agent"

# execute the provided arguments
exec $@
