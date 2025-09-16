#!/bin/sh

# fail immediately if anything fails
set -e

# add the customer app directory to the git safe directory
git config --global --add safe.directory "${CUSTOMER_APP_DIR}"

# create ~/.aws directory
mkdir -p ~/.aws

# create the .aws/config file, required for the agent to be able to access the bedrock
echo -e "[profile ${BEDROCK_AWS_PROFILE}]\nrole_arn=${BEDROCK_AWS_ROLE_ARN}\nsource_profile=default\nregion=${BEDROCK_AWS_REGION}" > ~/.aws/config

# run the app
exec $@
