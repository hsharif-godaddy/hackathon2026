import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'node:path';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import { AlarmUtil } from './AlarmUtil';
import config from './config';

/**
 * SupportPlane transcript sync Lambda (`sp-transcript-sync`).
 *
 * Runs once daily at 13:00 UTC via EventBridge cron (cron(0 13 * * ? *)).
 * CKP ETL uploads land 03:00–12:07 UTC; 13:00 provides a safe buffer.
 * Diffs the external CKP lighthouse S3 bucket against the internal transcripts
 * bucket using a persistent hash map (sync-state.json, stored at the root of
 * the internal bucket). Diff logic: key absent from map → new file; key present
 * but CKP LastModified > lastSyncDate → updated file. ETag is not used.
 * Copies new/updated CSVs into the internal bucket under uploads/, then
 * enqueues one {bucket, key} message per file into the ingest-jobs SQS queue
 * so the sp-transcript-ingest Lambda picks them up.
 *
 * Why cron and NOT S3 event notification:
 *   GD's permissions boundary `GD-AWS-SSG-PB-DEFAULT` denies
 *   `s3:PutBucketNotification`, which CDK's BucketNotificationsHandler
 *   (and the `eventBridgeEnabled` path) both call — identical constraint to
 *   FeedbackFanoutStack and SupportplaneTranscriptIngestStack. EventBridge
 *   scheduled rules do NOT call PutBucketNotification, so they are safe.
 *
 * Cross-account prerequisite:
 *   The CKP team must add the sync Lambda execution role ARN to the bucket
 *   policy of `gd-ckpetlbatch-prod-lighthouse-data`:
 *     Principal: arn:aws:iam::{account}:role/sp-transcript-sync-role-<env>
 *     Actions:   s3:GetObject, s3:ListBucket
 *     Resource:  arn:aws:s3:::gd-ckpetlbatch-prod-lighthouse-data{,/*}
 *
 *   Role convention for deploying / local testing:
 *     Dev:  GD-AWS-USA-GD-AiroBuilde-Dev-Private-PowerUser  OR  GD-AWS-USA-GD-AiroBuilde-Ops
 *     Prod: GD-AWS-USA-GD-AiroBuilde-Ops  (always Ops — no PowerUser in prod)
 *
 * Grants use deterministic ARN/URL strings (queue name and bucket names are
 * fixed per env) so this stack has no construct dependency on
 * SupportplaneTranscriptIngestStack or FeedbackL1TranscriptStack.
 */

// External CKP lighthouse bucket — cross-account, not owned by Airo.
const EXTERNAL_BUCKET = 'gd-ckpetlbatch-prod-lighthouse-data';
const EXTERNAL_PREFIX = 'lighthouse_export/';
const INTERNAL_BUCKET = `airo-builder-l1-transcripts-${config.envName}`;
// Copied transcripts land under uploads/ — separate from sync-state.json at bucket root.
const INTERNAL_PREFIX = 'uploads/';
const INGEST_JOBS_QUEUE_NAME = `airo-sp-transcript-ingest-jobs-${config.envName}`;

export class SupportplaneTranscriptSyncStack extends GDStack {
  public readonly syncLambda: lambda.Function;
  public readonly syncLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const ingestJobsQueueArn = `arn:aws:sqs:${config.region}:${config.account}:${INGEST_JOBS_QUEUE_NAME}`;
    const ingestJobsQueueUrl = `https://sqs.${config.region}.amazonaws.com/${config.account}/${INGEST_JOBS_QUEUE_NAME}`;
    const internalBucketArn = `arn:aws:s3:::${INTERNAL_BUCKET}`;
    const externalBucketArn = `arn:aws:s3:::${EXTERNAL_BUCKET}`;

    this.syncLambdaRole = new iam.Role(this, 'SyncTranscriptLambdaRole', {
      roleName: `sp-transcript-sync-role-${config.envName}`,
      description: 'Execution role for the SupportPlane transcript sync Lambda',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        // Read from the cross-account CKP bucket. The CKP team must also add
        // this role ARN to their bucket policy before reads will succeed.
        ExternalS3Read: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [externalBucketArn, `${externalBucketArn}/*`],
            }),
          ],
        }),
        // List internal objects for the diff; write copied files back.
        InternalS3ReadWrite: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
              resources: [internalBucketArn, `${internalBucketArn}/*`],
            }),
          ],
        }),
        // Send new-file job messages to the ingest Lambda's SQS queue.
        IngestQueueSend: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
              resources: [ingestJobsQueueArn],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'SyncLambdaLogGroup', {
      logGroupName: `/aws/lambda/sp-transcript-sync-${config.envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DLQ retains permanently-failed cron runs (0 retries on async invoke).
    const dlq = new sqs.Queue(this, 'SyncDLQ', {
      queueName: `airo-sp-transcript-sync-dlq-${config.envName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.syncLambda = new lambda.Function(this, 'SyncLambda', {
      functionName: `sp-transcript-sync-${config.envName}`,
      description:
        'Diff external CKP lighthouse S3 bucket vs. internal bucket; copy new/changed CSVs and enqueue ingest jobs',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(
          __dirname,
          '../../debug-console/supportplane/lambdas/sp-transcript-sync'
        ),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: [
              'bash',
              '-c',
              'cd /asset-input && npm install && npm run build && cp dist/*.js package.json /asset-output/ && cp -r node_modules /asset-output/',
            ],
            user: 'root',
          },
        }
      ),
      // Listing paginated S3 prefixes + copying files can take time on large
      // exports; 5 min matches the ingest Lambda timeout for consistency.
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: this.syncLambdaRole,
      logGroup,
      retryAttempts: 0,
      deadLetterQueue: dlq,
      environment: {
        ENV_NAME: config.envName,
        EXTERNAL_BUCKET,
        EXTERNAL_PREFIX,
        INTERNAL_BUCKET,
        INTERNAL_PREFIX,
        INGEST_JOBS_QUEUE_URL: ingestJobsQueueUrl,
      },
    });

    // EventBridge scheduled rule — fires once daily at 13:00 UTC.
    // CKP ETL batch uploads land between 03:00–12:07 UTC; 13:00 provides a
    // ~53-minute buffer past the latest observed upload. Files carry a ~2-day
    // processing lag so the exact pickup hour has no material freshness impact.
    // GD boundary denies s3:PutBucketNotification (same constraint as ingest
    // stack) so we poll on a schedule instead of reacting to bucket events.
    const schedule = new events.Rule(this, 'SyncSchedule', {
      ruleName: `sp-transcript-sync-schedule-${config.envName}`,
      description:
        'Trigger sp-transcript-sync daily at 13:00 UTC to diff and ingest new CKP lighthouse CSVs',
      schedule: events.Schedule.cron({ minute: '0', hour: '13' }),
    });
    schedule.addTarget(
      new targets.LambdaFunction(this.syncLambda, { retryAttempts: 0 })
    );

    AlarmUtil.createCloudWatchAlarm(
      this,
      'SyncDLQDepthAlarm',
      dlq.metricApproximateNumberOfMessagesVisible(),
      1,
      `P1: sp-transcript-sync DLQ has messages (${config.envName}) — a sync run permanently failed`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING
    );

    this.syncLambda.node.addDependency(this.syncLambdaRole);
    this.syncLambda.node.addDependency(logGroup);

    new cdk.CfnOutput(this, 'SyncLambdaArn', {
      value: this.syncLambda.functionArn,
      description: 'ARN of sp-transcript-sync — polls CKP bucket and feeds ingest queue',
      exportName: `${config.envName}-sp-transcript-sync-lambda-arn`,
    });
    new cdk.CfnOutput(this, 'SyncLambdaName', {
      value: this.syncLambda.functionName,
      description: 'Function name — use for direct invoke or manual test run',
      exportName: `${config.envName}-sp-transcript-sync-lambda-name`,
    });

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'sp-transcript-sync');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
