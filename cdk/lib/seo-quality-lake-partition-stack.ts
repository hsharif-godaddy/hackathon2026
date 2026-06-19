import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'node:path';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

/**
 * Hourly DLMS partition registration for SEO quality Parquet files in
 * airo-builder-marketing-{env}. BFF writes under partition_utc_* keys;
 * this Lambda calls LakeApiClient.add_partition for the previous UTC hour.
 *
 * Runs in VPC private subnets so gd-auth can reach iam-token SSO endpoints.
 */
export class SeoQualityLakePartitionStack extends GDStack {
  public readonly partitionLambda?: lambda.Function;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const cfg = config.seoQualityLakePartition;
    if (!cfg.lakeDatabaseName) {
      return;
    }

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map(subnet =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId),
    ) || [];

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'PartitionLambdaSecurityGroup', {
      vpc,
      description: 'Security group for SEO quality lake partition Lambda',
      allowAllOutbound: true,
    });

    const partitionRole = new iam.Role(this, 'PartitionLambdaRole', {
      roleName: `${config.envName}-seo-quality-lake-partition-role`,
      description: 'Registers hourly DLMS partitions for SEO quality lake table',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT',
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        DlmsApiAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['execute-api:Invoke'],
              resources: [
                `arn:aws:execute-api:${cdk.Aws.REGION}:028140660016:*`,
                ...config.awsIamJwtAccount.map(account => `arn:aws:execute-api:*:${account}:*`),
              ],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'PartitionLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-seo-quality-lake-partition`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.partitionLambda = new lambda.Function(this, 'PartitionLambda', {
      functionName: `${config.envName}-seo-quality-lake-partition`,
      description: 'Hourly DLMS add_partition for SEO quality snapshot table',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/seo-quality-lake-partition'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          // Mount the shared vendored.tar.gz from budget-service-lake-export into the
          // container — Docker only mounts the asset directory, so ../ paths don't work.
          volumes: [
            {
              hostPath: path.join(__dirname, '../lambda/budget-service-lake-export/vendored.tar.gz'),
              containerPath: '/vendored.tar.gz',
            },
          ],
          command: [
            'bash',
            '-c',
            [
              'set -e',
              'tar xzf /vendored.tar.gz -C /asset-output',
              'cp app.py /asset-output/',
            ].join('\n'),
          ],
        },
      }),
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      role: partitionRole,
      logGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      retryAttempts: 0,
      environment: {
        LAKE_API_ENV: cfg.lakeApiEnv,
        LAKE_DATABASE_NAME: cfg.lakeDatabaseName,
        LAKE_TABLE_NAME: cfg.lakeTableName,
      },
    });

    const schedule = new events.Rule(this, 'PartitionSchedule', {
      ruleName: `${config.envName}-seo-quality-lake-partition-schedule`,
      description: 'Register previous UTC hour partition in DLMS for SEO quality table',
      schedule: events.Schedule.cron({ minute: '5', hour: '*' }),
    });
    schedule.addTarget(new targets.LambdaFunction(this.partitionLambda));

    new cloudwatch.Alarm(this, 'PartitionErrorsAlarm', {
      alarmName: `${config.envName}-seo-quality-lake-partition-errors`,
      alarmDescription: 'SEO quality lake partition Lambda raised an error in the last 2 hours.',
      metric: this.partitionLambda.metricErrors({
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.hours(2),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'PartitionStalenessAlarm', {
      alarmName: `${config.envName}-seo-quality-lake-partition-staleness`,
      alarmDescription:
        'SEO quality lake partition Lambda has not run in the last 2 hours (expected hourly at :05 UTC).',
      metric: this.partitionLambda.metricInvocations({
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.hours(2),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    new cdk.CfnOutput(this, 'PartitionLambdaArn', {
      value: this.partitionLambda.functionArn,
      description: 'ARN of the SEO quality DLMS partition registration Lambda',
      exportName: `${config.envName}-seo-quality-lake-partition-lambda-arn`,
    });

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'seo-quality-lake-partition');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
