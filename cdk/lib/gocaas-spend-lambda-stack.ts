import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'node:path';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * GoCode Spend ESSP Exporter Stack
 * 
 * Manages automated syncing of LLM spend logs from GoCode API to Elasticsearch (ESSP).
 * Pulls logs periodically and indexes them for analysis and visualization.
 * 
 * Features:
 * - Automatic log sync on schedule (daily at 2 AM UTC)
 * - AWS IAM role assumption for GoCode API access
 * - Uses existing Secrets Manager secret for ESSP credentials
 * - CloudWatch Logs for execution tracking
 */
export class GocaasSpendLambdaStack extends GDStack {
  public readonly syncLambda: lambda.Function;
  public readonly syncLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Import VPC and subnets from trusted landing zone
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map(subnet =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId)
    ) || [];

    // Create security group for Lambda
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for GoCode spend sync Lambda',
      allowAllOutbound: true
    });

    // Import the GoCode access role from AiroBuilderStack
    const gocodeAccessRole = iam.Role.fromRoleArn(
      this,
      'GoCodeAccessRole',
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/airobuilde-custom-${config.envName}-airo-builder-gocode-access`
    );

    // Create IAM role for Sync Lambda
    this.syncLambdaRole = new iam.Role(this, 'SyncLambdaRole', {
      roleName: `${config.envName}-gocode-spend-sync-role`,
      description: 'Lambda execution role for GoCode spend log sync to ESSP',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
      ],
      inlinePolicies: {
        SecretsManagerAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue'
              ],
              resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:essp_deployment_credentials*`]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt'
              ],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`
                }
              }
            })
          ]
        }),
        STSAssumeRole: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sts:AssumeRole'
              ],
              resources: [gocodeAccessRole.roleArn]
            })
          ]
        })
      }
    });

    // Create CloudWatch Log Group for Lambda
    const syncLogGroup = new logs.LogGroup(this, 'SyncLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-gocode-spend-sync`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create Sync Lambda Function with bundling
    this.syncLambda = new lambda.Function(this, 'SyncLambda', {
      functionName: `${config.envName}-gocode-spend-sync`,
      description: 'Sync LLM spend logs from GoCode API to Elasticsearch (ESSP)',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/gocode-spend-essp-exporter'), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash', '-c',
            'cd /asset-input && npm install && npm run build && cp dist/index.js dist/handler.js package.json /asset-output/ && cp -r node_modules /asset-output/'
          ],
          user: 'root'
        }
      }),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: this.syncLambdaRole,
      logGroup: syncLogGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        SECRET_NAME: 'essp_deployment_credentials',
        ENV_NAME: config.envName,
        AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID
      }
    });

    // Create EventBridge rule for scheduled sync (daily at 2 AM UTC)
    const syncScheduleRule = new events.Rule(this, 'SyncSchedule', {
      ruleName: `${config.envName}-gocode-spend-sync-schedule`,
      description: 'Scheduled sync of GoCode spend logs to Elasticsearch',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*'
      })
    });

    // Add Lambda as target for the rule
    syncScheduleRule.addTarget(new targets.LambdaFunction(this.syncLambda));

    // Outputs
    new cdk.CfnOutput(this, 'SyncLambdaArn', {
      value: this.syncLambda.functionArn,
      description: 'ARN of the GoCode spend sync Lambda function',
      exportName: `${config.envName}-gocode-sync-lambda-arn`
    });

    new cdk.CfnOutput(this, 'SyncScheduleRuleName', {
      value: syncScheduleRule.ruleName,
      description: 'Name of the EventBridge rule for scheduled sync',
      exportName: `${config.envName}-gocode-sync-schedule-name`
    });

    // Add explicit dependencies for clean rollback
    this.syncLambda.node.addDependency(this.syncLambdaRole);
    this.syncLambda.node.addDependency(syncLogGroup);
    syncScheduleRule.node.addDependency(this.syncLambda);

    // Tag all resources
    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'gocode-spend-sync');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}

