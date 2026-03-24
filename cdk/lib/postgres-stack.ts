import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import {GDStack, GDStackProps} from "@gd-safeguard/godaddy-constructs";
import * as logs from 'aws-cdk-lib/aws-logs';
import config from './config';

export class PostgresStack extends GDStack {
  public readonly clusters: rds.DatabaseCluster[] = [];

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });

    if (['dev', 'prod'].includes(config.envName)) {
      config.postgresDatabases.forEach(database => {
        // Create security group for PostgreSQL
        const postgresSecurityGroup = new ec2.SecurityGroup(this, `${database}-PostgresSecurityGroup`, {
          vpc,
          description: `[${database}] Security group for PostgreSQL Aurora cluster`,
          allowAllOutbound: true,
        });

        // Allow inbound PostgreSQL traffic from VPC and VPN
        postgresSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(5432), `[${database}] Allow PostgreSQL access from VPC`);
        this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(subnet => {
            postgresSecurityGroup.addIngressRule(ec2.Peer.ipv4(subnet.ipv4CidrBlock), ec2.Port.tcp(5432), `[${database}] Allow PostgreSQL access from DX app subnets`);
        });
        Object.entries(config.vpnIps).forEach(([ip, description]) => {
          postgresSecurityGroup.addIngressRule(ec2.Peer.ipv4(ip), ec2.Port.tcp(5432), `[${database}] Allow PostgreSQL access from ${description}`);
        });

        const subnetGroup = new rds.SubnetGroup(this, `${database}-PostgresSubnetGroup`, {
          subnetGroupName: `${database}-postgres-subnet-group`,
          vpc,
          description: `[${database}] Subnet group for PostgreSQL Aurora cluster`,
          vpcSubnets: this.gdTrustedLandingZone.networking.dxDbSubnets,
        });

        // Create parameter group for cluster
        const parameterGroup = new rds.ParameterGroup(this, `${database}-PostgresParameterGroup`, {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
              version: rds.AuroraPostgresEngineVersion.VER_16_8,
            })
        });

        // Create parameter group for instances
        const instanceParameterGroup = new rds.ParameterGroup(this, `${database}-PostgresInstanceParameterGroup`, {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_8,
          })
        });

        // Create database credentials
        const credentials = rds.Credentials.fromGeneratedSecret('postgresadmin', {
          secretName: `${database}-postgres-credentials`,
        });

        // Create the Aurora Serverless v2 PostgreSQL cluster
        const cluster = new rds.DatabaseCluster(this, `${database}-PostgresCluster`, {
          engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_8,
          }),
          defaultDatabaseName: 'airo_builder',
          credentials,
          parameterGroup,
          storageEncrypted: true,
          storageEncryptionKey: kms.Key.fromKeyArn(this, `${database}-PostgresKMSKey`, this.gdTrustedLandingZone.accountInfo.kms.cmkArn),
          writer: rds.ClusterInstance.serverlessV2('writer', {
            publiclyAccessible: false,
            parameterGroup: instanceParameterGroup,
          }),
          readers: Array.from({ length: config.postgresReadersCount }, (n, i) => i).map(i => rds.ClusterInstance.serverlessV2(`reader-${i + 1}`, {
            publiclyAccessible: false,
            enablePerformanceInsights: true,
            performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
            instanceIdentifier: `${database}-postgres-reader-${i + 1}`,
            scaleWithWriter: i === 0,
            parameterGroup: instanceParameterGroup
        })),
          serverlessV2MinCapacity: config.postgresServerlessV2MinCapacity,
          serverlessV2MaxCapacity: config.postgresServerlessV2MaxCapacity,
          backup: {
            retention: cdk.Duration.days(config.postgresBackupRetentionDays),
            preferredWindow: '03:00-04:00',
          },
          clusterIdentifier: `${database}-postgres-cluster`,
          cloudwatchLogsExports: ['postgresql'],
          cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
          enablePerformanceInsights: true,
          performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
          vpc,
          subnetGroup,
          securityGroups: [postgresSecurityGroup],
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        cluster.node.addDependency(parameterGroup);
        cluster.node.addDependency(instanceParameterGroup);
        cluster.node.addDependency(subnetGroup);
        cluster.node.addDependency(postgresSecurityGroup);

        this.clusters.push(cluster);
        cdk.Tags.of(cluster).add('allowShutdownForCostOptimization', 'false');
      })
    }

    cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");

    // Outputs
    this.clusters.forEach((cluster, index) => {
      new cdk.CfnOutput(this, `${config.postgresDatabases[index]}-PostgresClusterEndpoint`, {
        value: cluster.clusterEndpoint.hostname,
        description: `[${config.postgresDatabases[index]}] PostgreSQL Aurora cluster endpoint`,
        exportName: `postgres-endpoint-${config.postgresDatabases[index]}`,
      });
    });
  }

}
