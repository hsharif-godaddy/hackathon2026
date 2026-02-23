# Qdrant Vector Database Stack

Production-ready 3-node Qdrant vector database cluster on AWS ECS Fargate.

## Overview

| Property     | Value                                  |
| ------------ | -------------------------------------- |
| Stack Name   | `QdrantVectorDbStack`                  |
| Environments | `dev`, `prod` (not deployed to `test`) |
| Source       | `cdk/lib/qdrant-stack.ts`              |
| Docker       | `cdk/docker/qdrant/`                   |

## Architecture

```
                                    ┌─────────────────────────────────────────────────────────┐
                                    │                        VPC                              │
                                    │                                                         │
┌──────────────┐                    │  ┌─────────────────────────────────────────────────┐   │
│   Clients    │                    │  │              Private Subnets (dxApp)             │   │
│  (VPC Only)  │────────────────────┼──│                                                  │   │
└──────────────┘                    │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐│   │
       │                            │  │  │  Qdrant #1  │ │  Qdrant #2  │ │  Qdrant #3  ││   │
       │ REST :6333                 │  │  │   (ARM64)   │ │   (ARM64)   │ │   (ARM64)   ││   │
       │ gRPC :6334                 │  │  │             │ │             │ │             ││   │
       ▼                            │  │  │  :6333 REST │ │  :6333 REST │ │  :6333 REST ││   │
┌──────────────┐                    │  │  │  :6334 gRPC │ │  :6334 gRPC │ │  :6334 gRPC ││   │
│   Service    │                    │  │  │  :6335 Raft │ │  :6335 Raft │ │  :6335 Raft ││   │
│  Discovery   │◄───────────────────┼──│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘│   │
│              │                    │  │         │               │               │       │   │
│ qdrant.{env} │                    │  │         └───────────────┼───────────────┘       │   │
│ .airo.local  │                    │  │                  Raft Consensus                 │   │
└──────────────┘                    │  │                    (port 6335)                  │   │
                                    │  └─────────────────────────────────────────────────┘   │
                                    │                                                         │
                                    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
                                    │  │     EFS      │  │   Secrets    │  │     ECR      │  │
                                    │  │  (Snapshots) │  │   Manager    │  │  (Image)     │  │
                                    │  │              │  │  (API Key)   │  │              │  │
                                    │  └──────────────┘  └──────────────┘  └──────────────┘  │
                                    └─────────────────────────────────────────────────────────┘
```

## Components

### ECS Fargate Service

- **Cluster**: `{env}-qdrant`
- **Service**: `{env}-qdrant-service`
- **Task Definition**: ARM64 Linux, configurable CPU/memory
- **Desired Count**: 3 nodes (minimum for Raft quorum)
- **Rolling Updates**: `minHealthyPercent: 67` (maintains 2/3 quorum)

### Service Discovery

- **Namespace**: `{env}.airo.local` (Private DNS)
- **Service**: `qdrant.{env}.airo.local`
- **DNS TTL**: 30 seconds
- **Record Type**: A records (one per healthy task)

### Storage

- **Ephemeral**: 30GB (dev) / 50GB (prod) per task for Qdrant data
- **EFS**: Shared filesystem mounted at `/qdrant/snapshots`
- **Persistence Strategy**: Raft replication across nodes + periodic snapshots to EFS

### Security

- **Security Group**: VPC-internal only, no public access
- **API Key**: Auto-generated 32-char key in Secrets Manager
- **Encryption**: EFS encrypted at rest, transit encryption enabled

## Configuration

### Environment Config (`cdk/lib/config.ts`)

| Parameter             | Dev    | Prod   | Description                       |
| --------------------- | ------ | ------ | --------------------------------- |
| `nodeCount`           | 3      | 3      | Number of Qdrant nodes            |
| `cpu`                 | 1024   | 2048   | Fargate CPU units (1024 = 1 vCPU) |
| `memory`              | 2048   | 4096   | Memory in MiB                     |
| `ephemeralStorageGiB` | 30     | 50     | Ephemeral storage per task        |
| `imageTag`            | latest | latest | Docker image tag                  |

### Ports

| Port | Protocol | Purpose                           |
| ---- | -------- | --------------------------------- |
| 6333 | TCP      | REST API & Web Dashboard          |
| 6334 | TCP      | gRPC API                          |
| 6335 | TCP      | Raft consensus (cluster-internal) |

## Deployment

### Prerequisites

1. AWS credentials configured for target account
2. Docker image pushed to ECR (see below)

### Step 1: Build and Push Docker Image

**Option A: GitHub Actions (Recommended)**

```bash
# Manually trigger workflow
gh workflow run docker-build-qdrant.yml -f environment=dev -f image_tag=latest

# Or for prod
gh workflow run docker-build-qdrant.yml -f environment=prod -f image_tag=v1.0.0
```

**Option B: Local Build**

```bash
# Login to GCI ECR (for base image)
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 764525110978.dkr.ecr.us-west-2.amazonaws.com

# Login to target ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 694282668781.dkr.ecr.us-west-2.amazonaws.com

# Build and push
cd cdk/docker/qdrant
docker build --platform linux/arm64 -t qdrant:latest .
docker tag qdrant:latest 694282668781.dkr.ecr.us-west-2.amazonaws.com/dev-qdrant:latest
docker push 694282668781.dkr.ecr.us-west-2.amazonaws.com/dev-qdrant:latest
```

### Step 2: Deploy CDK Stack

**Option A: GitHub Actions (Recommended)**

The CDK workflow handles Artifactory authentication automatically:

```bash
# Deploy to dev
gh workflow run cdk.yml -f ENV_NAME=dev -f STACK_NAME=QdrantVectorDbStack -f DEFAULT_ACTION=deploy

# Deploy to prod
gh workflow run cdk.yml -f ENV_NAME=prod -f STACK_NAME=QdrantVectorDbStack -f DEFAULT_ACTION=deploy

# Check diff first (no deploy)
gh workflow run cdk.yml -f ENV_NAME=dev -f STACK_NAME=QdrantVectorDbStack -f DEFAULT_ACTION=diff

# Watch workflow progress
gh run watch
```

**Option B: Local Deploy**

> **Note**: Local CDK deploy requires Artifactory authentication because CDK synthesizes ALL stacks, and `GocaasSpendLambdaStack` uses Docker bundling that needs npm auth for `@godaddy/*` packages.

```bash
cd cdk

# 1. Get an Artifactory token (ask teammate or use JFrog CLI)
# 2. Create .npmrc for the lambda that needs it
cat > lambda/gocode-spend-essp-exporter/.npmrc << EOF
always-auth=true
@godaddy:registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/
//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=YOUR_TOKEN_HERE
EOF

# 3. Deploy
ENV_NAME=dev npx cdk deploy QdrantVectorDbStack
```

### Step 3: Verify Deployment

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster dev-qdrant \
  --services dev-qdrant-service \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'

# Test health endpoint (from within VPC)
curl http://qdrant.dev.airo.local:6333/healthz

# Check cluster status
curl http://qdrant.dev.airo.local:6333/cluster
```

## Operations

### Health Checks

```bash
# Kubernetes-style health endpoints (no auth required)
curl http://qdrant.{env}.airo.local:6333/healthz  # Overall health
curl http://qdrant.{env}.airo.local:6333/livez    # Liveness
curl http://qdrant.{env}.airo.local:6333/readyz   # Readiness

# Cluster status (requires API key)
curl -H "api-key: $QDRANT_API_KEY" http://qdrant.{env}.airo.local:6333/cluster
```

### Retrieve API Key

```bash
# Get API key from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id dev-qdrant-api-key \
  --query SecretString \
  --output text
```

### Local Access (Port Forwarding)

Use the provided script to access Qdrant locally via SSM port forwarding:

```bash
# Forward dev Qdrant to localhost:6333
./cdk/scripts/qdrant-port-forward.sh dev 6333

# Then access:
#   Web UI:   http://localhost:6333
#   REST API: http://localhost:6333/collections
```

Requires AWS CLI v2 and [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).

### ECS Exec (Shell Access)

```bash
# List tasks
aws ecs list-tasks --cluster dev-qdrant --service-name dev-qdrant-service

# Exec into container
aws ecs execute-command \
  --cluster dev-qdrant \
  --task <task-id> \
  --container qdrant \
  --interactive \
  --command "/bin/bash"
```

### Create Snapshot

```bash
# Create snapshot of all collections (saved to EFS)
curl -X POST -H "api-key: $QDRANT_API_KEY" \
  http://qdrant.{env}.airo.local:6333/snapshots
```

### Scaling

```bash
# Scale to 5 nodes (update config.ts first, then deploy)
# Note: Always use odd numbers for Raft quorum (3, 5, 7)

# Or quick scale via AWS CLI (temporary, will revert on next deploy)
aws ecs update-service \
  --cluster dev-qdrant \
  --service dev-qdrant-service \
  --desired-count 5
```

## Troubleshooting

### Cluster Not Forming

1. **Check DNS resolution**:

   ```bash
   dig qdrant.dev.airo.local
   ```

   Should return 3 A records (one per task)

2. **Check security group egress**:

   - Ensure DNS (UDP/TCP 53) egress to VPC CIDR
   - Ensure port 6335 egress to security group (self)

3. **Check container logs**:
   ```bash
   aws logs tail /ecs/dev-qdrant --follow
   ```

### Task Failing to Start

1. **Check ECR image exists**:

   ```bash
   aws ecr describe-images --repository-name dev-qdrant
   ```

2. **Check task stopped reason**:
   ```bash
   aws ecs describe-tasks --cluster dev-qdrant --tasks <task-arn> \
     --query 'tasks[0].stoppedReason'
   ```

### High Memory Usage

Qdrant stores vectors in memory. If running out of memory:

1. Increase `memory` in config.ts
2. Enable on-disk storage for large collections
3. Consider adding more nodes to distribute data

## Security

### Network Access

- **Ingress**: VPC CIDR only (ports 6333, 6334)
- **No public access**: `assignPublicIp: false`
- **Internal cluster traffic**: Security group self-reference (ports 6334, 6335)

### Authentication

- API key required for all data operations
- Health endpoints (`/healthz`, `/livez`, `/readyz`) are unauthenticated
- API key stored in Secrets Manager with auto-generated 32-char password

### Golden Container Image

Base image uses GoDaddy-approved golden container:

- Registry: `764525110978.dkr.ecr.us-west-2.amazonaws.com/debian:bookworm-slim`
- Check GCI metadata for deprecation dates:
  ```bash
  aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | \
    jq '.[] | select(.imageUri | contains("debian"))'
  ```

## Stack Outputs

| Output                  | Export Name                | Description                                  |
| ----------------------- | -------------------------- | -------------------------------------------- |
| `QdrantEndpoint`        | `{env}-qdrant-endpoint`    | DNS endpoint (e.g., `qdrant.dev.airo.local`) |
| `QdrantApiKeySecretArn` | `{env}-qdrant-api-key-arn` | Secrets Manager ARN for API key              |
| `QdrantEcrRepository`   | `{env}-qdrant-ecr-uri`     | ECR repository URI                           |
| `QdrantEfsFileSystemId` | `{env}-qdrant-efs-id`      | EFS filesystem ID                            |

## Related Files

- Stack: `cdk/lib/qdrant-stack.ts`
- Config: `cdk/lib/config.ts` (QdrantConfig interface)
- Dockerfile: `cdk/docker/qdrant/Dockerfile`
- Entrypoint: `cdk/docker/qdrant/cluster-entrypoint.sh`
- CI/CD: `.github/workflows/docker-build-qdrant.yml`
- Port Forward Script: `cdk/scripts/qdrant-port-forward.sh`
