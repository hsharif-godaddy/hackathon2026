import config from "../lib/config";
import { App } from "aws-cdk-lib";
import {AiroBuilderStack} from "../lib/application-stack";
import { MySQLV2Stack } from "../lib/mysql-v2-stack";
import { PostgresStack } from "../lib/postgres-stack";
import { AiroJWTKeyStack } from "../lib/airo-jwt-key-stack";
import { AiroStripeServiceStack } from "../lib/airo-stripe-service-stack";
import { MonitoringStack } from '../lib/monitoring-stack';
import { GocaasSpendLambdaStack } from "../lib/gocaas-spend-lambda-stack";
import { BudgetServiceLakeExportStack } from "../lib/budget-service-lake-export-stack";
import { LangfuseMetricsEsspExporterStack } from "../lib/langfuse-metrics-essp-exporter-stack";
import { WatchtowerStack } from "../lib/watchtower-stack";
import { EvalSnapshotsStack } from "../lib/eval-snapshots-stack";
import { EventsS3Stack } from "../lib/events-s3-stack";
import { FeedbackS3Stack } from "../lib/feedback-s3-stack";
import { OfflineMLDataS3Stack } from "../lib/offline-ml-data-s3-stack";
import { LakeFormationAdminsStack } from "../lib/lake-formation-admins-stack";
import { LambdaBaseEcrStack } from "../lib/lambda-base-ecr-stack";
import { FeedbackAutomationStack } from "../lib/feedback-automation-stack";
import { FeedbackFanoutStack } from "../lib/feedback-fanout-stack";
import { SeoQualityS3Stack } from "../lib/seo-quality-s3-stack";
import { SeoQualityLakePartitionStack } from "../lib/seo-quality-lake-partition-stack";
import { AiroInvestigatorStack } from "../lib/investigator-stack";
import { S2sIamJwtStack } from "../lib/s2s-iam-jwt-stack";
import { TransactionalEventsKinesisStack } from "../lib/transactional-events-kinesis-stack";
import { TransactionalEventsKMSStack } from "../lib/transactional-events-kms-stack";
import { FeedbackL1TranscriptStack } from "../lib/feedback-l1-transcript-stack";
import { SupportplaneDynamoStack } from "../lib/supportplane-dynamodb-stack";
import { LangfuseExportsS3Stack } from "../lib/langfuse-exports-s3-stack";
import { SupportplaneTranscriptIngestStack } from "../lib/supportplane-transcript-ingest-stack";
import { SupportplaneTranscriptSyncStack } from "../lib/supportplane-transcript-sync-stack";

/**
 * Main function to execute the CDK app
 *
 * Creates and orchestrates the following stacks:
 * - MySQLV2Stack: Aurora MySQL RDS database cluster
 * - PostgresStack: Aurora PostgreSQL RDS database cluster
 * - AiroBuilderStack: IAM roles for GoCode access
 * - MonitoringStack: CloudWatch alarms and alert integrations
 */
async function main() {
  const app: App = new App();

  // Define target deployment environment(s)
  const env = { account: config.account, region: config.region };

  // Create MySQL V2 stack using existing VPC, for env based databases
  new MySQLV2Stack(app, 'MySQLV2Stack', { env });

  // Create PostgreSQL stack using existing VPC, for env based databases
  new PostgresStack(app, 'PostgresStack', { env });

  // Create application stack with IAM roles
  new AiroBuilderStack(app, 'AiroBuilderStack', { env });

  // Generic S2S IAM JWT role (replaces gocode-specific role for multi-service use)
  new S2sIamJwtStack(app, 'S2sIamJwtStack', { env });

  // Create monitoring stack with CloudWatch alarms
  // Configuration is dynamically loaded from config based on ENV_NAME
  new MonitoringStack(app, 'MonitoringStack', {
    env,
    ...config.monitoring,
  });

  // Create JWT Key Management stack for secure token signing
  new AiroJWTKeyStack(app, 'AiroJWTKeyStack', { env: env });

  // DynamoDB tables, KMS RSA CMK, Secrets Manager entries used by stripe-service.
  // Service runtime (ALB/ECS/ECR) is Katana-managed; this stack owns the data plane.
  // Deploys to dev + test + prod. Prod resources use RETAIN removal policy
  // (see airo-stripe-service-stack.ts:39-40) to protect against accidental
  // stack deletion dropping live DDB / KMS state.
  new AiroStripeServiceStack(app, 'AiroStripeServiceStack', { env });

  // Create GoCode Spend ESSP Lambda stack
  new GocaasSpendLambdaStack(app, 'GocaasSpendLambdaStack', { env });

  // Daily snapshot of budget-service Postgres tables to S3 (lake ingestion).
  // No-op until config.budgetServiceLakeExport.{dbHost,dbName,dbSecretArn}
  // are populated for the env.
  new BudgetServiceLakeExportStack(app, 'BudgetServiceLakeExportStack', { env });

  // Create Langfuse Metrics ESSP Exporter Lambda stack (5-min cron, hourly buckets)
  new LangfuseMetricsEsspExporterStack(app, 'LangfuseMetricsEsspExporterStack', { env });

  // Watchtower observability agent — hourly tripwire + daily digest (Phase 1).
  new WatchtowerStack(app, 'WatchtowerStack', { env });

  // Create Eval Snapshots infrastructure (S3 bucket for evaluation screenshots + data)
  new EvalSnapshotsStack(app, 'EvalSnapshotsStack', { env });

  // Shared S3 bucket for offline ML data (per-model prefixes inside the bucket)
  new OfflineMLDataS3Stack(app, 'OfflineMLDataS3Stack', { env });

  // Create Feedback Automation IAM role with Secrets Manager list + read access
  new FeedbackAutomationStack(app, 'FeedbackAutomationStack', { env });

  // Create Feedback S3 infrastructure (S3 bucket for user feedback submissions).
  // Deployed to dev and prod only — feedback data is not needed in the test environment.
  // test is technically deployable via cdk.yml but is intentionally excluded here.
  let feedbackS3Stack: FeedbackS3Stack | undefined;
  if (config.envName === 'dev' || config.envName === 'prod') {
    feedbackS3Stack = new FeedbackS3Stack(app, 'FeedbackS3Stack', { env });
  }

  // Langfuse exports S3 bucket — hourly JSONL exports from Langfuse Blob Storage Integration.
  // Dev + prod only (mirrors FeedbackS3Stack gate).
  if (config.envName === 'dev' || config.envName === 'prod') {
    new LangfuseExportsS3Stack(app, 'LangfuseExportsS3Stack', { env });
  }

  // S3 bucket for marketing data lake — SEO quality snapshots written after every publish.
  // Dev + prod only (same gate as FeedbackS3Stack — test excluded intentionally).
  if (config.envName === 'dev' || config.envName === 'prod') {
    new SeoQualityS3Stack(app, 'SeoQualityS3Stack', { env });
    new SeoQualityLakePartitionStack(app, 'SeoQualityLakePartitionStack', { env });
  }

  // Dedicated S3 bucket for product-analytics events (dev-private, test, prod).
  new EventsS3Stack(app, 'EventsS3Stack', { env });

  // Register Lake Formation data lake administrators and provision the Athena results bucket.
  // Deployed to all environments — Lake Formation admin settings are required in test
  // to allow data lake access (unlike FeedbackS3Stack which excludes test intentionally).
  // Dev: Ops + PowerUser + DataLakeAutomationRole + ServiceCatalogLaunchConstraintRole
  // Test: Ops + DataLakeAutomationRole + ServiceCatalogLaunchConstraintRole
  // Prod: Ops + DataLakeAutomationRole + ServiceCatalogLaunchConstraintRole
  // (baseline roles added automatically via includeBaselineRoles=true)
  new LakeFormationAdminsStack(app, 'LakeFormationAdminsStack', {
    env,
    roleNames: config.dataLakeAdminRoleNames,
    envName: config.envName as 'dev' | 'test' | 'prod',
  });

  // Lambda base image ECR mirror — deployed before AiroInvestigatorStack
  // so the repo exists when the Docker build runs. Mirrors
  // public.ecr.aws/lambda/nodejs:* into Airo's own ECR (GCI compliance).
  // Populate via docker-mirror-lambda-base.yml workflow after first deploy.
  if (config.envName === 'dev' || config.envName === 'prod') {
    new LambdaBaseEcrStack(app, 'LambdaBaseEcrStack', { env });
  }

  // Create Airo Investigator Lambda + S3 bucket (dev first, promote to prod
  // once validated). The Lambda runs the airo-log-investigate skill on
  // demand; the bucket stores per-investigation state + reports.
  // Requires LambdaBaseEcrStack deployed + docker-mirror-lambda-base.yml run.
  if (config.envName === 'dev' || config.envName === 'prod') {
    new AiroInvestigatorStack(app, 'AiroInvestigatorStack', { env });
  }

  // Feedback Fanout Lambda — subscribes to FeedbackS3Stack's bucket, fans out
  // submissions to Slack + CMAPI + AABSP Jira. Gated on flag-disabled env var
  // until cutover (see fanout/README.md). Same env gate as FeedbackS3Stack
  // (dev/prod only).
  if ((config.envName === 'dev' || config.envName === 'prod') && feedbackS3Stack) {
    const fanoutStack = new FeedbackFanoutStack(app, 'FeedbackFanoutStack', {
      env,
      feedbackBucketArn: feedbackS3Stack.feedbackBucket.bucketArn,
      feedbackBucketName: feedbackS3Stack.feedbackBucket.bucketName,
      crmCertSecretArn: config.crmCertSecretArn,
      crmKeySecretArn: config.crmKeySecretArn,
      crmBaseUrl: config.crmApiBase,
      ssoUrl: config.ssoEndpoint,
    });
    fanoutStack.addDependency(feedbackS3Stack);
  }

  // SupportPlane L1 xlsx landing zone — dev + prod only (mirrors FeedbackS3Stack gate).
  // Path: l1_transcripts/xlsx/year=YYYY/month=MM/day=DD/{upload-id}.xlsx
  // Env var for debug-console: L1_TRANSCRIPTS_S3_BUCKET (set via Katana secret or .env.local)
  if (config.envName === 'dev' || config.envName === 'prod') {
    new FeedbackL1TranscriptStack(app, 'FeedbackL1TranscriptStack', { env });
  }

  // SupportPlane DynamoDB data plane for transcript migration.
  // Uses generic keys (pk/sk) so non-key attributes can evolve without schema migrations.
  // Env vars for debug-console:
  // - SP_L1_TRANSCRIPTS_TABLE
  // - SP_L1_UPLOADS_TABLE
  // - SP_L1_ANALYTICS_TABLE
  if (config.envName === 'dev' || config.envName === 'prod') {
    new SupportplaneDynamoStack(app, 'SupportplaneDynamoStack', { env });
  }

  // SupportPlane transcript ingestion Lambda — invoked directly (debug-console
  // upload/Sync; future reconcile cron), not via S3 bucket notifications. Parses
  // one CSV file and upserts rows into the SupportPlane L1 DynamoDB tables
  // (dedup by interaction_id).
  // dev + prod only (mirrors the FeedbackL1TranscriptStack / SupportplaneDynamoStack gate).
  if (config.envName === 'dev' || config.envName === 'prod') {
    new SupportplaneTranscriptIngestStack(app, 'SupportplaneTranscriptIngestStack', { env });
  }

  // SupportPlane transcript sync Lambda — runs daily at 13:00 UTC via EventBridge
  // cron (cron(0 13 * * ? *)), diffs the external CKP lighthouse S3 bucket against
  // the internal transcripts bucket using a hash map (sync-state.json) stored in
  // the internal bucket, copies new CSVs under uploads/, then enqueues one
  // {bucket, key} job per file into the sp-transcript-ingest SQS queue.
  // GD boundary blocks s3:PutBucketNotification so S3 event triggers are not
  // used — EventBridge scheduled rules are not affected by that boundary.
  // Prerequisite: CKP team must grant the sync Lambda role read access on
  // gd-ckpetlbatch-prod-lighthouse-data via their bucket policy.
  // dev + prod only (mirrors SupportplaneTranscriptIngestStack gate).
  if (config.envName === 'dev' || config.envName === 'prod') {
    new SupportplaneTranscriptSyncStack(app, 'SupportplaneTranscriptSyncStack', { env });
  }

  // KMS key for encrypting the transactional events Kinesis stream.
  // Cross-account producer accounts are granted encrypt/decrypt so they can
  // write records via their EventBridge cross-account roles.
  const transactionalEventsKmsStack = new TransactionalEventsKMSStack(app, 'TransactionalEventsKMSStack', { env });

  // Kinesis stream for transactional email events. Cross-account producers
  // (EventBridge eventbus-cross-account roles) put records; consumers are
  // downstream data-pipeline roles. Deployed to all environments.
  const transactionalEventsKinesisStack = new TransactionalEventsKinesisStack(app, 'TransactionalEventsKinesisStack', {
    env,
    kmsKey: transactionalEventsKmsStack.kmsKey,
  });
  transactionalEventsKinesisStack.addDependency(transactionalEventsKmsStack);

  app.synth();
}

// Execute the main function
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
