#!/bin/bash

# Deploy script for Airo AI Agents Docker image
# This script builds and pushes the agents Docker image to ECR

set -e  # Exit on any error

# Configuration
REGION="eu-central-1"
ACCOUNT_ID="418549769352"
ECR_REPOSITORY="airo-builder/agents"
IMAGE_TAG="latest"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"

echo "🚀 Starting deployment of Airo AI Agents..."
echo "📦 Repository: ${ECR_URI}"
echo "🏷️  Tag: ${IMAGE_TAG}"

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

# Step 3: Load NPM auth token from .env
echo ""
echo "🔐 Loading NPM authentication from .env file..."

# Load environment variables from .env file
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | grep NPM_AUTH_TOKEN | xargs)
else
  echo "❌ .env file not found"
  echo "💡 Create .env file with: NPM_AUTH_TOKEN=your-jwt-token"
  exit 1
fi

# Verify token is loaded
if [ -z "$NPM_AUTH_TOKEN" ]; then
  echo "❌ NPM_AUTH_TOKEN not found in .env file"
  echo "💡 Add NPM_AUTH_TOKEN=your-jwt-token to .env file"
  echo "💡 Get token from: https://gdartifactory1.jfrog.io/ → Profile → Generate Access Token"
  exit 1
fi

echo "✅ NPM auth token loaded successfully"

# Step 4: Build the Docker image
echo ""
echo "🏗️  Building Docker image..."
echo "Platform: linux/amd64"
echo "Context: $(pwd)"
echo "Using NPM auth token as build argument (secure - not stored in image)"

docker buildx build --platform linux/amd64 --build-arg NPM_AUTH_TOKEN="$NPM_AUTH_TOKEN" -t airo-agents:${IMAGE_TAG} .

echo "✅ Successfully built Docker image: airo-agents:${IMAGE_TAG}"

# Step 5: Tag the image for ECR
echo ""
echo "🏷️  Tagging image for ECR..."
docker tag airo-agents:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

echo "✅ Successfully tagged image: ${ECR_URI}:${IMAGE_TAG}"

# Step 2: Login to ECR
echo ""
echo "🔑 Logging into ECR..."
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

echo "✅ Successfully logged into ECR"

# Step 6: Push to ECR
echo ""
echo "📤 Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}

echo ""
echo "🎉 Deployment completed successfully!"
echo "📦 Image available at: ${ECR_URI}:${IMAGE_TAG}"
echo ""
echo "You can now use this image in your Nomad job definitions or other deployment configs."
