#!/bin/sh

# This script is used to initialize the directories and files required for both the agent and the dev container
# It is run as the root user as a pre-start task to ensure the directories and files are created before the agent or dev container is started with the correct permissions

# fail immediately if anything fails
set -e

# create the customer app directory
mkdir -p "${CUSTOMER_APP_DIR}"

# create the .is_ready file, so that the dev container can wait for it to appear
touch "${CUSTOMER_APP_DIR}"/.is_ready

# set ownership
chown -R agent:agent "${CUSTOMER_APP_DIR}"

ls -latr "${CUSTOMER_APP_DIR}"

echo '✅ Directories created and set permissions'

# create the git repo directory in the ceph storage
mkdir -p "${CEPH_STORAGE_DIR}/git-repo"

# set ownership
chown -R agent:agent "${CEPH_STORAGE_DIR}"

ls -latr "${CEPH_STORAGE_DIR}"

echo '✅ Git repo directory created in the ceph storage and set permissions'

# execute the provided arguments
exec $@
