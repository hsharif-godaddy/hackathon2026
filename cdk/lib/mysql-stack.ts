import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import {GDStack, GDStackProps} from "@gd-safeguard/godaddy-constructs";
import * as logs from 'aws-cdk-lib/aws-logs';
import config from './config';

export class MySQLStack extends GDStack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: rds.DatabaseSecret;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });


    // Create security group for MySQL
    const mysqlSecurityGroup = new ec2.SecurityGroup(this, 'MySQLSecurityGroup', {
      vpc,
      description: 'Security group for MySQL Aurora cluster',
      allowAllOutbound: true,
    });

    // Allow inbound MySQL traffic from VPC
    mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(3306), 'Allow MySQL access from VPC');
    this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.forEach(subnet => {
        mysqlSecurityGroup.addIngressRule(ec2.Peer.ipv4(subnet.ipv4CidrBlock), ec2.Port.tcp(3306), 'Allow MySQL access from VPC');
    });

    const subnetGroup = new rds.SubnetGroup(this, 'MySQLSubnetGroup', {
      subnetGroupName: `${config.envName}-mysql-subnet-group`,
      vpc,
      description: 'Subnet group for MySQL Aurora cluster',
      vpcSubnets: this.gdTrustedLandingZone.networking.dxDbSubnets,
    });

    // Create parameter group for cluster
    const parameterGroup = new rds.ParameterGroup(this, 'MySQLParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
      })
    });

    // Create parameter group for instances
    const instanceParameterGroup = new rds.ParameterGroup(this, 'MySQLInstanceParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
      })
    });

    // Create database credentials
    const credentials = rds.Credentials.fromGeneratedSecret('mysqladmin', {
      secretName: `${config.envName}-mysql-credentials`,
    });

    // Create the Aurora Serverless v2 MySQL cluster
    this.cluster = new rds.DatabaseCluster(this, 'MySQLCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_08_2,
      }),
      defaultDatabaseName: 'airo_builder',
      credentials,
      parameterGroup,
      storageEncrypted: true,
      storageEncryptionKey: kms.Key.fromKeyArn(this, 'MySQLKMSKey', this.gdTrustedLandingZone.accountInfo.kms.cmkArn),
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
      clusterIdentifier: `${config.envName}-mysql-cluster`,
      cloudwatchLogsExports: ['audit', 'general', 'error', 'slowquery'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
      vpc,
      subnetGroup,
      securityGroups: [mysqlSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Outputs
    new cdk.CfnOutput(this, 'MySQLClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      description: 'MySQL Aurora cluster endpoint',
      exportName: `${config.envName}-mysql-endpoint`,
    });
  }

}
