#!/bin/sh

# This script is used to initialize the directories and files required for both the agent and the dev container
# It is run as the root user as a pre-start task to ensure the directories and files are created before the agent or dev container is started with the correct permissions

# fail immediately if anything fails
set -e

OWNER="${USER_ID:-agent}"

# create the necessary ephemeral directories
mkdir -p "${CUSTOMER_APP_DIR}/public/assets"

# create the necessary persistent Ceph directories
mkdir -p "${CEPH_STORAGE_DIR}/agent"
mkdir -p "${CEPH_STORAGE_DIR}/git-repo"
mkdir -p "${CEPH_STORAGE_DIR}/preview/assets/public"
mkdir -p "${CEPH_STORAGE_DIR}/preview/assets/private"
mkdir -p "${CEPH_STORAGE_DIR}/publish/dist"
mkdir -p "${CEPH_STORAGE_DIR}/publish/assets/public"
mkdir -p "${CEPH_STORAGE_DIR}/publish/assets/private"

# set ownership of all directories
chown -R "$OWNER" "${CUSTOMER_APP_DIR}"
chown -R "$OWNER" "${CEPH_STORAGE_DIR}/agent"
chown -R "$OWNER" "${CEPH_STORAGE_DIR}/git-repo"
chown -R "$OWNER" "${CEPH_STORAGE_DIR}/preview"
chown -R "$OWNER" "${CEPH_STORAGE_DIR}/publish"
