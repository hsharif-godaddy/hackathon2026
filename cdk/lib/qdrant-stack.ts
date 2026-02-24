import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
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

    const qdrantFqdn = `qdrant.${config.envName}.airo.local`;

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

    // Task Definition
    // Note: Qdrant data is stored in ephemeral storage and replicated across nodes.
    // EFS is mounted for snapshots only. For durability, rely on Raft replication
    // (minimum 2/3 nodes healthy) and periodic snapshots to EFS.
    // Using "QdrantTaskV2" to avoid orphaned IAM role conflicts from failed deployments
    const taskDefinition = new ecs.FargateTaskDefinition(this, "QdrantTaskV2", {
      family: `${config.envName}-qdrant`,
      cpu: config.qdrant.cpu,
      memoryLimitMiB: config.qdrant.memory,
      ephemeralStorageGiB: config.qdrant.ephemeralStorageGiB,
      executionRole, // Use our explicit execution role
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Debug mode: use Qdrant image but with sleep entrypoint (no EFS, no health check)
    // Set to true to test container image pull and secrets access without running Qdrant
    const debugSleepMode = false;
    // Set to false to use actual Qdrant container, true for noop sleep container
    const useNoopContainer = false;
    // Enable EFS for snapshots (disable to test Qdrant without EFS first)
    const enableEfs = true;

    // Add EFS volume to task definition (only when EFS is enabled)
    if (!useNoopContainer && !debugSleepMode && enableEfs) {
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
    }

    // Grant execution role access to read the secret with KMS decrypt
    // Uses explicit policy to work with safeguard cross-account KMS key
    if (!useNoopContainer || debugSleepMode) {
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
    }

    // Container Definition
    const container = taskDefinition.addContainer("qdrant", {
      containerName: "qdrant",
      image: useNoopContainer
        ? ecs.ContainerImage.fromRegistry("public.ecr.aws/amazonlinux/amazonlinux:2023")
        : ecs.ContainerImage.fromEcrRepository(repository, config.qdrant.imageTag),
      // In debug mode, override entrypoint to sleep (Qdrant image uses custom entrypoint)
      entryPoint: debugSleepMode ? ["/bin/bash", "-c"] : undefined,
      command: useNoopContainer || debugSleepMode ? ["sleep", "infinity"] : undefined,
      user: useNoopContainer ? undefined : "1000:1000",
      environment: useNoopContainer || debugSleepMode
        ? {}
        : {
            // Bind to all interfaces (not localhost) for external access
            QDRANT__SERVICE__HOST: "0.0.0.0",
            QDRANT__SERVICE__GRPC_PORT: "6334",
            QDRANT__CLUSTER__ENABLED: "true",
            QDRANT_CLUSTER_FQDN: qdrantFqdn,
          },
      secrets: useNoopContainer
        ? {}
        : {
            // Test secrets access even in debug mode
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
      healthCheck: useNoopContainer || debugSleepMode
        ? undefined // No health check in noop or debug mode
        : {
            command: ["CMD-SHELL", "curl -f http://localhost:6333/healthz || exit 1"],
            interval: cdk.Duration.seconds(10), // Faster checks during testing
            timeout: cdk.Duration.seconds(5),
            retries: 1, // Fail fast during testing (increase for prod)
            startPeriod: cdk.Duration.seconds(30), // Shorter startup grace period
          },
    });

    // Mount EFS volume (only when EFS is enabled)
    if (!useNoopContainer && !debugSleepMode && enableEfs) {
      container.addMountPoints({
        sourceVolume: "qdrant-snapshots",
        containerPath: "/qdrant/snapshots",
        readOnly: false,
      });
    }

    // Fargate Service
    const service = new ecs.FargateService(this, "QdrantService", {
      cluster,
      serviceName: `${config.envName}-qdrant-service`,
      taskDefinition,
      desiredCount: config.qdrant.nodeCount,
      minHealthyPercent: 67, // Maintain quorum (2/3 nodes) during rolling updates
      maxHealthyPercent: 200,
      vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
      securityGroups: [securityGroup],
      assignPublicIp: false,
      enableExecuteCommand: false,
      circuitBreaker: { enable: true, rollback: true },
    });
    this.service = service;

    // Enable Service Discovery
    service.enableCloudMap({
      name: "qdrant",
      dnsRecordType: servicediscovery.DnsRecordType.A,
      dnsTtl: cdk.Duration.seconds(30), // Balance DNS query load vs failover speed
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

    new cdk.CfnOutput(this, "QdrantEfsFileSystemId", {
      value: fileSystem.fileSystemId,
      description: "EFS filesystem ID for Qdrant snapshots",
      exportName: `${config.envName}-qdrant-efs-id`,
    });

    // Bastion instance for testing Qdrant connectivity
    // Access via SSM Session Manager: aws ssm start-session --target <instance-id>
    const bastionSg = new ec2.SecurityGroup(this, "BastionSecurityGroup", {
      vpc,
      securityGroupName: `${config.envName}-qdrant-bastion-sg`,
      description: "Bastion host for Qdrant testing",
      allowAllOutbound: true,
    });

    const bastionRole = new iam.Role(this, "BastionRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });

    const bastion = new ec2.Instance(this, "BastionInstance", {
      vpc,
      vpcSubnets: this.gdTrustedLandingZone.networking.dxAppSubnets,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: bastionSg,
      role: bastionRole,
      instanceName: `${config.envName}-qdrant-bastion`,
    });

    // Allow bastion to connect to Qdrant
    securityGroup.addIngressRule(
      bastionSg,
      ec2.Port.tcp(6333),
      "Allow Qdrant REST API from bastion",
    );
    securityGroup.addIngressRule(
      bastionSg,
      ec2.Port.tcp(6334),
      "Allow Qdrant gRPC API from bastion",
    );

    new cdk.CfnOutput(this, "BastionInstanceId", {
      value: bastion.instanceId,
      description: "Bastion instance ID - connect via: aws ssm start-session --target <id>",
      exportName: `${config.envName}-qdrant-bastion-id`,
    });

    // Tags
    cdk.Tags.of(this).add("component", "qdrant");
    cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");
  }
}
