# Qdrant CDK Stack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a 3-node Qdrant vector database cluster on AWS ECS Fargate for AI/Agent embeddings storage.

**Architecture:** New `QdrantStack` CDK stack following existing patterns (GDStack, env-based config). ECS Fargate service with Service Discovery for VPC-internal access, EFS for future snapshots.

**Tech Stack:** AWS CDK v2, TypeScript, @gd-safeguard/godaddy-constructs, Docker, ECS Fargate, EFS, Service Discovery

**Design Doc:** `docs/plans/2026-02-18-qdrant-cdk-stack-design.md`

---

## Task 1: Add Qdrant Configuration

**Files:**

- Modify: `cdk/lib/config.ts`

**Step 1: Add QdrantConfig interface**

Add after line 30 (after MonitoringConfig interface):

```typescript
/**
 * Qdrant cluster configuration
 */
interface QdrantConfig {
  /** Number of Qdrant nodes (3 minimum for Raft quorum) */
  nodeCount: number;
  /** Fargate CPU units per task (1024 = 1 vCPU) */
  cpu: number;
  /** Fargate memory in MiB per task */
  memory: number;
  /** Ephemeral storage in GiB (for Qdrant data) */
  ephemeralStorageGiB: number;
  /** Docker image tag to deploy */
  imageTag: string;
}
```

**Step 2: Add qdrant field to Config interface**

Add to the Config interface (around line 49):

```typescript
qdrant: QdrantConfig;
```

**Step 3: Add dev config values**

Add to devConfig (after jwt block, around line 107):

```typescript
  qdrant: {
    nodeCount: 3,
    cpu: 1024,
    memory: 2048,
    ephemeralStorageGiB: 30,
    imageTag: 'latest',
  },
```

**Step 4: Add test config values**

Add to testConfig (after jwt block, around line 146):

```typescript
  qdrant: {
    nodeCount: 3,
    cpu: 1024,
    memory: 2048,
    ephemeralStorageGiB: 30,
    imageTag: 'latest',
  },
```

**Step 5: Add prod config values**

Add to prodConfig (after jwt block, around line 186):

```typescript
  qdrant: {
    nodeCount: 3,
    cpu: 2048,
    memory: 4096,
    ephemeralStorageGiB: 50,
    imageTag: 'latest',
  },
```

**Step 6: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 7: Commit**

```bash
git add cdk/lib/config.ts
git commit -m "feat(cdk): add Qdrant cluster configuration"
```

---

## Task 2: Create Docker Entrypoint Script

**Files:**

- Create: `cdk/docker/qdrant/cluster-entrypoint.sh`

**Step 1: Create docker directory**

```bash
mkdir -p cdk/docker/qdrant
```

**Step 2: Create entrypoint script**

```bash
#!/bin/bash
set -e

# Cluster FQDN from environment (set by CDK)
QDRANT_CLUSTER_FQDN="${QDRANT_CLUSTER_FQDN:-qdrant.dev.airo.local}"

echo "============================================"
echo "Qdrant Cluster Entrypoint"
echo "Cluster FQDN: ${QDRANT_CLUSTER_FQDN}"
echo "============================================"

echo "Performing DNS lookup for ${QDRANT_CLUSTER_FQDN}..."

if DNS_RESULT=$(dig +short "$QDRANT_CLUSTER_FQDN" A 2>/dev/null) && [ -n "$DNS_RESULT" ]; then
    RECORD_COUNT=$(echo "$DNS_RESULT" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' 2>/dev/null || echo 0)

    if [ "$RECORD_COUNT" -eq 0 ]; then
        echo "No valid IP records found."
        echo "Bootstrapping NEW Qdrant cluster..."
        exec ./qdrant --bootstrap "http://${QDRANT_CLUSTER_FQDN}:6335"
    else
        echo "Found ${RECORD_COUNT} DNS record(s)."
        echo "Joining EXISTING cluster..."
        exec ./qdrant --uri "http://${QDRANT_CLUSTER_FQDN}:6335"
    fi
else
    echo "DNS lookup failed or returned empty result."
    echo "Bootstrapping NEW Qdrant cluster..."
    exec ./qdrant --bootstrap "http://${QDRANT_CLUSTER_FQDN}:6335"
fi
```

**Step 3: Commit**

```bash
git add cdk/docker/qdrant/cluster-entrypoint.sh
git commit -m "feat(cdk): add Qdrant cluster entrypoint script"
```

---

## Task 3: Create Dockerfile

**Files:**

- Create: `cdk/docker/qdrant/Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
# Qdrant Vector Database - Custom Image for ECS Fargate Cluster
# Based on official image with custom entrypoint for cluster bootstrap/join logic

FROM qdrant/qdrant:v1.13.2

# Install dig for DNS lookups in entrypoint
USER root
RUN apt-get update && apt-get install -y --no-install-recommends dnsutils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy custom entrypoint
COPY cluster-entrypoint.sh /qdrant/cluster-entrypoint.sh
RUN chmod +x /qdrant/cluster-entrypoint.sh

USER 1000:1000
WORKDIR /qdrant

# Qdrant ports
# 6333 - REST API & Dashboard
# 6334 - gRPC API
# 6335 - Cluster/Raft communication
EXPOSE 6333 6334 6335

ENTRYPOINT ["/qdrant/cluster-entrypoint.sh"]
```

**Step 2: Commit**

```bash
git add cdk/docker/qdrant/Dockerfile
git commit -m "feat(cdk): add Qdrant Dockerfile

TODO: Update to meet GoDaddy security standards in future phase"
```

---

## Task 4: Create QdrantStack - Part 1 (Imports and Class Setup)

**Files:**

- Create: `cdk/lib/qdrant-stack.ts`

**Step 1: Create stack file with imports and class skeleton**

```typescript
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Qdrant Vector Database Stack
 *
 * Deploys a 3-node Qdrant cluster on ECS Fargate with:
 * - VPC-internal access via Service Discovery
 * - EFS for snapshot storage
 * - API key authentication via Secrets Manager
 *
 * Only deployed for dev and prod environments.
 */
export class QdrantStack extends GDStack {
  /** ECS cluster running Qdrant */
  public readonly cluster?: ecs.Cluster;
  /** Fargate service running Qdrant nodes */
  public readonly service?: ecs.FargateService;
  /** EFS filesystem for snapshots */
  public readonly fileSystem?: efs.FileSystem;
  /** ECR repository for custom Qdrant image */
  public readonly repository?: ecr.Repository;
  /** API key secret */
  public readonly apiKeySecret?: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Only create resources for dev and prod
    if (!["dev", "prod"].includes(config.envName)) {
      return;
    }

    // VPC lookup using TLZ
    const vpc = ec2.Vpc.fromLookup(this, "VPC", {
      vpcId: this.gdTrustedLandingZone.networking.vpcId,
    });

    // TODO: Add resources in subsequent tasks
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cdk/lib/qdrant-stack.ts
git commit -m "feat(cdk): add QdrantStack skeleton with VPC lookup"
```

---

## Task 5: Create QdrantStack - Part 2 (Security Group)

**Files:**

- Modify: `cdk/lib/qdrant-stack.ts`

**Step 1: Add security group after VPC lookup**

Replace the `// TODO: Add resources` comment with:

```typescript
// Security Group - VPC internal access only
const securityGroup = new ec2.SecurityGroup(this, "QdrantSecurityGroup", {
  vpc,
  securityGroupName: `${config.envName}-qdrant-sg`,
  description: "Qdrant cluster security group - VPC internal access",
  allowAllOutbound: false,
});

// REST API access from VPC
securityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(6333),
  "Allow Qdrant REST API from VPC",
);

// gRPC API access from VPC
securityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(6334),
  "Allow Qdrant gRPC API from VPC",
);

// Intra-cluster gRPC replication (port 6334)
securityGroup.addIngressRule(
  securityGroup,
  ec2.Port.tcp(6334),
  "Intra-cluster gRPC replication",
);
securityGroup.addEgressRule(
  securityGroup,
  ec2.Port.tcp(6334),
  "Intra-cluster gRPC replication",
);

// Intra-cluster Raft consensus (port 6335)
securityGroup.addIngressRule(
  securityGroup,
  ec2.Port.tcp(6335),
  "Intra-cluster Raft consensus",
);
securityGroup.addEgressRule(
  securityGroup,
  ec2.Port.tcp(6335),
  "Intra-cluster Raft consensus",
);

// HTTPS outbound for ECR image pulling
securityGroup.addEgressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(443),
  "Allow HTTPS for ECR image pulling",
);

// TODO: Add EFS, ECS, Service Discovery
```

**Step 2: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cdk/lib/qdrant-stack.ts
git commit -m "feat(cdk): add Qdrant security group with VPC-internal rules"
```

---

## Task 6: Create QdrantStack - Part 3 (EFS and Secrets)

**Files:**

- Modify: `cdk/lib/qdrant-stack.ts`

**Step 1: Add EFS and Secrets after security group**

Replace `// TODO: Add EFS, ECS, Service Discovery` with:

```typescript
// EFS for snapshots
const fileSystem = new efs.FileSystem(this, "QdrantEfs", {
  vpc,
  fileSystemName: `${config.envName}-qdrant-efs`,
  encrypted: true,
  lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
  performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
});
this.fileSystem = fileSystem;

// Allow EFS access from Qdrant security group
fileSystem.connections.allowFrom(
  securityGroup,
  ec2.Port.tcp(2049),
  "Allow NFS from Qdrant",
);
securityGroup.addEgressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(2049),
  "Allow NFS to EFS",
);

// EFS Access Point for Qdrant snapshots
const accessPoint = new efs.AccessPoint(this, "QdrantEfsAccessPoint", {
  fileSystem,
  path: "/qdrant-snapshots",
  posixUser: { uid: "1000", gid: "1000" },
  createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "755" },
});

// API Key Secret
const apiKeySecret = new secretsmanager.Secret(this, "QdrantApiKey", {
  secretName: `${config.envName}-qdrant-api-key`,
  description: "API key for Qdrant cluster authentication",
  generateSecretString: {
    excludeCharacters: "~`@#$%^&*+={}[]()|\:;'\"<>,/? ",
    passwordLength: 32,
  },
});
this.apiKeySecret = apiKeySecret;

// ECR Repository for custom image
const repository = new ecr.Repository(this, "QdrantRepo", {
  repositoryName: `${config.envName}-qdrant`,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  imageScanOnPush: true,
  lifecycleRules: [
    {
      maxImageCount: 10,
      description: "Keep only 10 images",
    },
  ],
});
this.repository = repository;

// TODO: Add ECS Cluster, Task Definition, Service, Service Discovery
```

**Step 2: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cdk/lib/qdrant-stack.ts
git commit -m "feat(cdk): add Qdrant EFS, Secrets Manager, and ECR repository"
```

---

## Task 7: Create QdrantStack - Part 4 (ECS Cluster and Task Definition)

**Files:**

- Modify: `cdk/lib/qdrant-stack.ts`

**Step 1: Add ECS Cluster and Task Definition**

Replace `// TODO: Add ECS Cluster, Task Definition, Service, Service Discovery` with:

```typescript
// ECS Cluster
const cluster = new ecs.Cluster(this, "QdrantCluster", {
  vpc,
  clusterName: `${config.envName}-qdrant`,
  containerInsights: true,
});
this.cluster = cluster;

// Service Discovery Namespace
const namespace = new servicediscovery.PrivateDnsNamespace(
  this,
  "QdrantNamespace",
  {
    name: `${config.envName}.airo.local`,
    vpc,
    description: `Qdrant service discovery namespace for ${config.envName}`,
  },
);

const qdrantFqdn = `qdrant.${config.envName}.airo.local`;

// Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(this, "QdrantTaskDef", {
  family: `${config.envName}-qdrant`,
  cpu: config.qdrant.cpu,
  memoryLimitMiB: config.qdrant.memory,
  ephemeralStorageGiB: config.qdrant.ephemeralStorageGiB,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.ARM64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

// Add EFS volume to task definition
taskDefinition.addVolume({
  name: "qdrant-snapshots",
  efsVolumeConfiguration: {
    fileSystemId: fileSystem.fileSystemId,
    rootDirectory: "/",
    transitEncryption: "ENABLED",
    authorizationConfig: {
      accessPointId: accessPoint.accessPointId,
      iam: "ENABLED",
    },
  },
});

// Grant task role access to EFS
fileSystem.grantRootAccess(taskDefinition.taskRole);

// Container Definition
const container = taskDefinition.addContainer("qdrant", {
  containerName: "qdrant",
  image: ecs.ContainerImage.fromEcrRepository(
    repository,
    config.qdrant.imageTag,
  ),
  user: "1000:1000",
  environment: {
    QDRANT__CLUSTER__ENABLED: "true",
    QDRANT_CLUSTER_FQDN: qdrantFqdn,
  },
  secrets: {
    QDRANT__SERVICE__API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
  },
  portMappings: [
    { containerPort: 6333, protocol: ecs.Protocol.TCP, name: "qdrant-rest" },
    { containerPort: 6334, protocol: ecs.Protocol.TCP, name: "qdrant-grpc" },
    { containerPort: 6335, protocol: ecs.Protocol.TCP, name: "qdrant-cluster" },
  ],
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: "qdrant",
    logRetention: logs.RetentionDays.ONE_MONTH,
  }),
  healthCheck: {
    command: ["CMD-SHELL", "curl -f http://localhost:6333/healthz || exit 1"],
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    retries: 3,
    startPeriod: cdk.Duration.seconds(60),
  },
});

// Mount EFS volume
container.addMountPoints({
  sourceVolume: "qdrant-snapshots",
  containerPath: "/qdrant/snapshots",
  readOnly: false,
});

// TODO: Add Fargate Service and Outputs
```

**Step 2: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cdk/lib/qdrant-stack.ts
git commit -m "feat(cdk): add Qdrant ECS cluster and task definition"
```

---

## Task 8: Create QdrantStack - Part 5 (Fargate Service and Outputs)

**Files:**

- Modify: `cdk/lib/qdrant-stack.ts`

**Step 1: Add Fargate Service and Outputs**

Replace `// TODO: Add Fargate Service and Outputs` with:

```typescript
// Fargate Service
const service = new ecs.FargateService(this, "QdrantService", {
  cluster,
  serviceName: `${config.envName}-qdrant-service`,
  taskDefinition,
  desiredCount: config.qdrant.nodeCount,
  minHealthyPercent: 0,
  maxHealthyPercent: 200,
  vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
  securityGroups: [securityGroup],
  assignPublicIp: false,
  enableExecuteCommand: true,
  circuitBreaker: { enable: true, rollback: true },
});
this.service = service;

// Enable Service Discovery
service.enableCloudMap({
  name: "qdrant",
  dnsRecordType: servicediscovery.DnsRecordType.A,
  dnsTtl: cdk.Duration.seconds(10),
  cloudMapNamespace: namespace,
});

// Outputs
new cdk.CfnOutput(this, "QdrantEndpoint", {
  value: qdrantFqdn,
  description:
    "Qdrant cluster DNS endpoint (port 6333 for REST, 6334 for gRPC)",
  exportName: `${config.envName}-qdrant-endpoint`,
});

new cdk.CfnOutput(this, "QdrantApiKeySecretArn", {
  value: apiKeySecret.secretArn,
  description: "ARN of Qdrant API key secret in Secrets Manager",
  exportName: `${config.envName}-qdrant-api-key-arn`,
});

new cdk.CfnOutput(this, "QdrantEcrRepository", {
  value: repository.repositoryUri,
  description: "ECR repository URI for Qdrant custom image",
  exportName: `${config.envName}-qdrant-ecr-uri`,
});

new cdk.CfnOutput(this, "QdrantEfsFileSystemId", {
  value: fileSystem.fileSystemId,
  description: "EFS filesystem ID for Qdrant snapshots",
  exportName: `${config.envName}-qdrant-efs-id`,
});

// Tags
cdk.Tags.of(this).add("component", "qdrant");
cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");
```

**Step 2: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cdk/lib/qdrant-stack.ts
git commit -m "feat(cdk): add Qdrant Fargate service with Service Discovery and outputs"
```

---

## Task 9: Add QdrantStack to Main Entry Point

**Files:**

- Modify: `cdk/app/main.ts`

**Step 1: Add import**

Add after other imports (around line 8):

```typescript
import { QdrantStack } from "../lib/qdrant-stack";
```

**Step 2: Add stack instantiation**

Add before `app.synth()` (around line 44):

```typescript
// Create Qdrant vector database cluster (dev and prod only)
new QdrantStack(app, "QdrantStack", { env });
```

**Step 3: Verify TypeScript compiles**

Run: `cd cdk && pnpm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add cdk/app/main.ts
git commit -m "feat(cdk): add QdrantStack to main CDK app"
```

---

## Task 10: Verify CDK Synth

**Step 1: Run CDK synth for dev**

```bash
cd cdk && ENV_NAME=dev pnpm cdk synth QdrantStack --no-staging 2>&1 | head -100
```

Expected: CloudFormation template output without errors

**Step 2: Run CDK diff for dev (optional - requires AWS credentials)**

```bash
cd cdk && ENV_NAME=dev pnpm cdk diff QdrantStack
```

Expected: Shows resources to be created

**Step 3: Final commit with all changes**

```bash
git add -A
git commit -m "feat(cdk): complete Qdrant CDK stack implementation

Adds a 3-node Qdrant vector database cluster on ECS Fargate:
- VPC-internal access via Service Discovery
- EFS for snapshot storage
- API key authentication via Secrets Manager
- Custom Docker image support via ECR
- ARM64 Fargate tasks
- Dev and prod environments only

See docs/plans/2026-02-18-qdrant-cdk-stack-design.md for full design."
```

---

## Post-Implementation: Docker Image Build

After CDK deployment, the Docker image needs to be built and pushed:

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com

# Build and push (from cdk/docker/qdrant directory)
cd cdk/docker/qdrant
docker build --platform linux/arm64 -t qdrant-custom .
docker tag qdrant-custom:latest <account>.dkr.ecr.us-west-2.amazonaws.com/<env>-qdrant:latest
docker push <account>.dkr.ecr.us-west-2.amazonaws.com/<env>-qdrant:latest
```

---

## Summary

| Task | Description              | Files                                     |
| ---- | ------------------------ | ----------------------------------------- |
| 1    | Add configuration        | `cdk/lib/config.ts`                       |
| 2    | Create entrypoint script | `cdk/docker/qdrant/cluster-entrypoint.sh` |
| 3    | Create Dockerfile        | `cdk/docker/qdrant/Dockerfile`            |
| 4    | Stack skeleton           | `cdk/lib/qdrant-stack.ts`                 |
| 5    | Security group           | `cdk/lib/qdrant-stack.ts`                 |
| 6    | EFS and Secrets          | `cdk/lib/qdrant-stack.ts`                 |
| 7    | ECS Cluster and Task     | `cdk/lib/qdrant-stack.ts`                 |
| 8    | Fargate Service          | `cdk/lib/qdrant-stack.ts`                 |
| 9    | Main entry point         | `cdk/app/main.ts`                         |
| 10   | Verify synth             | N/A                                       |
