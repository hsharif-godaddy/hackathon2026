import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AiroStripeServiceStack } from '../lib/airo-stripe-service-stack';

// Dev template (ENV_NAME=dev is the default in config.ts).
// stripeServiceTaskRoleArns is populated in dev config, so resource policies
// are synthesised and grants are attached.
let devTemplate: Template;

beforeAll(() => {
  process.env.ENV_NAME = 'dev';
  const app = new cdk.App();
  devTemplate = Template.fromStack(
    new AiroStripeServiceStack(app, 'AiroStripeServiceStack', {
      env: { account: '123456789012', region: 'us-west-2' },
    } as cdk.StackProps)
  );
});

describe('CfnOutputs — export names must match what stripe-service config.go expects', () => {
  it('exports the test platform-key secret ARN with -test suffix', () => {
    devTemplate.hasOutput('PlatformKeyTestSecretArn', {
      Export: { Name: 'dev-airo-stripe-platform-key-test-secret-arn' },
    });
  });

  it('exports the live platform-key secret ARN with -live suffix', () => {
    devTemplate.hasOutput('PlatformKeyLiveSecretArn', {
      Export: { Name: 'dev-airo-stripe-platform-key-live-secret-arn' },
    });
  });

  it('exports the webhook signing secret ARN', () => {
    devTemplate.hasOutput('WebhookSigningSecretArn', {
      Export: { Name: 'dev-airo-stripe-webhook-signing-secret-arn' },
    });
  });

  it('exports the sandboxes table ARN and name', () => {
    devTemplate.hasOutput('SandboxesTableArn', {
      Export: { Name: 'dev-airo-stripe-sandboxes-table-arn' },
    });
    devTemplate.hasOutput('SandboxesTableName', {
      Export: { Name: 'dev-airo-stripe-sandboxes-table-name' },
    });
  });

  it('exports the events table ARN and name', () => {
    devTemplate.hasOutput('EventsTableArn', {
      Export: { Name: 'dev-airo-stripe-events-table-arn' },
    });
    devTemplate.hasOutput('EventsTableName', {
      Export: { Name: 'dev-airo-stripe-events-table-name' },
    });
  });
});

describe('SecretsManager resource policies — Resource element must be present', () => {
  // Recent aws-cdk-lib versions synthesize a SecretsManager::ResourcePolicy
  // missing the Resource element, which CloudFormation rejects. These tests
  // catch a regression back to that behaviour.
  it('synthesizes exactly 3 resource policies (test + live platform keys + webhook)', () => {
    devTemplate.resourceCountIs('AWS::SecretsManager::ResourcePolicy', 3);
  });

  it('every statement in every resource policy has an explicit Resource element', () => {
    const policies = devTemplate.findResources('AWS::SecretsManager::ResourcePolicy');
    for (const [logicalId, policy] of Object.entries(policies)) {
      const statements: any[] = (policy as any).Properties.ResourcePolicy.Statement;
      for (const stmt of statements) {
        expect(stmt.Resource, `${logicalId} statement missing Resource element`).toBeDefined();
      }
    }
  });
});

describe('KMS CMK key policy — kms:GetPublicKey grant is present', () => {
  // key.grant() inlines actions into the key policy (no AWS::KMS::Grant
  // resource is created). Verify the managed-keys CMK policy contains all
  // three actions the stripe-service live-key mint flow requires.
  it('the managed-keys CMK key policy includes kms:GetPublicKey, kms:Decrypt, kms:DescribeKey', () => {
    const keys = devTemplate.findResources('AWS::KMS::Key');
    // Collect all array-valued Action fields (excludes the root admin "kms:*" string).
    const grantedActions = Object.values(keys).flatMap((key: any) =>
      key.Properties.KeyPolicy.Statement.filter((s: any) => Array.isArray(s.Action)).flatMap(
        (s: any) => s.Action as string[]
      )
    );
    expect(grantedActions).toContain('kms:GetPublicKey');
    expect(grantedActions).toContain('kms:Decrypt');
    expect(grantedActions).toContain('kms:DescribeKey');
  });
});

describe('WAFv2 WebACL — rule ordering', () => {
  // Allow is a terminating action: if AllowGatewayEgressIPs fires first, the
  // rate rule is never evaluated for legitimate gateway traffic and provides
  // zero protection. The rate rule must have a lower priority number.
  it('RateLimitWebhookEndpoint priority is lower than AllowGatewayEgressIPs priority', () => {
    const acls = devTemplate.findResources('AWS::WAFv2::WebACL');
    const rules: any[] = Object.values(acls)[0].Properties.Rules;
    const rateRule = rules.find((r: any) => r.Name === 'RateLimitWebhookEndpoint');
    const allowRule = rules.find((r: any) => r.Name === 'AllowGatewayEgressIPs');
    expect(rateRule, 'RateLimitWebhookEndpoint rule missing').toBeDefined();
    expect(allowRule, 'AllowGatewayEgressIPs rule missing').toBeDefined();
    expect(rateRule.Priority).toBeLessThan(allowRule.Priority);
    expect(rateRule.Action).toEqual({ Block: {} });
    expect(rateRule.Statement.RateBasedStatement.AggregateKeyType).toBe('FORWARDED_IP');
    expect(
      rateRule.Statement.RateBasedStatement.ScopeDownStatement.ByteMatchStatement.SearchString
    ).toBe('/webhooks/stripe');
  });

  // Route 53 health checkers hit the public ALB origin directly; their AWS-managed
  // source ranges aren't in the egress allowlist, so /health must be allowed by URI.
  it('AllowHealthCheck allows the /health path by exact URI match', () => {
    const acls: { [key: string]: any } = devTemplate.findResources('AWS::WAFv2::WebACL');
    const rules: any[] = Object.values(acls)[0].Properties.Rules;
    const healthRule: any = rules.find((r: any) => r.Name === 'AllowHealthCheck');
    expect(healthRule, 'AllowHealthCheck rule missing').toBeDefined();
    expect(healthRule.Action).toEqual({ Allow: {} });
    expect(healthRule.Statement.ByteMatchStatement.SearchString).toBe('/health');
    expect(healthRule.Statement.ByteMatchStatement.PositionalConstraint).toBe('EXACTLY');
    expect(healthRule.Statement.ByteMatchStatement.FieldToMatch).toEqual({ UriPath: {} });
  });
});

describe('prod hardening — deletionProtection and multiRegion', () => {
  let prodTemplate: Template;

  beforeAll(async () => {
    // config.ts reads ENV_NAME at module load time; vi.resetModules() clears
    // the Vitest module cache so the dynamic re-import picks up the new value.
    process.env.ENV_NAME = 'prod';
    vi.resetModules();
    const { AiroStripeServiceStack: ProdStack } = await import('../lib/airo-stripe-service-stack');
    const app = new cdk.App();
    prodTemplate = Template.fromStack(
      new ProdStack(app, 'ProdAiroStripeServiceStack', {
        env: { account: '644094189644', region: 'us-west-2' },
      } as cdk.StackProps)
    );
  });

  afterAll(() => {
    process.env.ENV_NAME = 'dev';
    vi.resetModules();
  });

  it('both DynamoDB tables have DeletionProtectionEnabled=true', () => {
    prodTemplate.resourceCountIs('AWS::DynamoDB::Table', 2);
    const tables = prodTemplate.findResources('AWS::DynamoDB::Table');
    for (const [logicalId, table] of Object.entries(tables)) {
      expect(
        (table as any).Properties.DeletionProtectionEnabled,
        `${logicalId} missing DeletionProtectionEnabled`
      ).toBe(true);
    }
  });

  it('the managed-keys CMK has MultiRegion=true', () => {
    prodTemplate.hasResourceProperties('AWS::KMS::Key', { MultiRegion: true });
  });

  it('dev tables do NOT have DeletionProtectionEnabled', () => {
    const tables = devTemplate.findResources('AWS::DynamoDB::Table');
    for (const [logicalId, table] of Object.entries(tables)) {
      expect(
        (table as any).Properties.DeletionProtectionEnabled,
        `Dev table ${logicalId} should not have DeletionProtectionEnabled`
      ).toBeUndefined();
    }
  });

  it('dev CMK does NOT have MultiRegion', () => {
    const keys = devTemplate.findResources('AWS::KMS::Key');
    for (const [logicalId, key] of Object.entries(keys)) {
      expect(
        (key as any).Properties.MultiRegion,
        `Dev CMK ${logicalId} should not have MultiRegion`
      ).toBeUndefined();
    }
  });
});
