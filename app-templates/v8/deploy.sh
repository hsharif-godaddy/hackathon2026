#!/bin/bash

# Deploy script for Airo AI Apps Docker image
# This script builds and pushes the apps Docker image to ECR

set -e  # Exit on any error

NOMAD_SPEC_IMAGE_VERSION=${NOMAD_SPEC_IMAGE_VERSION:-pre-dev-v1.0.0}

DEV_SUPERVISOR_IMAGE="${DEV_SUPERVISOR_IMAGE:-dev-supervisor:latest}"
# Configuration
REGION="eu-central-1"
ACCOUNT_ID="418549769352"
ECR_REPOSITORY="airo-builder/apps"
IMAGE_TAG=${NOMAD_SPEC_IMAGE_VERSION}
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"

echo "🚀 Starting deployment of Airo V8 Apps..."
echo "📦 Repository: ${ECR_URI}"
echo "🏷️  Tag: ${IMAGE_TAG}"
echo "🔍 Dev Supervisor Image: ${DEV_SUPERVISOR_IMAGE}"

# Step 1: Assume the deploy role
echo ""
echo "🔐 Assuming AWS deploy role..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "Current account: ${AWS_ACCOUNT_ID}"
echo "Assuming GD-AWS-SSG-Deploy-Role..."

export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" \
$(aws sts assume-role \
--role-arn arn:aws:iam::${AWS_ACCOUNT_ID}:role/GD-AWS-SSG-Deploy-Role \
--role-session-name CLISession \
--query "Credentials.[AccessKeyId,SecretAccessKey,SessionToken]" \
--output text))

# Verify the assumed role
echo "✅ Successfully assumed role:"
AWS_PAGER="" aws sts get-caller-identity --output table

# Step 2: Login to ECR to download the base image
echo ""
echo "🔑 Logging into ECR..."
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 764525110978.dkr.ecr.us-west-2.amazonaws.com

echo "✅ Successfully logged into ECR"

# Step 3: Build the Docker image
echo ""
echo "🏗️  Building Docker image..."
echo "Platform: linux/amd64"
echo "Context: $(pwd)"

docker buildx build --platform linux/amd64 --build-arg DEV_SUPERVISOR_IMAGE="$DEV_SUPERVISOR_IMAGE" -t airo-apps:${IMAGE_TAG} .

echo "✅ Successfully built Docker image: airo-apps:${IMAGE_TAG}"

# Step 4: Login to ECR to push the built image
echo ""
echo "🔑 Logging into ECR..."
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

echo "✅ Successfully logged into ECR"

# Step 5: Tag the image for ECR
echo ""
echo "🏷️  Tagging image for ECR..."
docker tag airo-apps:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

echo "✅ Successfully tagged image: ${ECR_URI}:${IMAGE_TAG}"

# Step 6: Push to ECR
echo ""
echo "📤 Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}

echo ""
echo "🎉 Deployment completed successfully!"
echo "📦 Image available at: ${ECR_URI}:${IMAGE_TAG}"
echo ""
echo "You can now use this image in your Nomad job definitions or other deployment configs."
