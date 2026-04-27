import * as path from 'node:path';

import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import config from "./config";

// Same JSON secret consumed by .github/workflows/langfuse-metrics-ingest.yml.
// Shape: { LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY }.
const LANGFUSE_SECRET_NAME = 'langfuse_test';
const ES_SECRET_NAME = 'essp_deployment_credentials';

/**
 * Langfuse Metrics ESSP Exporter Stack
 *
 * Pulls hourly observation metrics from Langfuse and indexes them into the
 * `langfuse-metrics-hourly` ESSP index. Runs every 5 minutes against a
 * trailing 1-hour window so the latest hour's bucket is continually upserted
 * (idempotent doc IDs based on type/name/model/hour).
 *
 * Runs inside the trusted-landing-zone VPC: self-hosted Langfuse and the ESSP
 * ingestion endpoint are both internal-only, so the Lambda needs DX-app
 * subnet egress (mirrors gocaas-spend-lambda-stack.ts).
 */
export class LangfuseMetricsEsspExporterStack extends GDStack {
  public readonly syncLambda: lambda.Function;
  public readonly syncLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
    const rawSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets;
    if (!rawSubnets?.length) {
      throw new Error(
        'dxAppSubnets returned no subnets; cannot deploy Lambda into VPC without at least one subnet'
      );
    }
    const privateSubnets = rawSubnets.map(subnet =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId)
    );

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Langfuse metrics sync Lambda',
      allowAllOutbound: true,
    });

    this.syncLambdaRole = new iam.Role(this, 'SyncLambdaRole', {
      roleName: `${config.envName}-langfuse-metrics-sync-role`,
      description: 'Lambda execution role for Langfuse metrics sync to ESSP',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        SecretsManagerAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${LANGFUSE_SECRET_NAME}*`,
                `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${ES_SECRET_NAME}*`,
              ],
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
      },
    });

    const syncLogGroup = new logs.LogGroup(this, 'SyncLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-langfuse-metrics-sync`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.syncLambda = new lambda.Function(this, 'SyncLambda', {
      functionName: `${config.envName}-langfuse-metrics-sync`,
      description: 'Sync Langfuse hourly observation metrics into Elasticsearch (ESSP)',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/langfuse-metrics-essp-exporter'), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash', '-c',
            'cd /asset-input && npm ci --ignore-scripts && npm run build && cp dist/*.js package.json /asset-output/ && cp -r node_modules /asset-output/',
          ],
          user: 'root',
        },
      }),
      // Five sequential Langfuse calls (~1-3s each) plus ES bulk write (~1s).
      // Three minutes leaves headroom for Langfuse 5xx retry budgets (linear
      // backoff up to ~30s aggregate) without bumping into the cron cadence.
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      role: this.syncLambdaRole,
      logGroup: syncLogGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      retryAttempts: 0,
      environment: {
        LANGFUSE_SECRET_NAME,
        ES_SECRET_NAME,
        ENV_NAME: config.envName,
        AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      },
    });

    const syncScheduleRule = new events.Rule(this, 'SyncSchedule', {
      ruleName: `${config.envName}-langfuse-metrics-sync-schedule`,
      description: 'Scheduled sync of Langfuse hourly metrics to Elasticsearch',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });

    syncScheduleRule.addTarget(new targets.LambdaFunction(this.syncLambda));

    new cdk.CfnOutput(this, 'SyncLambdaArn', {
      value: this.syncLambda.functionArn,
      description: 'ARN of the Langfuse metrics sync Lambda function',
      exportName: `${config.envName}-langfuse-metrics-sync-lambda-arn`,
    });

    new cdk.CfnOutput(this, 'SyncScheduleRuleName', {
      value: syncScheduleRule.ruleName,
      description: 'Name of the EventBridge rule for scheduled sync',
      exportName: `${config.envName}-langfuse-metrics-sync-schedule-name`,
    });

    this.syncLambda.node.addDependency(this.syncLambdaRole);
    this.syncLambda.node.addDependency(syncLogGroup);
    syncScheduleRule.node.addDependency(this.syncLambda);

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'langfuse-metrics-sync');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
