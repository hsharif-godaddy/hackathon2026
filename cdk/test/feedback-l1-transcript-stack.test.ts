import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

let devTemplate: Template;

beforeAll(async () => {
  process.env.ENV_NAME = 'dev';
  vi.resetModules();
  const app = new cdk.App();
  const { FeedbackL1TranscriptStack } = await import('../lib/feedback-l1-transcript-stack');
  devTemplate = Template.fromStack(
    new FeedbackL1TranscriptStack(app, 'FeedbackL1TranscriptStack', {
      env: { account: '694282668781', region: 'us-west-2' },
    } as cdk.StackProps)
  );
});

afterAll(() => {
  process.env.ENV_NAME = 'dev';
  vi.resetModules();
});

describe('FeedbackL1Transcript stack (dev)', () => {
  it('creates the L1 transcripts bucket', () => {
    devTemplate.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'airo-builder-l1-transcripts-dev',
    });
  });

  it('does not enable S3 bucket notifications (GD boundary denies PutBucketNotification)', () => {
    // sp-transcript-ingest is invoked directly (debug-console Sync/upload) or by a
    // future reconcile cron — not via eventBridgeEnabled / BucketNotificationsHandler.
    devTemplate.resourceCountIs('Custom::S3BucketNotifications', 0);
  });
});
