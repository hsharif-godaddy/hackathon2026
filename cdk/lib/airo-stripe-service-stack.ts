import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import config from './config';

/**
 * Airo Stripe Service Support Stack
 *
 * AWS data-plane dependencies for the stripe-service Go microservice. The
 * service runtime (ALB / ECS / ECR) is Katana-managed; this stack owns:
 *
 * - `${env}-airo-stripe-sandboxes` DynamoDB: sandbox_id → app_id routing,
 *   claim state, live account ID. GSI on app_id for agent status lookups.
 * - `${env}-airo-stripe-events` DynamoDB: webhook idempotency via 30-day TTL.
 * - RSA-2048 KMS CMK: decrypts Stripe Managed API Key material. Asymmetric,
 *   non-exportable, kms:Decrypt only (never Encrypt — Stripe encrypts with
 *   the public half).
 * - Two Secrets Manager secrets (created empty, populated out-of-band):
 *   the Stripe platform account API key and the webhook signing secret.
 *
 * Access is granted to `config.stripeServiceTaskRoleArns`. The list starts
 * empty until Katana provisions stripe-service in each env and its task
 * role ARN is discoverable; a follow-up re-deploy attaches the grants.
 */
export class AiroStripeServiceStack extends GDStack {
  public readonly sandboxesTable: dynamodb.Table;
  public readonly eventsTable: dynamodb.Table;
  public readonly managedKeysCmk: kms.Key;
  public readonly platformKeySecret: secretsmanager.Secret;
  public readonly webhookSigningSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const prodRemoval =
      config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.sandboxesTable = new dynamodb.Table(this, 'StripeSandboxesTable', {
      tableName: `${config.envName}-airo-stripe-sandboxes`,
      partitionKey: { name: 'sandbox_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: prodRemoval,
    });
    this.sandboxesTable.addGlobalSecondaryIndex({
      indexName: 'app_id-index',
      partitionKey: { name: 'app_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.eventsTable = new dynamodb.Table(this, 'StripeEventsTable', {
      tableName: `${config.envName}-airo-stripe-events`,
      partitionKey: { name: 'event_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: prodRemoval,
    });

    // Asymmetric KMS keys do not support automatic rotation; rotation is a
    // manual process (new key + Stripe re-upload of public half).
    this.managedKeysCmk = new kms.Key(this, 'StripeManagedKeysCmk', {
      description: `RSA-2048 CMK for Stripe Managed API Keys decryption (${config.envName})`,
      keySpec: kms.KeySpec.RSA_2048,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: prodRemoval,
      pendingWindow: cdk.Duration.days(30),
    });
    const managedKeysAlias = new kms.Alias(this, 'StripeManagedKeysAlias', {
      aliasName: `alias/${config.envName}-airo-stripe-managed-keys`,
      targetKey: this.managedKeysCmk,
    });
    managedKeysAlias.applyRemovalPolicy(prodRemoval);

    // Secrets are created with a placeholder; operators populate real values
    // out-of-band via `aws secretsmanager put-secret-value` once Stripe
    // credentials are provisioned for the platform account.
    //
    // RETAIN in all envs (including dev) because the plaintext values are
    // operator-managed. Trade-off: destroying + recreating this stack in dev
    // hits `ResourceExistsException` on the `${env}-airo-stripe-*` names
    // until AWS's orphan recovery window expires. Delete manually with
    // `aws secretsmanager delete-secret --force-delete-without-recovery`
    // first if you need to re-create the stack in dev.
    this.platformKeySecret = new secretsmanager.Secret(this, 'StripePlatformKeySecret', {
      secretName: `${config.envName}-airo-stripe-platform-key`,
      description: 'Stripe platform account secret key (sk_test_*/sk_live_*). Populated manually.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: '{"apiKey":"REPLACE_ME"}',
        excludeCharacters: '"@/\\',
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.webhookSigningSecret = new secretsmanager.Secret(this, 'StripeWebhookSigningSecret', {
      secretName: `${config.envName}-airo-stripe-webhook-signing`,
      description: 'Stripe webhook signing secret (whsec_*). Populated manually.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: '{"signingSecret":"REPLACE_ME"}',
        excludeCharacters: '"@/\\',
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Direct grants to stripe-service's Katana task role(s). Empty until the
    // service deploys and role ARNs are added to config.stripeServiceTaskRoleArns.
    //
    // Secrets use addToResourcePolicy rather than grantRead because the GD
    // safeguard library injects a placeholder KmsKeyId on every SecretsManager
    // secret, which makes grantRead's same-account detection think this is
    // cross-account and block the grant. Resource-policy grants bypass that
    // path and are equivalent for same-account IAM principals.
    if (config.stripeServiceTaskRoleArns.length > 0) {
      for (const arn of config.stripeServiceTaskRoleArns) {
        const principal = new iam.ArnPrincipal(arn);
        this.sandboxesTable.grantReadWriteData(principal);
        this.eventsTable.grantReadWriteData(principal);
        this.platformKeySecret.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            principals: [principal],
          })
        );
        this.webhookSigningSecret.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            principals: [principal],
          })
        );
        this.managedKeysCmk.grant(principal, 'kms:Decrypt', 'kms:DescribeKey');
      }
    }

    new cdk.CfnOutput(this, 'SandboxesTableArn', {
      value: this.sandboxesTable.tableArn,
      exportName: `${config.envName}-airo-stripe-sandboxes-table-arn`,
    });
    new cdk.CfnOutput(this, 'SandboxesTableName', {
      value: this.sandboxesTable.tableName,
      exportName: `${config.envName}-airo-stripe-sandboxes-table-name`,
    });
    new cdk.CfnOutput(this, 'EventsTableArn', {
      value: this.eventsTable.tableArn,
      exportName: `${config.envName}-airo-stripe-events-table-arn`,
    });
    new cdk.CfnOutput(this, 'EventsTableName', {
      value: this.eventsTable.tableName,
      exportName: `${config.envName}-airo-stripe-events-table-name`,
    });
    new cdk.CfnOutput(this, 'ManagedKeysCmkArn', {
      value: this.managedKeysCmk.keyArn,
      exportName: `${config.envName}-airo-stripe-managed-keys-cmk-arn`,
    });
    new cdk.CfnOutput(this, 'ManagedKeysCmkAlias', {
      value: `alias/${config.envName}-airo-stripe-managed-keys`,
      exportName: `${config.envName}-airo-stripe-managed-keys-alias`,
    });
    new cdk.CfnOutput(this, 'PlatformKeySecretArn', {
      value: this.platformKeySecret.secretArn,
      exportName: `${config.envName}-airo-stripe-platform-key-secret-arn`,
    });
    new cdk.CfnOutput(this, 'WebhookSigningSecretArn', {
      value: this.webhookSigningSecret.secretArn,
      exportName: `${config.envName}-airo-stripe-webhook-signing-secret-arn`,
    });

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'stripe-service');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
