#!/bin/bash

# set -e

# DRY_RUN=false
# if [ "$1" = "--dry-run" ] || [ "$1" = "-n" ]; then
#   DRY_RUN=true
#   echo "DRY RUN MODE - Build only, no push to ECR"
#   echo ""
# fi

# SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# cd "$WORKSPACE_ROOT"

# echo "Workspace root: $WORKSPACE_ROOT"

# NOMAD_SPEC_IMAGE_VERSION=${NOMAD_SPEC_IMAGE_VERSION:-pre-dev-v1.0.0}

# REGION="eu-central-1"
# ACCOUNT_ID="418549769352"
# ECR_REPOSITORY="airo-builder/agents"
# IMAGE_TAG=${NOMAD_SPEC_IMAGE_VERSION}
# ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"

# echo "Starting deployment of Airo AI Agents..."
# echo "Repository: ${ECR_URI}"
# echo "Tag: ${IMAGE_TAG}"

# if [ "$DRY_RUN" = false ]; then
#   echo ""
#   echo "Assuming AWS deploy role..."
#   AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

#   echo "Current account: ${AWS_ACCOUNT_ID}"
#   echo "Assuming GD-AWS-SSG-Deploy-Role..."

#   export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" \
#     $(aws sts assume-role \
#       --role-arn arn:aws:iam::${AWS_ACCOUNT_ID}:role/GD-AWS-SSG-Deploy-Role \
#       --role-session-name CLISession \
#       --query "Credentials.[AccessKeyId,SecretAccessKey,SessionToken]" \
#       --output text))

#   echo "Successfully assumed role:"
#   AWS_PAGER="" aws sts get-caller-identity --output table

#   echo ""
#   echo "Logging into target ECR (${REGION})..."
#   aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
# fi

# echo ""
# echo "Logging into ECR for base image (us-west-2)..."
# aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 764525110978.dkr.ecr.us-west-2.amazonaws.com

# echo ""
# echo "Loading Artifactory NPM token from .env file..."

# if [ -f "agents/.env" ]; then
#   export $(grep -v '^#' agents/.env | grep -E '(ARTIFACTORY_NPM_TOKEN|NPM_AUTH_TOKEN)' | xargs)
# elif [ -f ".env" ]; then
#   export $(grep -v '^#' .env | grep -E '(ARTIFACTORY_NPM_TOKEN|NPM_AUTH_TOKEN)' | xargs)
# else
#   echo "Error: .env file not found in agents/ or root directory"
#   echo "Create agents/.env with: ARTIFACTORY_NPM_TOKEN=your-token or NPM_AUTH_TOKEN=your-token"
#   exit 1
# fi

# if [ -z "$ARTIFACTORY_NPM_TOKEN" ]; then
#   if [ -n "$NPM_AUTH_TOKEN" ]; then
#     export ARTIFACTORY_NPM_TOKEN="$NPM_AUTH_TOKEN"
#     echo "Using NPM_AUTH_TOKEN as ARTIFACTORY_NPM_TOKEN"
#   else
#     echo "Error: Neither ARTIFACTORY_NPM_TOKEN nor NPM_AUTH_TOKEN found in .env file"
#     echo "Add ARTIFACTORY_NPM_TOKEN=your-token or NPM_AUTH_TOKEN=your-token to agents/.env"
#     exit 1
#   fi
# fi

# echo "Artifactory NPM token loaded successfully"

# echo ""
# echo "Building Docker image..."
# echo "Platform: linux/amd64"
# echo "Context: workspace root"
# echo "Dockerfile: agents/Dockerfile"

# docker buildx build \
#   --platform linux/amd64 \
#   -f agents/Dockerfile \
#   --secret id=npm_token,env=ARTIFACTORY_NPM_TOKEN \
#   -t airo-agents:${IMAGE_TAG} \
#   .

# echo "Successfully built Docker image: airo-agents:${IMAGE_TAG}"

# if [ "$DRY_RUN" = true ]; then
#   echo ""
#   echo "DRY RUN - Skipping ECR push"
#   echo "Local image built: airo-agents:${IMAGE_TAG}"
#   echo ""
#   echo "To test the image locally:"
#   echo "  docker run --rm airo-agents:${IMAGE_TAG}"
# else
#   echo ""
#   echo "Tagging image for ECR..."
#   docker tag airo-agents:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

#   echo "Successfully tagged image: ${ECR_URI}:${IMAGE_TAG}"

#   echo ""
#   echo "Pushing image to ECR..."
#   docker push ${ECR_URI}:${IMAGE_TAG}

#   echo ""
#   echo "Deployment completed successfully"
#   echo "Image available at: ${ECR_URI}:${IMAGE_TAG}"
# fi

echo "Do not use this script anymore, use the GHA in pioneer-infra instead:"
echo "https://github.com/gdcorp-commerce/pioneer-infra/actions/workflows/docker-airo-app-builder-agent.yml"
echo ""
echo "If you need to make changes to the Dockerfile, it is located at:"
echo "https://github.com/gdcorp-commerce/pioneer-infra/tree/main/docker/airo-app-builder-agent"
