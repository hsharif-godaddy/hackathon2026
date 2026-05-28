import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'node:path';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import config from './config';

/**
 * Budget Service Lake Export
 *
 * Daily Python Lambda that snapshots budget-service Postgres tables to S3 as
 * Parquet files with Hive-style date partitions and the GoDaddy "_cln"
 * clean-layer naming convention:
 *   s3://airo-builder-budget-export-<env>/budget_management_system_cln/<table>_cln/year=YYYY/month=MM/day=DD/part-0.parquet
 * Downstream analytics (data lake) ingests from those prefixes via Glue/Athena.
 */
export class BudgetServiceLakeExportStack extends GDStack {
  public readonly exportLambda?: lambda.Function;
  public readonly exportBucket?: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const cfg = config.budgetServiceLakeExport;
    if (!cfg.dbUrlSecretName) {
      // Stack instantiated for an env that hasn't been wired up yet — emit
      // nothing so cdk synth/deploy succeeds. Fill in lib/config.ts to enable.
      return;
    }
    const dbUrlSecretArnPattern = `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${cfg.dbUrlSecretName}-*`;

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map(subnet =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId)
    ) || [];

    const lakeDatabaseName = 'budget-management-system-cln';
    const bucketName = `gd-airobuilde-${config.envName}-${lakeDatabaseName}-${config.region}`;
    this.exportBucket = new s3.Bucket(this, 'ExportBucket', {
      bucketName,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(365),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.envName !== 'prod',
    });

    this.exportBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        this.exportBucket.bucketArn,
        `${this.exportBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    }));

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'ExportLambdaSecurityGroup', {
      vpc,
      description: 'Security group for budget export Lambda',
      allowAllOutbound: true,
    });

    const exportRole = new iam.Role(this, 'ExportLambdaRole', {
      roleName: `${config.envName}-budget-export-role`,
      description: 'Lambda execution role for budget export',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        SecretsManagerAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [dbUrlSecretArnPattern],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt'],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
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

    this.exportBucket.grantWrite(exportRole);

    const logGroup = new logs.LogGroup(this, 'ExportLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-budget-export`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.exportLambda = new lambda.Function(this, 'ExportLambda', {
      functionName: `${config.envName}-budget-export`,
      description: 'Daily snapshot of budget-service Postgres tables to S3 (JSONL.gz, Hive-partitioned)',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      // Bundle Python deps from a fully self-contained tarball — every
      // runtime dependency (private gd-lake/gd-auth + public boto3,
      // pyarrow, psycopg[binary], cryptography, pyjwt, pydantic, etc.,
      // including all transitive deps) is pre-installed locally on a
      // developer machine and packed into vendored.tar.gz. Bundling
      // makes zero network calls — no public PyPI fetch, no supply-chain
      // surface from compromised/typo-squatted packages at build time.
      //
      // *** TEMPORARY: this whole vendoring scheme is a workaround until
      // this Lambda migrates into the data-lake team's existing build
      // pipeline, which has Artifactory pip auth wired up. Once that
      // lands, the tarball and the tar-xzf line below go away — the CI
      // will install everything from Artifactory like any other dep. ***
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/budget-service-lake-export'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            [
              'set -e',
              'tar xzf vendored.tar.gz -C /asset-output',
              'cp app.py /asset-output/',
            ].join('\n'),
          ],
        },
      }),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      role: exportRole,
      logGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      retryAttempts: 0,
      environment: {
        DB_URL_SECRET_NAME: cfg.dbUrlSecretName,
        OUTPUT_BUCKET: this.exportBucket.bucketName,
        ENV_NAME: config.envName,
      },
    });

    const schedule = new events.Rule(this, 'ExportSchedule', {
      ruleName: `${config.envName}-budget-export-schedule`,
      description: 'Daily snapshot of budget-service tables to the budget export bucket',
      schedule: events.Schedule.cron({ minute: '05', hour: '5' }),
    });
    schedule.addTarget(new targets.LambdaFunction(this.exportLambda));

    new cloudwatch.Alarm(this, 'ExportErrorsAlarm', {
      alarmName: `${config.envName}-budget-export-errors`,
      alarmDescription: 'Budget export Lambda raised one or more errors in the last 25 hours.',
      metric: this.exportLambda.metricErrors({
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.hours(25),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ExportStalenessAlarm', {
      alarmName: `${config.envName}-budget-export-staleness`,
      alarmDescription:
        'Budget export Lambda has not been invoked in the last 25 hours (expected daily at 5:05 UTC).',
      metric: this.exportLambda.metricInvocations({
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.hours(25),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    new cdk.CfnOutput(this, 'ExportLambdaArn', {
      value: this.exportLambda.functionArn,
      description: 'ARN of the budget export Lambda',
      exportName: `${config.envName}-budget-export-lambda-arn`,
    });
    new cdk.CfnOutput(this, 'ExportBucketName', {
      value: this.exportBucket.bucketName,
      description: 'S3 bucket holding daily budget-service table snapshots',
      exportName: `${config.envName}-budget-export-bucket`,
    });

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'budget-export');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
