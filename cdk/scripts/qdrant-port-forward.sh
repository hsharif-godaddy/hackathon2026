#!/bin/bash
#
# Qdrant Port Forwarding Script
#
# Sets up SSM port forwarding to access the Qdrant web interface locally.
# Requires AWS CLI v2 and Session Manager plugin installed.
#
# Usage:
#   ./qdrant-port-forward.sh [environment] [local-port]
#
# Examples:
#   ./qdrant-port-forward.sh dev 6333      # Forward dev Qdrant to localhost:6333
#   ./qdrant-port-forward.sh prod 6334     # Forward prod Qdrant to localhost:6334
#
# After running, access Qdrant at: http://localhost:<local-port>
#

set -e

# Configuration
ENV_NAME="${1:-dev}"
LOCAL_PORT="${2:-6333}"
REMOTE_PORT="6333"
CLUSTER_NAME="${ENV_NAME}-qdrant"
SERVICE_NAME="${ENV_NAME}-qdrant-service"
REGION="us-west-2"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Qdrant Port Forwarding${NC}"
echo "Environment: ${ENV_NAME}"
echo "Cluster: ${CLUSTER_NAME}"
echo "Service: ${SERVICE_NAME}"
echo ""

# Check prerequisites
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

if ! command -v session-manager-plugin &> /dev/null; then
    echo -e "${RED}Error: AWS Session Manager plugin is not installed${NC}"
    echo "Install it from: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
    exit 1
fi

# Get running tasks
echo -e "${YELLOW}Finding running tasks...${NC}"
TASK_ARNS=$(aws ecs list-tasks \
    --cluster "${CLUSTER_NAME}" \
    --service-name "${SERVICE_NAME}" \
    --desired-status RUNNING \
    --region "${REGION}" \
    --query 'taskArns[]' \
    --output text)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to list tasks. Check AWS credentials and cluster/service names.${NC}"
    exit 1
fi

if [ -z "$TASK_ARNS" ]; then
    echo -e "${RED}Error: No running tasks found for service ${SERVICE_NAME}${NC}"
    echo ""
    echo "Possible reasons:"
    echo "  - The stack hasn't been deployed yet"
    echo "  - The service is still starting up"
    echo "  - The tasks are failing health checks"
    echo ""
    echo "Check service status:"
    echo "  aws ecs describe-services --cluster ${CLUSTER_NAME} --services ${SERVICE_NAME} --region ${REGION}"
    exit 1
fi

# Convert to array and pick first task
TASK_ARN=$(echo "$TASK_ARNS" | awk '{print $1}')
TASK_ID=$(echo "$TASK_ARN" | awk -F'/' '{print $NF}')

echo -e "${GREEN}Found task: ${TASK_ID}${NC}"
echo ""

# Get task details for the runtime ID
echo -e "${YELLOW}Getting task details...${NC}"
TASK_DETAILS=$(aws ecs describe-tasks \
    --cluster "${CLUSTER_NAME}" \
    --tasks "${TASK_ARN}" \
    --region "${REGION}" \
    --query 'tasks[0]' \
    --output json)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to describe task ${TASK_ARN}${NC}"
    exit 1
fi

RUNTIME_ID=$(echo "$TASK_DETAILS" | jq -r '.containers[0].runtimeId')

if [ -z "$RUNTIME_ID" ] || [ "$RUNTIME_ID" == "null" ]; then
    echo -e "${RED}Error: Could not get runtime ID for task${NC}"
    exit 1
fi

# Build the SSM target
# Format: ecs:<cluster>_<task-id>_<runtime-id>
SSM_TARGET="ecs:${CLUSTER_NAME}_${TASK_ID}_${RUNTIME_ID}"

echo -e "${GREEN}SSM Target: ${SSM_TARGET}${NC}"
echo ""
echo -e "${YELLOW}Starting port forwarding...${NC}"
echo ""
echo "=============================================="
echo -e "${GREEN}Qdrant will be available at:${NC}"
echo -e "${GREEN}  Web UI:  http://localhost:${LOCAL_PORT}${NC}"
echo -e "${GREEN}  REST API: http://localhost:${LOCAL_PORT}/collections${NC}"
echo "=============================================="
echo ""
echo "Press Ctrl+C to stop port forwarding"
echo ""

# Start port forwarding
aws ssm start-session \
    --target "${SSM_TARGET}" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"localhost\"],\"portNumber\":[\"${REMOTE_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}" \
    --region "${REGION}"
