import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
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
 *   non-exportable. The task role gets kms:GetPublicKey (to hand Stripe the
 *   public half so it wraps the CEK against it) and kms:Decrypt (to unwrap
 *   the wrapped CEK) — never Encrypt; Stripe encrypts with the public half.
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
  public readonly platformKeyTestSecret: secretsmanager.Secret;
  public readonly platformKeyLiveSecret: secretsmanager.Secret;
  public readonly webhookSigningSecret: secretsmanager.Secret;
  public readonly gatewayWebAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const prodRemoval =
      config.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Forward-compat hedge for a future Tier 2 us-east-1 warm standby (see
    // STRIPE_INTEGRATION_PLAN.md §10.4): create the prod CMK as a multi-region
    // PRIMARY now, while still deploying single-region. KMS `multiRegion` is
    // immutable after key creation, and prod's CMK is provisioned fresh on
    // first deploy — this is the one moment to set it. A multi-region primary
    // with no replicas behaves identically to a single-region key (same price,
    // material stays in-region) but lets us add a us-east-1 replica later
    // WITHOUT a new CMK + re-mint of every merchant's Managed API Keys.
    // undefined (not false) for dev/test so the property is omitted entirely —
    // those keys already exist single-region and KMS rejects any MultiRegion change.
    const multiRegionKey = config.envName === 'prod' ? true : undefined;

    // DynamoDB-native deletion protection (prod only). Distinct from the CFN
    // RemovalPolicy.RETAIN above: RETAIN stops CloudFormation from deleting the
    // table on stack/resource removal, but does NOT block a direct DeleteTable
    // API/console call. deletionProtection blocks that too. dev/test stay off so
    // they remain easy to tear down and recreate. Non-disruptive to toggle.
    const prodDeletionProtection = config.envName === 'prod' ? true : undefined;

    this.sandboxesTable = new dynamodb.Table(this, 'StripeSandboxesTable', {
      tableName: `${config.envName}-airo-stripe-sandboxes`,
      partitionKey: { name: 'sandbox_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: prodRemoval,
      deletionProtection: prodDeletionProtection,
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
      deletionProtection: prodDeletionProtection,
    });

    // Asymmetric KMS keys do not support automatic rotation; rotation is a
    // manual process (new key + Stripe re-upload of public half).
    //
    // multiRegion (prod only): provisions a multi-region PRIMARY so a us-east-1
    // replica can be added later without re-issuing the public half. No replica
    // exists today — the service runs single-region (us-west-2). See the
    // multiRegionKey comment above for why this is set at creation.
    this.managedKeysCmk = new kms.Key(this, 'StripeManagedKeysCmk', {
      description: `RSA-2048 CMK for Stripe Managed API Keys decryption (${config.envName})`,
      keySpec: kms.KeySpec.RSA_2048,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      multiRegion: multiRegionKey,
      removalPolicy: prodRemoval,
      pendingWindow: cdk.Duration.days(30),
    });
    const managedKeysAlias = new kms.Alias(this, 'StripeManagedKeysAlias', {
      aliasName: `alias/${config.envName}-airo-stripe-managed-keys`,
      targetKey: this.managedKeysCmk,
    });
    managedKeysAlias.applyRemovalPolicy(prodRemoval);

    // Two platform-key secrets, one per Stripe mode. Stripe's preview APIs
    // are mode-scoped: claimableSandboxes.create runs only in test mode
    // (sandboxes are test-mode constructs), apiKeys.create against a
    // claimed live merchant requires the platform's sk_live key. Both
    // operations occur in the same merchant lifecycle, so every env that
    // serves real merchants needs both keys loaded. See plan §4.2.1.
    //
    // The legacy single-secret name (`${env}-airo-stripe-platform-key`,
    // observed empirically to fail one mode or the other depending on the
    // populated value) is no longer provisioned by this stack. In dev and
    // test where the legacy secret was already created, RemovalPolicy.RETAIN
    // on the prior CFN resource leaves it orphaned in AWS — operators can
    // delete those manually with
    // `aws secretsmanager delete-secret --force-delete-without-recovery`
    // once the new test/live secrets are populated. Prod has not yet
    // deployed the legacy secret, so prod gets a clean two-secret state
    // from the start.
    //
    // Secrets are created with placeholders; operators populate real values
    // out-of-band via `aws secretsmanager put-secret-value`. RETAIN in all
    // envs because the plaintext values are operator-managed. Trade-off:
    // destroying + recreating this stack in dev hits `ResourceExistsException`
    // on the `${env}-airo-stripe-*` names until AWS's orphan recovery
    // window expires.
    this.platformKeyTestSecret = new secretsmanager.Secret(this, 'StripePlatformKeyTestSecret', {
      secretName: `${config.envName}-airo-stripe-platform-key-test`,
      description:
        'Stripe platform TEST-mode secret key (sk_test_*). Used for ' +
        'claimableSandboxes.create in every env (dev, test, prod) — sandboxes ' +
        'are test-mode constructs and the API only exists in test mode. ' +
        'Populated manually. Required for stripe-service to start.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: '{"apiKey":"REPLACE_ME"}',
        excludeCharacters: '"@/\\',
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.platformKeyLiveSecret = new secretsmanager.Secret(this, 'StripePlatformKeyLiveSecret', {
      secretName: `${config.envName}-airo-stripe-platform-key-live`,
      description:
        'Stripe platform LIVE-mode secret key (sk_live_*). Used for ' +
        'apiKeys.create on claimed live merchant accounts (go-live mint). ' +
        'Populated manually. Optional in dev/test envs — leave at REPLACE_ME ' +
        "if you don't run the live-key flow there; stripe-service will boot " +
        'with sandbox-only capability and surface a clear error if MintLiveAPIKeys ' +
        'is invoked. Required in prod.',
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
        // SecretsManager::ResourcePolicy requires explicit Resource in the
        // policy JSON; recent aws-cdk-lib versions no longer auto-fill "*"
        // when omitted, so include it. The policy is attached to a specific
        // secret, so "*" here scopes to "this secret only" — same shape as
        // dev-private's deployed policy.
        this.platformKeyTestSecret.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            principals: [principal],
            resources: ['*'],
          })
        );
        this.platformKeyLiveSecret.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            principals: [principal],
            resources: ['*'],
          })
        );
        this.webhookSigningSecret.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            principals: [principal],
            resources: ['*'],
          })
        );
        this.managedKeysCmk.grant(principal, 'kms:Decrypt', 'kms:DescribeKey', 'kms:GetPublicKey');
      }
    }

    // WAFv2 WebACL restricting ALB ingress to the Edge Gateway egress IPs.
    // Default action is Block — only requests from the named CIDRs are allowed
    // through. Katana's WAF ARN field references this WebACL so the ALB rejects
    // anything that bypasses the frontdoor gateway directly.
    // CIDRs: env-specific NAT IPs (PCP 6702, us-west-2) + TGW ranges required
    // for services with public origins (see config.stripeGatewayEgressCidrs).
    const gatewayIpSet = new wafv2.CfnIPSet(this, 'StripeGatewayEgressIpSet', {
      name: `${config.envName}-airo-stripe-gateway-egress`,
      scope: 'REGIONAL',
      ipAddressVersion: 'IPV4',
      addresses: config.stripeGatewayEgressCidrs,
    });

    this.gatewayWebAcl = new wafv2.CfnWebACL(this, 'StripeGatewayWebAcl', {
      name: `${config.envName}-airo-stripe-gateway-allowlist`,
      scope: 'REGIONAL',
      defaultAction: { block: {} },
      rules: [
        {
          name: 'AllowGatewayEgressIPs',
          priority: 0,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: { arn: gatewayIpSet.attrArn },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: `${config.envName}-airo-stripe-allow-gateway`,
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${config.envName}-airo-stripe-gateway-allowlist`,
      },
    });

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
    new cdk.CfnOutput(this, 'PlatformKeyTestSecretArn', {
      value: this.platformKeyTestSecret.secretArn,
      exportName: `${config.envName}-airo-stripe-platform-key-test-secret-arn`,
    });
    new cdk.CfnOutput(this, 'PlatformKeyLiveSecretArn', {
      value: this.platformKeyLiveSecret.secretArn,
      exportName: `${config.envName}-airo-stripe-platform-key-live-secret-arn`,
    });
    new cdk.CfnOutput(this, 'WebhookSigningSecretArn', {
      value: this.webhookSigningSecret.secretArn,
      exportName: `${config.envName}-airo-stripe-webhook-signing-secret-arn`,
    });

    new cdk.CfnOutput(this, 'GatewayWebAclArn', {
      value: this.gatewayWebAcl.attrArn,
      exportName: `${config.envName}-airo-stripe-gateway-webacl-arn`,
    });

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'stripe-service');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
