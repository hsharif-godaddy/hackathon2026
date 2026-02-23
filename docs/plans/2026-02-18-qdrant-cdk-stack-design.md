# Qdrant CDK Stack Design

**Date:** 2026-02-18
**Status:** Approved
**Author:** Claude + jeichorn

## Overview

Deploy a 3-node Qdrant vector database cluster on AWS ECS Fargate for AI/Agent embeddings storage. VPC-internal access only via Service Discovery.

## Requirements

- **Use case**: AI/Agent embeddings storage (RAG, semantic search, agent memory)
- **Cluster size**: 3 nodes (single shard, 3 replicas for Raft quorum)
- **Access**: VPC-internal only via Service Discovery
- **Docker**: Custom image with cluster bootstrap entrypoint
- **Environments**: Dev and prod only (matches MySQL pattern)
- **Snapshots**: Not in initial scope (can add later)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         VPC                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │     AZ-1     │  │     AZ-2     │  │     AZ-3     │      │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │      │
│  │ │ Qdrant   │ │  │ │ Qdrant   │ │  │ │ Qdrant   │ │      │
│  │ │ Node 1   │ │  │ │ Node 2   │ │  │ │ Node 3   │ │      │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                            │                                 │
│              ┌─────────────┴─────────────┐                  │
│              │    ECS Service Discovery   │                  │
│              │  qdrant.{env}.airo.local   │                  │
│              └───────────────────────────┘                  │
│                            │                                 │
│              ┌─────────────┴─────────────┐                  │
│              │      EFS (snapshots)       │                  │
│              └───────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

**New files:**

```
cdk/
├── lib/
│   └── qdrant-stack.ts           # Main CDK stack
├── docker/
│   └── qdrant/
│       ├── Dockerfile            # Custom Qdrant build
│       └── cluster-entrypoint.sh # Bootstrap/join logic
```

**Modified files:**

- `cdk/lib/config.ts` - Add `qdrant` config block
- `cdk/app/main.ts` - Add `QdrantStack` instantiation

## Configuration

Add to `cdk/lib/config.ts`:

```typescript
interface Config {
  // ... existing fields ...
  qdrant: {
    nodeCount: number;
    cpu: number;
    memory: number;
    ephemeralStorageGiB: number;
    imageTag: string;
  };
}

// Dev config
qdrant: {
  nodeCount: 3,
  cpu: 1024,        // 1 vCPU
  memory: 2048,     // 2 GB
  ephemeralStorageGiB: 30,
  imageTag: 'latest',
}

// Prod config
qdrant: {
  nodeCount: 3,
  cpu: 2048,        // 2 vCPU
  memory: 4096,     // 4 GB
  ephemeralStorageGiB: 50,
  imageTag: 'latest',
}
```

## Stack Components

### Security Group

- Ingress: VPC CIDR on port 6333 (REST API)
- Ingress: Self-referencing on ports 6334 (gRPC), 6335 (Raft)
- Egress: Self-referencing on ports 6334, 6335
- Egress: HTTPS (443) for ECR pulls

### EFS

- Encrypted filesystem for future snapshot capability
- Access point with UID/GID 1000 (Qdrant user)
- 30-day lifecycle policy to Infrequent Access
- RETAIN removal policy

### ECS

- Dedicated cluster: `{env}-qdrant`
- Fargate service with 3 tasks
- ARM64 architecture
- Container Insights enabled
- ECS Exec enabled for debugging
- Circuit breaker with rollback

### Service Discovery

- Private DNS namespace: `{env}.airo.local`
- Service name: `qdrant`
- A record with 10-second TTL
- Endpoint: `qdrant.{env}.airo.local:6333`

### Secrets

- Secrets Manager secret for API key
- Auto-generated with safe characters

### ECR

- Repository: `{env}-qdrant`
- Image scanning on push
- RETAIN removal policy

## Docker Setup

### Dockerfile

Uses official Qdrant image as base, adds entrypoint script:

```dockerfile
FROM qdrant/qdrant:v1.13.2

USER root
RUN apt-get update && apt-get install -y --no-install-recommends dnsutils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY cluster-entrypoint.sh /qdrant/cluster-entrypoint.sh
RUN chmod +x /qdrant/cluster-entrypoint.sh

USER 1000:1000
WORKDIR /qdrant

EXPOSE 6333 6334 6335

ENTRYPOINT ["/qdrant/cluster-entrypoint.sh"]
```

### Entrypoint Script

Handles cluster bootstrap vs join:

- DNS lookup for cluster FQDN
- No records → `--bootstrap` (first node creates cluster)
- Records exist → `--uri` (join existing cluster)

## Stack Integration

### main.ts

```typescript
// Add unconditionally - stack handles env filtering internally
new QdrantStack(app, "QdrantStack", { env });
```

### QdrantStack

```typescript
export class QdrantStack extends GDStack {
  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Only create resources for dev and prod
    if (!["dev", "prod"].includes(config.envName)) {
      return;
    }

    // ... create resources
  }
}
```

## Outputs

| Output                | Value                     | Export Name                |
| --------------------- | ------------------------- | -------------------------- |
| QdrantEndpoint        | `qdrant.{env}.airo.local` | `{env}-qdrant-endpoint`    |
| QdrantApiKeySecretArn | Secret ARN                | `{env}-qdrant-api-key-arn` |
| QdrantEcrRepository   | Repository URI            | `{env}-qdrant-ecr-uri`     |

## Client Usage

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({
  url: "http://qdrant.dev.airo.local:6333",
  apiKey: process.env.QDRANT_API_KEY,
});
```

## Future Phases

1. **Dockerfile security hardening** - Meet GoDaddy security standards
2. **Snapshot Lambda** - Automated backups to S3 with lifecycle policies
3. **Monitoring integration** - Add Qdrant alarms to MonitoringStack
4. **ALB access** - Dashboard access for debugging if needed

## Reference

Based on guide: [Qdrant Vector Database Cluster on AWS ECS Fargate](https://dev.to/seetamraju/vector-database-qdrant-cluster-on-ecs-fargate-2jak)

## Ports Reference

| Port | Purpose                    |
| ---- | -------------------------- |
| 6333 | REST API & Dashboard       |
| 6334 | gRPC API                   |
| 6335 | Cluster/Raft communication |
