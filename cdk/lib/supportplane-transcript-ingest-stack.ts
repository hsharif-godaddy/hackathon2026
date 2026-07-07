import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'node:path';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import { AlarmUtil } from './AlarmUtil';
import config from './config';

/**
 * SupportPlane transcript ingestion Lambda (`sp-transcript-ingest`).
 *
 * This stack provisions TWO Lambdas + TWO SQS queues:
 *   1. `sp-transcript-ingest` — parse a transcript export (XLSX/CSV), upsert rows,
 *      update rollups, and fan out one record-processing job per row. Invoked (a)
 *      DIRECTLY by debug-console after an upload (InvocationType=Event), and (b) via
 *      the `ingest-jobs` queue that the sp-transcript-sync Lambda (cron + UI Sync) fills.
 *   2. `sp-transcript-record-processing` — SQS worker off the
 *      `record-processing-jobs` queue that processes ONE row (enhance, enrich,
 *      persist to DynamoDB as needed).
 *
 * There is NO S3 → Lambda / EventBridge-on-S3 wiring: GD's permissions boundary
 * `GD-AWS-SSG-PB-DEFAULT` denies `s3:PutBucketNotification`, which CDK's
 * BucketNotificationsHandler (and the `eventBridgeEnabled` path) both call —
 * same constraint as FeedbackFanoutStack (see feedback-fanout-stack.ts).
 *
 * Why record processing is a separate SQS worker (not inline in ingest): real files are
 * 450–3,224 rows and Beacon is seconds/call, exceeding a single 300s invocation.
 * Decoupling behind SQS gives a concurrency-capped, retryable, durable drain.
 * Both handlers are fully implemented: ingest parses/upserts/fan-out; record-processing
 * enriches via Beacon /api/ask (primary) and GoCode (fallback).
 *
 * Networking / auth: both Lambdas run IN the VPC (ec2.Vpc.fromLookup + a security
 * group) so record-processing can reach the internal SSO / IAM-JWT gateway and Beacon.
 * The record-processing execution role assumes the generic S2S IAM-JWT role
 * (airobuilde-custom-{env}-s2s-iam-jwt-access; the execution role ARN is added to
 * config.s2sIamJwtAssumeRoleArns so the S2S role's trust policy permits the assume)
 * to mint the `sso-jwt` for Beacon /api/ask and GoCode; SSO_HOST + S2S_IAM_JWT_ROLE_ARN
 * are passed as env vars on record-processing. Beacon must allow-list the S2S role ARN.
 *
 * Grants use deterministic ARN strings (table + bucket names are fixed per
 * env) so this stack has no construct dependency on SupportplaneDynamoStack or
 * FeedbackL1TranscriptStack.
 */
const TABLE_PREFIX = 'airo-builde-supportplane';
const TRANSCRIPTS_BUCKET = `airo-builder-l1-transcripts-${config.envName}`;

export class SupportplaneTranscriptIngestStack extends GDStack {
  public readonly ingestLambda: lambda.Function;
  public readonly ingestLambdaRole: iam.Role;
  public readonly recordProcessingLambda: lambda.Function;
  public readonly recordProcessingLambdaRole: iam.Role;
  public readonly ingestJobsQueue: sqs.Queue;
  public readonly recordProcessingJobsQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const transcriptsTable: string = `${TABLE_PREFIX}-l1-transcript-${config.envName}`;
    const uploadsTable: string = `${TABLE_PREFIX}-l1-upload-${config.envName}`;
    const analyticsTable: string = `${TABLE_PREFIX}-l1-analytics-${config.envName}`;

    const tableArn = (name: string): string =>
      `arn:aws:dynamodb:${config.region}:${config.account}:table/${name}`;
    const dynamoResources: string[] = [transcriptsTable, uploadsTable, analyticsTable].flatMap(
      (name) => [tableArn(name), `${tableArn(name)}/index/*`]
    );
    const bucketArn: string = `arn:aws:s3:::${TRANSCRIPTS_BUCKET}`;
    // Beacon auth: the handler assumes this generic S2S IAM-JWT role to mint the
    // `sso-jwt` that Beacon /api/ask requires. Beacon allow-lists THIS role's ARN
    // (not the lambda execution role). Created by S2sIamJwtStack.
    const s2sIamJwtRoleArn: string = `arn:aws:iam::${config.account}:role/airobuilde-custom-${config.envName}-s2s-iam-jwt-access`;
    const ssoHost: string =
      config.envName === 'prod' ? 'sso.godaddy.com' :
      config.envName === 'test' ? 'sso.test-godaddy.com' :
      'sso.dev-godaddy.com';

    this.ingestLambdaRole = new iam.Role(this, 'IngestLambdaRole', {
      roleName: `${config.envName}-sp-transcript-ingest-role`,
      description: 'Execution role for the SupportPlane transcript ingest Lambda',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        // VPC access: the Lambda runs in the VPC to reach the internal SSO / IAM-JWT
        // gateway and Beacon (Katana). Manages the ENIs.
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        DynamoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
              resources: dynamoResources,
            }),
          ],
        }),
        S3ReadAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [bucketArn, `${bucketArn}/*`],
            }),
          ],
        }),
        // Beacon auth: assume the generic S2S IAM-JWT role, which mints the
        // `sso-jwt` (it holds execute-api:Invoke on the IAM-JWT gateway) that
        // Beacon /api/ask requires. Beacon allow-lists the ASSUMED role's ARN
        // (airobuilde-custom-{env}-s2s-iam-jwt-access), not this execution role;
        // this execution role is added to config.s2sIamJwtAssumeRoleArns so the
        // S2S role's trust policy permits the assume.
        S2sAssumeRole: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sts:AssumeRole'],
              resources: [s2sIamJwtRoleArn],
            }),
          ],
        }),
        // Misc runtime credentials (e.g., GoCode fallback / log correlation),
        // scoped to the console secret prefix. Not the Beacon path (that is IAM-JWT).
        SecretsRead: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/Katana/Secrets/airobuilde/console/*`,
              ],
            }),
          ],
        }),
      },
    });

    const logGroup: logs.LogGroup = new logs.LogGroup(this, 'IngestLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-sp-transcript-ingest`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dead-letter queue for async-invoke failures (direct invoke with
    // InvocationType=Event). With retryAttempts: 0 a throwing delivery would
    // otherwise be dropped silently. The DLQ retains it 14 days for inspection /
    // replay, and the alarm below pages on any depth. Mirrors
    // feedback-fanout-stack.ts / investigator-stack.ts.
    const dlq: sqs.Queue = new sqs.Queue(this, 'IngestDLQ', {
      queueName: `airo-sp-transcript-ingest-dlq-${config.envName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Run in the VPC so the handler can reach the internal SSO / IAM-JWT gateway
    // and Beacon (Katana). Mirrors the gocaas-spend lambda networking.
    const vpc: ec2.IVpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: this.gdTrustedLandingZone.networking.vpcId,
    });
    const privateSubnets: ec2.ISubnet[] =
      this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map((subnet) =>
        ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId)
      ) ?? [];
    const securityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      'IngestLambdaSecurityGroup',
      {
        vpc,
        description: 'Security group for the SupportPlane transcript ingest Lambda',
        allowAllOutbound: true,
      }
    );

    this.ingestLambda = new lambda.Function(this, 'IngestLambda', {
      functionName: `${config.envName}-sp-transcript-ingest`,
      description: 'Parse a transcript CSV from S3 and upsert rows into SupportPlane DynamoDB',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../debug-console/supportplane/lambdas/sp-transcript-ingest'), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash',
            '-c',
            'cd /asset-input && npm install && npm run build && cp dist/*.js package.json /asset-output/ && cp -r node_modules /asset-output/',
          ],
          user: 'root',
        },
      }),
      // CSV parse + per-row DynamoDB upsert for ~500 rows/file; 5 min gives
      // headroom once per-row processing (bounded-concurrency Beacon/GoCode) is added.
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      role: this.ingestLambdaRole,
      logGroup,
      retryAttempts: 0,
      deadLetterQueue: dlq,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [securityGroup],
      environment: {
        ENV_NAME: config.envName,
        SP_L1_TRANSCRIPTS_TABLE: transcriptsTable,
        SP_L1_UPLOADS_TABLE: uploadsTable,
        SP_L1_ANALYTICS_TABLE: analyticsTable,
        L1_TRANSCRIPTS_S3_BUCKET: TRANSCRIPTS_BUCKET,
        // Beacon auth (used by the record-processing handler): assume this role, then
        // mint an sso-jwt against SSO_HOST for Beacon /api/ask.
        S2S_IAM_JWT_ROLE_ARN: s2sIamJwtRoleArn,
        SSO_HOST: ssoHost,
      },
    });

    // Any DLQ message means an ingest permanently failed (0 retries). Routes to
    // the env-shared SNS alarm topic (Slack) via AlarmUtil.
    AlarmUtil.createCloudWatchAlarm(
      this,
      'IngestDLQDepthAlarm',
      dlq.metricApproximateNumberOfMessagesVisible(),
      1,
      `P1: sp-transcript-ingest DLQ has messages (${config.envName}) — a transcript ingest permanently failed`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING
    );

    new cdk.CfnOutput(this, 'IngestLambdaArn', {
      value: this.ingestLambda.functionArn,
      description: 'ARN of sp-transcript-ingest — set SP_TRANSCRIPT_INGEST_FN on debug-console Katana',
      exportName: `${config.envName}-sp-transcript-ingest-lambda-arn`,
    });
    new cdk.CfnOutput(this, 'IngestLambdaName', {
      value: this.ingestLambda.functionName,
      description: 'Function name for direct invoke (debug-console upload/Sync, future reconcile cron)',
      exportName: `${config.envName}-sp-transcript-ingest-lambda-name`,
    });

    // Direct invoke — GD boundary denies s3:PutBucketNotification (see
    // feedback-fanout-stack.ts). debug-console async-invokes after S3 put;
    // lambda:InvokeFunction is not boundary-denied. Reuses
    // `investigatorInvokerRoleArns` — the same narrowly-scoped console-service
    // ECS task role already granted invoke on the investigator Lambda (changing
    // that list also changes who can invoke this ingest Lambda).
    for (const roleArn of config.investigatorInvokerRoleArns) {
      this.ingestLambda.grantInvoke(new iam.ArnPrincipal(roleArn));
    }

    this.ingestLambda.node.addDependency(this.ingestLambdaRole);
    this.ingestLambda.node.addDependency(logGroup);

    // ---------------------------------------------------------------------
    // Ingest jobs queue (sync/cron Lambda -> ingest). The ingest Lambda has
    // TWO invoke paths: (1) DIRECT async invoke from debug-console after an
    // upload (above), and (2) this SQS queue, which the sp-transcript-sync
    // Lambda (cron + UI Sync) fills with one {bucket,key} message per new key.
    // No S3 notification (GD boundary). At-least-once is safe — ingest is
    // idempotent (dedup by interaction_id; run report keyed by s3_key+file_hash).
    // ---------------------------------------------------------------------
    const ingestJobsDlq: sqs.Queue = new sqs.Queue(this, 'IngestJobsDLQ', {
      queueName: `airo-sp-transcript-ingest-jobs-dlq-${config.envName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.ingestJobsQueue = new sqs.Queue(this, 'IngestJobsQueue', {
      queueName: `airo-sp-transcript-ingest-jobs-${config.envName}`,
      // >= the Lambda timeout (300s); 6x gives redrive headroom.
      visibilityTimeout: cdk.Duration.seconds(1800),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: ingestJobsDlq, maxReceiveCount: 3 },
    });
    // One file per invoke; partial-batch response so a poison message redrives
    // to the DLQ rather than blocking the batch.
    this.ingestLambda.addEventSource(
      new SqsEventSource(this.ingestJobsQueue, { batchSize: 1, reportBatchItemFailures: true })
    );
    // Interim producer: the console-service role (same list used for grantInvoke).
    // The sp-transcript-sync Lambda gets its own grant when it is added (Task 5.1).
    for (const roleArn of config.investigatorInvokerRoleArns) {
      this.ingestJobsQueue.grantSendMessages(new iam.ArnPrincipal(roleArn));
    }
    AlarmUtil.createCloudWatchAlarm(
      this,
      'IngestJobsDLQDepthAlarm',
      ingestJobsDlq.metricApproximateNumberOfMessagesVisible(),
      1,
      `P1: sp-transcript-ingest-jobs DLQ has messages (${config.envName}) — a sync/cron ingest job failed 3x`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING
    );

    // ---------------------------------------------------------------------
    // Per-record processing worker (`sp-transcript-record-processing`). Ingest stays fast
    // (parse + upsert + rollups) and enqueues one message per row to the
    // record-processing queue; this worker enhances/enriches each row and writes back
    // to DynamoDB as needed. Processing CANNOT run inline: real files are
    // 450–3,224 rows and Beacon latency is seconds/call, which exceeds a single
    // 300s invocation — so it is decoupled behind SQS with capped concurrency.
    //
    // Beacon auth: this worker (not ingest) makes the Beacon calls, so it holds
    // the S2S IAM-JWT assume — it assumes airobuilde-custom-{env}-s2s-iam-jwt-access
    // to mint the `sso-jwt` Beacon requires (its role ARN is in
    // config.s2sIamJwtAssumeRoleArns so the S2S role trusts it; Beacon allow-lists
    // the assumed S2S role, not this execution role).
    // ---------------------------------------------------------------------
    const transcriptTableArn: string = tableArn(transcriptsTable);
    this.recordProcessingLambdaRole = new iam.Role(this, 'RecordProcessingLambdaRole', {
      roleName: `${config.envName}-sp-transcript-record-processing-role`,
      description: 'Execution role for the SupportPlane transcript record-processing worker Lambda',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'RecordProcessingPermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        // Read the row by interaction_id and write back processed/enriched fields.
        DynamoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
                'dynamodb:BatchGetItem',
                'dynamodb:Scan',
              ],
              resources: [transcriptTableArn, `${transcriptTableArn}/index/*`],
            }),
          ],
        }),
        // Beacon auth: assume the generic S2S IAM-JWT role to mint the sso-jwt.
        S2sAssumeRole: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sts:AssumeRole'],
              resources: [s2sIamJwtRoleArn],
            }),
          ],
        }),
        // GoCode fallback credential (console secret prefix).
        SecretsRead: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/Katana/Secrets/airobuilde/console/*`,
              ],
            }),
          ],
        }),
      },
    });

    const recordProcessingLogGroup: logs.LogGroup = new logs.LogGroup(this, 'RecordProcessingLambdaLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-sp-transcript-record-processing`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const recordProcessingSecurityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      'RecordProcessingLambdaSecurityGroup',
      {
        vpc,
        description: 'Security group for the SupportPlane transcript record-processing worker Lambda',
        allowAllOutbound: true,
      }
    );

    this.recordProcessingLambda = new lambda.Function(this, 'RecordProcessingLambda', {
      functionName: `${config.envName}-sp-transcript-record-processing`,
      description: 'Process one transcript row: enhance, enrich, and persist to DynamoDB as needed',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../debug-console/supportplane/lambdas/sp-transcript-record-processing'), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            'bash',
            '-c',
            'cd /asset-input && npm install && npm run build && cp dist/*.js package.json /asset-output/ && cp -r node_modules /asset-output/',
          ],
          user: 'root',
        },
      }),
      // Per-batch record processing with time-boxed Beacon calls (see plan §6.0 E2/E5).
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: this.recordProcessingLambdaRole,
      logGroup: recordProcessingLogGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [recordProcessingSecurityGroup],
      environment: {
        ENV_NAME: config.envName,
        SP_L1_TRANSCRIPTS_TABLE: transcriptsTable,
        S2S_IAM_JWT_ROLE_ARN: s2sIamJwtRoleArn,
        SSO_HOST: ssoHost,
        BEACON_API_URL: config.beaconApiUrl,
      },
    });

    const recordProcessingJobsDlq: sqs.Queue = new sqs.Queue(this, 'RecordProcessingJobsDLQ', {
      queueName: `airo-sp-transcript-record-processing-jobs-dlq-${config.envName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    this.recordProcessingJobsQueue = new sqs.Queue(this, 'RecordProcessingJobsQueue', {
      queueName: `airo-sp-transcript-record-processing-jobs-${config.envName}`,
      visibilityTimeout: cdk.Duration.seconds(1800),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: recordProcessingJobsDlq, maxReceiveCount: 3 },
    });
    // maxConcurrency caps in-flight workers so a backfill burst cannot exceed
    // Beacon's rate limits (the real bottleneck — see plan §6.0). batchSize>1 with
    // partial-batch response amortizes invoke overhead; a bad row redrives alone.
    this.recordProcessingLambda.addEventSource(
      new SqsEventSource(this.recordProcessingJobsQueue, {
        batchSize: 5,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
      })
    );

    // Ingest -> record-processing fan-out: ingest sends one {interaction_id} message per
    // upserted row (SendMessageBatch) to this queue. Grant + expose the URL.
    this.recordProcessingJobsQueue.grantSendMessages(this.ingestLambdaRole);
    this.ingestLambda.addEnvironment('SP_RECORD_PROCESSING_QUEUE_URL', this.recordProcessingJobsQueue.queueUrl);

    AlarmUtil.createCloudWatchAlarm(
      this,
      'RecordProcessingJobsDLQDepthAlarm',
      recordProcessingJobsDlq.metricApproximateNumberOfMessagesVisible(),
      1,
      `P1: sp-transcript-record-processing-jobs DLQ has messages (${config.envName}) — a row record-processing job failed 3x`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING
    );

    new cdk.CfnOutput(this, 'IngestJobsQueueUrl', {
      value: this.ingestJobsQueue.queueUrl,
      description: 'SQS URL the sp-transcript-sync Lambda posts {bucket,key} jobs to',
      exportName: `${config.envName}-sp-transcript-ingest-jobs-queue-url`,
    });
    new cdk.CfnOutput(this, 'RecordProcessingLambdaArn', {
      value: this.recordProcessingLambda.functionArn,
      description: 'ARN of sp-transcript-record-processing (per-row enhance/enrich/persist worker)',
      exportName: `${config.envName}-sp-transcript-record-processing-lambda-arn`,
    });
    new cdk.CfnOutput(this, 'RecordProcessingJobsQueueUrl', {
      value: this.recordProcessingJobsQueue.queueUrl,
      description: 'SQS URL the ingest Lambda posts per-row {interaction_id} record-processing jobs to',
      exportName: `${config.envName}-sp-transcript-record-processing-jobs-queue-url`,
    });
    new cdk.CfnOutput(this, 'BeaconApiUrlConfigured', {
      value: config.beaconApiUrl ? 'true' : 'false',
      description: 'Whether BEACON_API_URL is set on sp-transcript-record-processing (L3 gate)',
      exportName: `${config.envName}-sp-transcript-beacon-configured`,
    });

    this.recordProcessingLambda.node.addDependency(this.recordProcessingLambdaRole);
    this.recordProcessingLambda.node.addDependency(recordProcessingLogGroup);

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'sp-transcript-ingest');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
