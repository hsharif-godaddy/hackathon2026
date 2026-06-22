import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let devTemplate: Template;

beforeAll(async () => {
  process.env.ENV_NAME = 'dev';
  vi.resetModules();
  const app = new cdk.App();
  const { SupportplaneDynamoStack } = await import('../lib/supportplane-dynamodb-stack');
  devTemplate = Template.fromStack(
    new SupportplaneDynamoStack(app, 'SupportplaneDynamoStack', {
      env: { account: '694282668781', region: 'us-west-2' },
    } as cdk.StackProps)
  );
});

describe('SupportPlane DynamoDB stack (dev)', () => {
  it('creates seven tables for SupportPlane', () => {
    devTemplate.resourceCountIs('AWS::DynamoDB::Table', 7);
  });

  it('transcripts table uses interaction_id and created_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-l1-transcript-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'interaction_id', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('uploads table uses upload_id and uploaded_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-l1-upload-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'upload_id', KeyType: 'HASH' },
        { AttributeName: 'uploaded_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('analytics table uses metric_type and created_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-l1-analytics-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'metric_type', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('feedback table uses feedback_id and created_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-feedback-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'feedback_id', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('feedback-stats table uses date_env and app_id keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-feedback-stats-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'date_env', KeyType: 'HASH' },
        { AttributeName: 'app_id', KeyType: 'RANGE' },
      ],
    });
  });

  it('feedback-ingest table uses ingest_key and created_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-feedback-ingest-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'ingest_key', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('tickets table uses ticket_key and created_at keys', () => {
    devTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'airo-builde-supportplane-tickets-dev',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'ticket_key', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
    });
  });

  it('exports table names for debug-console wiring', () => {
    devTemplate.hasOutput('SupportplaneTranscriptsTableName', {
      Export: { Name: 'airo-builde-supportplane-l1-transcript-table-name-dev' },
    });
    devTemplate.hasOutput('SupportplaneUploadsTableName', {
      Export: { Name: 'airo-builde-supportplane-l1-upload-table-name-dev' },
    });
    devTemplate.hasOutput('SupportplaneAnalyticsTableName', {
      Export: { Name: 'airo-builde-supportplane-l1-analytics-table-name-dev' },
    });
  });
});

describe('SupportPlane DynamoDB stack (prod hardening)', () => {
  let prodTemplate: Template;

  beforeAll(async () => {
    process.env.ENV_NAME = 'prod';
    vi.resetModules();
    const { SupportplaneDynamoStack: ProdStack } = await import(
      '../lib/supportplane-dynamodb-stack'
    );
    const app = new cdk.App();
    prodTemplate = Template.fromStack(
      new ProdStack(app, 'ProdSupportplaneDynamoStack', {
        env: { account: '644094189644', region: 'us-west-2' },
      } as cdk.StackProps)
    );
  });

  afterAll(() => {
    process.env.ENV_NAME = 'dev';
    vi.resetModules();
  });

  it('enables deletion protection for prod tables', () => {
    const tables = prodTemplate.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables)) {
      expect((table as any).Properties.DeletionProtectionEnabled).toBe(true);
    }
  });
});
