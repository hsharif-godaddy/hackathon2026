import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import {GDStack, GDStackProps} from "@gd-safeguard/godaddy-constructs";
import * as logs from 'aws-cdk-lib/aws-logs';
import config from './config';

export class MySQLV2Stack extends GDStack {
  public readonly clusters: rds.DatabaseCluster[] = [];

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });

    if (config.envName === 'dev') {
      config.databases.forEach(database => {
        // Create security group for MySQL
        const mysqlSecurityGroup = new ec2.SecurityGroup(this, `${database}-MySQLSecurityGroup`, {
          vpc,
          description: `[${database}] Security group for MySQL Aurora cluster`,
          allowAllOutbound: true,
        });

        // Allow inbound MySQL traffic from VPC and VPN
        mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from VPC`);
        this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(subnet => {
            mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(subnet.ipv4CidrBlock), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from VPC`);
        });
        Object.entries(config.vpnIps).forEach(([ip, description]) => {
          mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(ip), ec2.Port.tcp(3306), `[${database}] Allow MySQL access from ${description}`);
        });

        const subnetGroup = new rds.SubnetGroup(this, `${database}-MySQLSubnetGroup`, {
          subnetGroupName: `${database}-mysql-v2-subnet-group`,
          vpc,
          description: `[${database}] Subnet group for MySQL Aurora cluster`,
          vpcSubnets: this.gdTrustedLandingZone.networking.dxDbSubnets,
        });

        // Create parameter group for cluster
        const parameterGroup = new rds.ParameterGroup(this, `${database}-MySQLParameterGroup`, {
            engine: rds.DatabaseClusterEngine.auroraMysql({
              version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
            })
        });

        // Create parameter group for instances
        const instanceParameterGroup = new rds.ParameterGroup(this, `${database}-MySQLInstanceParameterGroup`, {
          engine: rds.DatabaseClusterEngine.auroraMysql({
            version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
          })
        });

        // Create database credentials
        const credentials = rds.Credentials.fromGeneratedSecret('mysqladmin', {
          secretName: `${database}-mysql-v2-credentials`,
        });

        // Create the Aurora Serverless v2 MySQL cluster
        const cluster = new rds.DatabaseCluster(this, `${database}-MySQLCluster`, {
          engine: rds.DatabaseClusterEngine.auroraMysql({
            version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
          }),
          defaultDatabaseName: 'airo_builder',
          credentials,
          parameterGroup,
          storageEncrypted: true,
          storageEncryptionKey: kms.Key.fromKeyArn(this, `${database}-MySQLKMSKey`, this.gdTrustedLandingZone.accountInfo.kms.cmkArn),
          writer: rds.ClusterInstance.serverlessV2('writer', {
            publiclyAccessible: false,
            parameterGroup: instanceParameterGroup,
          }),
          serverlessV2MinCapacity: 0.5,
          serverlessV2MaxCapacity: 16,
          backup: {
            retention: cdk.Duration.days(7),
            preferredWindow: '03:00-04:00',
          },
          clusterIdentifier: `${database}-mysql-v2-cluster`,
          cloudwatchLogsExports: ['audit', 'general', 'error', 'slowquery'],
          cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
          enablePerformanceInsights: true,
          performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
          vpc,
          subnetGroup,
          securityGroups: [mysqlSecurityGroup],
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        this.clusters.push(cluster);
        cdk.Tags.of(cluster).add('allowShutdownForCostOptimization', 'false');
      })
    }

    cdk.Tags.of(this).add("allowShutdownForCostOptimization", "false");

    // Outputs
    this.clusters.forEach((cluster, index) => {
      new cdk.CfnOutput(this, `${config.databases[index]}-MySQLV2ClusterEndpoint`, {
        value: cluster.clusterEndpoint.hostname,
        description: `[${config.databases[index]}] MySQL Aurora V2 cluster endpoint`,
        exportName: `mysql-v2-endpoint-${config.databases[index]}`,
      });
    });
  }

}
