import * as cdk from "aws-cdk-lib";
import * as path from "path";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as events from "aws-cdk-lib/aws-events";
import * as events_targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as triggers from "aws-cdk-lib/triggers";
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Qdrant Vector Database Stack
 *
 * Deploys a Qdrant cluster on ECS Fargate using a two-service model
 * that mirrors the official Docker Compose cluster generator:
 *   - Seed service (1 task): stable FQDN, starts with --uri
 *   - Worker service (N-1 tasks): joins via --bootstrap to seed
 *
 * This avoids the leader-election race condition inherent in single-service
 * deployments on ECS Fargate (no stable per-task hostnames like K8s).
 *
 * Only deployed for dev and prod environments.
 */
export class QdrantStack extends GDStack {
  /** ECS cluster running Qdrant */
  public readonly cluster?: ecs.Cluster;
  /** Fargate service for the seed node (bootstrap target) */
  public readonly seedService?: ecs.FargateService;
  /** Fargate service for worker nodes (join via seed) */
  public readonly service?: ecs.FargateService;
  /** EFS filesystem for snapshots */
  public readonly fileSystem?: efs.FileSystem;
  /** ECR repository for custom Qdrant image (imported from QdrantEcrStack) */
  public readonly repository?: ecr.IRepository;
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

    // Security Group - VPC internal access only
    const securityGroup = new ec2.SecurityGroup(this, "QdrantSecurityGroup", {
      vpc,
      securityGroupName: `${config.envName}-qdrant-sg`,
      description: "Qdrant cluster security group - VPC internal access",
      allowAllOutbound: false,
    });

    // REST API access from VPC primary CIDR
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6333),
      "Allow Qdrant REST API from VPC",
    );
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6334),
      "Allow Qdrant gRPC API from VPC",
    );

    // REST/gRPC API access from DX subnets (secondary CIDR blocks)
    this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(
      (subnet) => {
        securityGroup.addIngressRule(
          ec2.Peer.ipv4(subnet.ipv4CidrBlock),
          ec2.Port.tcp(6333),
          `Allow Qdrant REST API from DX subnet ${subnet.availabilityZone}`,
        );
        securityGroup.addIngressRule(
          ec2.Peer.ipv4(subnet.ipv4CidrBlock),
          ec2.Port.tcp(6334),
          `Allow Qdrant gRPC API from DX subnet ${subnet.availabilityZone}`,
        );
      },
    );

    // VPN access for REST API (debugging/dashboard access)
    const vpnPrefixList = ec2.PrefixList.fromLookup(
      this,
      "PrismaNatInternal",
      { prefixListName: "com.godaddy.global.vpn.prisma-nat-internal" },
    );
    securityGroup.addIngressRule(
      ec2.Peer.prefixList(vpnPrefixList.prefixListId),
      ec2.Port.tcp(6333),
      "Allow Qdrant REST API from VPN",
    );

    // Intra-cluster REST API (port 6333) - workers probe seed health
    securityGroup.connections.allowInternally(
      ec2.Port.tcp(6333),
      "Intra-cluster REST API (worker-to-seed health probe)",
    );

    // Intra-cluster gRPC replication (port 6334)
    securityGroup.connections.allowInternally(
      ec2.Port.tcp(6334),
      "Intra-cluster gRPC replication",
    );

    // Intra-cluster Raft consensus (port 6335)
    securityGroup.connections.allowInternally(
      ec2.Port.tcp(6335),
      "Intra-cluster Raft consensus",
    );

    // HTTPS outbound for ECR image pulling and AWS services
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS for ECR image pulling and AWS services",
    );

    // DNS outbound for Service Discovery and name resolution
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.udp(53),
      "Allow DNS (UDP) to VPC",
    );
    securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(53),
      "Allow DNS (TCP) to VPC",
    );
    this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(
      (subnet) => {
        securityGroup.addEgressRule(
          ec2.Peer.ipv4(subnet.ipv4CidrBlock),
          ec2.Port.udp(53),
          `Allow DNS (UDP) to DX subnet ${subnet.availabilityZone}`,
        );
        securityGroup.addEgressRule(
          ec2.Peer.ipv4(subnet.ipv4CidrBlock),
          ec2.Port.tcp(53),
          `Allow DNS (TCP) to DX subnet ${subnet.availabilityZone}`,
        );
      },
    );

    // EFS for snapshots
    // Use DESTROY in dev for easy cleanup on rollback, RETAIN in prod for safety
    const fileSystem = new efs.FileSystem(this, "QdrantEfs", {
      vpc,
      fileSystemName: `${config.envName}-qdrant-efs`,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy:
        config.envName === "dev"
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
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
    this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(
      (subnet) => {
        securityGroup.addEgressRule(
          ec2.Peer.ipv4(subnet.ipv4CidrBlock),
          ec2.Port.tcp(2049),
          `Allow NFS to EFS in DX subnet ${subnet.availabilityZone}`,
        );
      },
    );

    // EFS Access Point for Qdrant snapshots
    const accessPoint = new efs.AccessPoint(this, "QdrantEfsAccessPoint", {
      fileSystem,
      path: "/qdrant-snapshots",
      posixUser: { uid: "1000", gid: "1000" },
      createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "755" },
    });

    // API Key Secret
    // Note: For key rotation, update the secret value in Secrets Manager and
    // trigger a new ECS deployment. Consider using Secrets Manager rotation
    // with a Lambda function for automated rotation in production.
    const apiKeySecret = new secretsmanager.Secret(this, "QdrantApiKey", {
      secretName: `${config.envName}-qdrant-api-key`,
      description: "API key for Qdrant cluster authentication",
      generateSecretString: {
        excludeCharacters: "~\`@#$%^&*+={}[]()|\:;'\"<>,/? ",
        passwordLength: 32,
      },
    });
    this.apiKeySecret = apiKeySecret;

    // Enable TLS in production, optional in dev
    const enableTls = config.envName === "prod" || config.qdrant.enableTls;

    // TLS Certificate Secrets (managed by Lambda bootstrap)
    // CA secret holds the self-signed CA cert/key
    // Cert secret holds the server certificate signed by the CA
    // Format: {"crt": "cert", "key": "private key", "chain": "CA cert"}
    const tlsCaSecretName = `${config.envName}-qdrant-tls-ca`;
    const tlsCertSecretName = `${config.envName}-qdrant-tls-cert`;
    const qdrantFqdn = `qdrant.${config.envName}.airo.local`;

    // Create secrets for TLS certificates (Lambda will populate the values)
    // Using DESTROY in dev for easy cleanup, RETAIN in prod
    const tlsCaSecret = new secretsmanager.Secret(this, "QdrantTlsCaSecret", {
      secretName: tlsCaSecretName,
      description: "Self-signed CA certificate for Qdrant TLS",
      removalPolicy:
        config.envName === "dev"
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
    });

    const tlsCertSecret = new secretsmanager.Secret(this, "QdrantTlsCertSecret", {
      secretName: tlsCertSecretName,
      description: "Server certificate for Qdrant TLS (signed by internal CA)",
      removalPolicy:
        config.envName === "dev"
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
    });

    // TLS Bootstrap Lambda - generates self-signed CA and server certificates
    // Triggered on deployment and weekly to check for renewal
    let tlsBootstrapLambda: lambda.Function | undefined;
    let tlsBootstrapTrigger: triggers.Trigger | undefined;
    if (enableTls) {
      // Lambda execution role
      const lambdaRole = new iam.Role(this, "QdrantTlsBootstrapRole", {
        roleName: `${config.envName}-qdrant-tls-bootstrap-role`,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
      });

      // Grant Lambda access to read/write secrets
      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:PutSecretValue",
          ],
          resources: [tlsCaSecret.secretArn, tlsCertSecret.secretArn],
        }),
      );
      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "kms:ViaService": `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
            },
          },
        }),
      );

      // Use pre-built Lambda artifact (built by lambda/build.ts)
      tlsBootstrapLambda = new lambda.Function(this, "QdrantTlsBootstrapLambda", {
        functionName: `${config.envName}-qdrant-tls-bootstrap`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../lambda/qdrant-tls-bootstrap/dist"),
        ),
        timeout: cdk.Duration.minutes(2),
        architecture: lambda.Architecture.ARM_64,
        description: "Bootstraps self-signed TLS certificates for Qdrant cluster",
        environment: {
          CA_SECRET_NAME: tlsCaSecretName,
          CERT_SECRET_NAME: tlsCertSecretName,
          COMMON_NAME: qdrantFqdn,
        },
        role: lambdaRole,
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Trigger Lambda on deployment - ECS service will depend on this
      tlsBootstrapTrigger = new triggers.Trigger(this, "TriggerTlsBootstrap", {
        handler: tlsBootstrapLambda,
        timeout: cdk.Duration.minutes(2),
      });

      // Run certificate renewal weekly
      const tlsRenewalCron = new events.Rule(this, "QdrantTlsRenewalCron", {
        ruleName: `${config.envName}-qdrant-tls-renewal`,
        schedule: events.Schedule.rate(cdk.Duration.days(7)),
        description: "Weekly check for Qdrant TLS certificate renewal",
      });
      tlsRenewalCron.addTarget(new events_targets.LambdaFunction(tlsBootstrapLambda));
    }

    // ECR Repository - lookup from QdrantEcrStack
    // The ECR repo is created separately to allow pre-populating images
    // before deploying the ECS service
    const repository = ecr.Repository.fromRepositoryName(
      this,
      "QdrantRepo",
      `${config.envName}-qdrant`,
    );
    this.repository = repository;

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

    // Create execution role explicitly to ensure KMS permissions are attached
    // CDK creates execution roles lazily, so we need to create it upfront
    const executionRole = new iam.Role(this, "QdrantExecutionRole", {
      roleName: `${config.envName}-qdrant-execution-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // =========================================================================
    // Two-Service Model: Seed (1 task) + Workers (N-1 tasks)
    // =========================================================================
    // Mirrors the official Qdrant Docker Compose cluster generator:
    //   Node 0 (seed):  ./qdrant --uri 'http://qdrant_node_0:6335'
    //   Node N (worker): sleep && ./qdrant --bootstrap 'http://qdrant_node_0:6335'
    //
    // The seed has a dedicated Service Discovery name (qdrant-seed) so workers
    // can reliably find it. This replaces the jitter/DNS/IP hacks that fail
    // on ECS Fargate due to stale DNS and simultaneous task startup.
    // =========================================================================

    const seedFqdn = `qdrant-seed.${config.envName}.airo.local`;
    const containerImage = ecs.ContainerImage.fromEcrRepository(repository, config.qdrant.imageTag);

    // Shared IAM: execution role already created above. Create a shared task
    // role so both task definitions get the same permissions.
    const taskRole = new iam.Role(this, "QdrantTaskRole", {
      roleName: `${config.envName}-qdrant-task-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Grant execution role access to read API key secret with KMS decrypt
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [apiKeySecret.secretArn],
      }),
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["kms:Decrypt"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "kms:ViaService": `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
          },
        },
      }),
    );

    // Grant task role access to TLS cert secret (fetched at runtime by entrypoint)
    if (enableTls) {
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [tlsCertSecret.secretArn],
        }),
      );
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["kms:Decrypt"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "kms:ViaService": `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
              "kms:CallerAccount": cdk.Aws.ACCOUNT_ID,
            },
          },
        }),
      );
    }

    // Shared environment variables for all Qdrant nodes
    const sharedEnv: Record<string, string> = {
      QDRANT__SERVICE__HOST: "0.0.0.0",
      QDRANT__SERVICE__GRPC_PORT: "6334",
      QDRANT__CLUSTER__ENABLED: "true",
      QDRANT__STORAGE__COLLECTION__REPLICATION_FACTOR: "2",
      QDRANT_SEED_FQDN: seedFqdn,
      QDRANT_ENABLE_TLS: enableTls ? "true" : "false",
      ...(enableTls ? { QDRANT_TLS_SECRET_ARN: tlsCertSecretName } : {}),
      AWS_REGION: cdk.Aws.REGION,
    };

    const sharedSecrets = {
      QDRANT__SERVICE__API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
    };

    const portMappings: ecs.PortMapping[] = [
      { containerPort: 6333, protocol: ecs.Protocol.TCP, name: "qdrant-rest" },
      { containerPort: 6334, protocol: ecs.Protocol.TCP, name: "qdrant-grpc" },
      { containerPort: 6335, protocol: ecs.Protocol.TCP, name: "qdrant-cluster" },
    ];

    const logging = ecs.LogDrivers.awsLogs({
      streamPrefix: "qdrant",
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const healthCheckCommand = enableTls
      ? "curl -fk https://localhost:6333/healthz || exit 1"
      : "curl -f http://localhost:6333/healthz || exit 1";

    // Grant EFS access once (both task defs share the same taskRole)
    fileSystem.grantRootAccess(taskRole);

    // Helper to create a task definition with EFS and role-specific env vars
    const createTaskDef = (
      id: string,
      family: string,
      role: "seed" | "worker",
      startPeriodSecs: number,
    ): ecs.FargateTaskDefinition => {
      const taskDef = new ecs.FargateTaskDefinition(this, id, {
        family,
        cpu: config.qdrant.cpu,
        memoryLimitMiB: config.qdrant.memory,
        ephemeralStorageGiB: config.qdrant.ephemeralStorageGiB,
        executionRole,
        taskRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      // EFS volume for snapshots
      taskDef.addVolume({
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
      const container = taskDef.addContainer("qdrant", {
        containerName: "qdrant",
        image: containerImage,
        user: "1000:1000",
        environment: {
          ...sharedEnv,
          QDRANT_NODE_ROLE: role,
        },
        secrets: sharedSecrets,
        portMappings,
        logging,
        healthCheck: {
          command: ["CMD-SHELL", healthCheckCommand],
          interval: cdk.Duration.seconds(15),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(startPeriodSecs),
        },
      });

      container.addMountPoints({
        sourceVolume: "qdrant-snapshots",
        containerPath: "/qdrant/snapshots",
        readOnly: false,
      });

      return taskDef;
    };

    // Seed: starts immediately, short grace period
    const seedTaskDef = createTaskDef(
      "QdrantSeedTask", `${config.envName}-qdrant-seed`, "seed", 30,
    );

    // Workers: wait for seed, longer grace period
    const workerTaskDef = createTaskDef(
      "QdrantWorkerTask", `${config.envName}-qdrant`, "worker", 120,
    );

    // --- Seed Service (1 task, stable bootstrap target) ---
    const seedService = new ecs.FargateService(this, "QdrantSeedService", {
      cluster,
      serviceName: `${config.envName}-qdrant-seed`,
      taskDefinition: seedTaskDef,
      desiredCount: 1,
      minHealthyPercent: 0, // Allow full replacement during deploys
      maxHealthyPercent: 200,
      vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
      securityGroups: [securityGroup],
      assignPublicIp: false,
      enableExecuteCommand: false,
      circuitBreaker: { enable: true, rollback: true },
    });
    this.seedService = seedService;

    seedService.enableCloudMap({
      name: "qdrant-seed",
      dnsRecordType: servicediscovery.DnsRecordType.A,
      dnsTtl: cdk.Duration.seconds(10),
      cloudMapNamespace: namespace,
    });

    // --- Worker Service (N-1 tasks, join via seed) ---
    if (config.qdrant.nodeCount < 2) {
      throw new Error(
        `qdrant.nodeCount must be >= 2 for a cluster (got ${config.qdrant.nodeCount}). ` +
        `The seed service always runs 1 task; workers = nodeCount - 1.`,
      );
    }
    const workerCount = config.qdrant.nodeCount - 1;
    const workerService = new ecs.FargateService(this, "QdrantService", {
      cluster,
      serviceName: `${config.envName}-qdrant-service`,
      taskDefinition: workerTaskDef,
      desiredCount: workerCount,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
      securityGroups: [securityGroup],
      assignPublicIp: false,
      enableExecuteCommand: false,
      circuitBreaker: { enable: true, rollback: true },
    });
    this.service = workerService;

    workerService.enableCloudMap({
      name: "qdrant",
      dnsRecordType: servicediscovery.DnsRecordType.A,
      dnsTtl: cdk.Duration.seconds(30),
      cloudMapNamespace: namespace,
    });

    // Ensure TLS certificates are created before either service starts
    if (tlsBootstrapTrigger) {
      seedService.node.addDependency(tlsBootstrapTrigger);
      workerService.node.addDependency(tlsBootstrapTrigger);
    }

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

    new cdk.CfnOutput(this, "QdrantEfsFileSystemId", {
      value: fileSystem.fileSystemId,
      description: "EFS filesystem ID for Qdrant snapshots",
      exportName: `${config.envName}-qdrant-efs-id`,
    });

    new cdk.CfnOutput(this, "QdrantTlsCaSecretArn", {
      value: tlsCaSecret.secretArn,
      description: "ARN of self-signed CA secret for Qdrant TLS",
      exportName: `${config.envName}-qdrant-tls-ca-arn`,
    });

    new cdk.CfnOutput(this, "QdrantTlsCertSecretArn", {
      value: tlsCertSecret.secretArn,
      description: "ARN of server certificate secret for Qdrant TLS",
      exportName: `${config.envName}-qdrant-tls-cert-arn`,
    });

    // Tags
    cdk.Tags.of(this).add("component", "qdrant");
    cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");
  }
}
