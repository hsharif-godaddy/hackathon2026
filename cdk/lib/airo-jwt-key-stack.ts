import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Airo JWT Key Management Stack
 *
 * Manages automatic JWT signing key rotation using Node.js crypto and AWS Secrets Manager.
 * Keys are generated locally in Lambda and stored in Secrets Manager for use by the application.
 *
 * Features:
 * - Automatic key rotation on schedule
 * - Grace period for key transitions
 * - CloudWatch monitoring and alarms
 * - No KMS permissions required
 */
export class AiroJWTKeyStack extends GDStack {
  public readonly jwtSecretsManagerSecret: secretsmanager.Secret;
  public readonly keyRotationLambda: lambda.Function;
  public readonly appServiceRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Create Secrets Manager secret for storing JWT keys
    // Keys include both private and public keys in PEM format
    this.jwtSecretsManagerSecret = new secretsmanager.Secret(this, 'JWTKeysSecret', {
      secretName: `${config.envName}-airo-jwt-keys`,
      description: 'JWT signing keys (private and public) for airo-app',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: '{"keys":[],"lastRotation":null,"nextRotation":null}',
        excludeCharacters: '"@/\\'
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Create IAM role for Key Rotation Lambda
    const keyRotationRole = new iam.Role(this, 'KeyRotationLambdaRole', {
      roleName: `${config.envName}-airo-jwt-rotation-role`,
      description: 'Lambda execution role for JWT key rotation',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        SecretsManagerAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:PutSecretValue',
                'secretsmanager:UpdateSecret'
              ],
              resources: [this.jwtSecretsManagerSecret.secretArn]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
                'kms:GenerateDataKey'
              ],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`
                }
              }
            })
          ]
        })
      },
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'KeyRotationPermissionsBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      )
    });

    // Create CloudWatch Log Group for Lambda
    const keyRotationLogGroup = new logs.LogGroup(this, 'KeyRotationLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-airo-jwt-rotation`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create Key Rotation Lambda Function
    this.keyRotationLambda = new lambda.Function(this, 'KeyRotationLambda', {
      functionName: `${config.envName}-airo-jwt-rotation`,
      description: 'Automated JWT key rotation',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'key-rotation.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: keyRotationRole,
      logGroup: keyRotationLogGroup,
      environment: {
        SECRET_NAME: this.jwtSecretsManagerSecret.secretName,
        ENV_NAME: config.envName,
        KEY_EXPIRY_DAYS: config.jwt.keyExpiryDays.toString(),
        GRACE_PERIOD_DAYS: config.jwt.gracePeriodDays.toString(),
        ROTATION_INTERVAL_DAYS: config.jwt.rotationIntervalDays.toString()
      }
    });

    // Create EventBridge rule for scheduled key rotation
    const keyRotationRule = new events.Rule(this, 'KeyRotationSchedule', {
      ruleName: `${config.envName}-airo-jwt-rotation-schedule`,
      description: 'Scheduled JWT key rotation for Airo Builder',
      schedule: events.Schedule.rate(cdk.Duration.days(config.jwt.rotationIntervalDays))
    });

    // Add Lambda as target for the rule
    keyRotationRule.addTarget(new targets.LambdaFunction(this.keyRotationLambda, {
      retryAttempts: 2
    }));

    // Create IAM role for App Service to access JWT keys
    this.appServiceRole = new iam.Role(this, 'AppServiceJWTRole', {
      roleName: `${config.envName}-airo-app-jwt-read-role`,
      description: 'Role for App Service to read JWT keys for signing and verification',
      assumedBy: new iam.CompositePrincipal(
        ...config.katanaEcsTaskRoleArn.map(arn => new iam.ArnPrincipal(arn))
      ),
      inlinePolicies: {
        SecretsManagerReadAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue'
              ],
              resources: [this.jwtSecretsManagerSecret.secretArn]
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
        })
      },
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'AppServicePermissionsBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      )
    });

    // Create CloudWatch Alarms for monitoring
    const keyRotationFailureAlarm = new cdk.aws_cloudwatch.Alarm(this, 'KeyRotationFailureAlarm', {
      alarmName: `${config.envName}-airo-jwt-rotation-failures`,
      alarmDescription: 'JWT Key Rotation Lambda failures',
      metric: this.keyRotationLambda.metricErrors({
        period: cdk.Duration.minutes(1)
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING
    });

    const keyRotationDurationAlarm = new cdk.aws_cloudwatch.Alarm(this, 'KeyRotationDurationAlarm', {
      alarmName: `${config.envName}-airo-jwt-rotation-duration`,
      alarmDescription: 'JWT Key Rotation Lambda taking too long',
      metric: this.keyRotationLambda.metricDuration({
        period: cdk.Duration.minutes(1)
      }),
      threshold: 240000,
      evaluationPeriods: 1,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING
    });

    // Create CloudWatch Dashboard
    const dashboard = new cdk.aws_cloudwatch.Dashboard(this, 'JWTKeyManagementDashboard', {
      dashboardName: `${config.envName}-airo-jwt-management`,
      widgets: [
        [
          new cdk.aws_cloudwatch.GraphWidget({
            title: 'Key Rotation Lambda Invocations',
            left: [this.keyRotationLambda.metricInvocations()],
            right: [this.keyRotationLambda.metricErrors()],
            width: 12
          }),
          new cdk.aws_cloudwatch.GraphWidget({
            title: 'Key Rotation Lambda Duration',
            left: [this.keyRotationLambda.metricDuration()],
            width: 12
          })
        ]
      ]
    });

    // Outputs
    new cdk.CfnOutput(this, 'JWTSecretsManagerArn', {
      value: this.jwtSecretsManagerSecret.secretArn,
      description: 'ARN of the Secrets Manager secret containing JWT keys',
      exportName: `${config.envName}-airo-jwt-secret-arn`
    });

    new cdk.CfnOutput(this, 'JWTSecretsManagerName', {
      value: this.jwtSecretsManagerSecret.secretName,
      description: 'Name of the Secrets Manager secret containing JWT keys',
      exportName: `${config.envName}-airo-jwt-secret-name`
    });

    new cdk.CfnOutput(this, 'AppServiceJWTRoleArn', {
      value: this.appServiceRole.roleArn,
      description: 'ARN of the IAM role for App Service JWT operations',
      exportName: `${config.envName}-airo-jwt-app-role-arn`
    });

    new cdk.CfnOutput(this, 'KeyRotationLambdaArn', {
      value: this.keyRotationLambda.functionArn,
      description: 'ARN of the Key Rotation Lambda function',
      exportName: `${config.envName}-airo-jwt-lambda-arn`
    });

    // Add explicit dependencies for clean rollback
    keyRotationRole.node.addDependency(this.jwtSecretsManagerSecret);
    keyRotationLogGroup.node.addDependency(this.jwtSecretsManagerSecret);
    this.keyRotationLambda.node.addDependency(keyRotationRole);
    this.keyRotationLambda.node.addDependency(keyRotationLogGroup);
    keyRotationRule.node.addDependency(this.keyRotationLambda);
    this.appServiceRole.node.addDependency(this.jwtSecretsManagerSecret);
    keyRotationFailureAlarm.node.addDependency(this.keyRotationLambda);
    keyRotationDurationAlarm.node.addDependency(this.keyRotationLambda);
    dashboard.node.addDependency(this.keyRotationLambda);

    // Tag all resources
    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'jwt-key-management');
    cdk.Tags.of(this).add('Environment', config.envName);
  }

}
