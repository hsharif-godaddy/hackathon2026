#!/bin/sh

# fail immediately if anything fails
set -e

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"

# create ~/.aws directory
mkdir -p ~/.aws

# create the .aws/config file, required for the agent to be able to access the gocode
echo -e "[profile ${GOCODE_AWS_PROFILE}]\nrole_arn=${GOCODE_AWS_ROLE_ARN}\nsource_profile=default\nregion=${GOCODE_AWS_REGION}" > ~/.aws/config

# wait for dev-supervisor socket to be available
SOCKET_PATH="${DEV_SUPERVISOR_SOCKET_PATH:-$NOMAD_ALLOC_DIR/tmp/$SITE_ID-dev-supervisor.sock}"
echo "Waiting for dev-supervisor socket at ${SOCKET_PATH}..."
while [ ! -S "$SOCKET_PATH" ]; do
    sleep 1
done
echo "Dev-supervisor socket is available"

# run the app
exec $@
