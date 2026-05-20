import config from "../lib/config";
import { App } from "aws-cdk-lib";
import {AiroBuilderStack} from "../lib/application-stack";
import { MySQLV2Stack } from "../lib/mysql-v2-stack";
import { PostgresStack } from "../lib/postgres-stack";
import { AiroJWTKeyStack } from "../lib/airo-jwt-key-stack";
import { AiroStripeServiceStack } from "../lib/airo-stripe-service-stack";
import { MonitoringStack } from '../lib/monitoring-stack';
import { GocaasSpendLambdaStack } from "../lib/gocaas-spend-lambda-stack";
import { ImageSearchStack } from "../lib/image-search-stack";
import { LangfuseMetricsEsspExporterStack } from "../lib/langfuse-metrics-essp-exporter-stack";
import { EvalSnapshotsStack } from "../lib/eval-snapshots-stack";
import { EventsS3Stack } from "../lib/events-s3-stack";
import { FeedbackS3Stack } from "../lib/feedback-s3-stack";
import { OfflineMLDataS3Stack } from "../lib/offline-ml-data-s3-stack";
import { LakeFormationAdminsStack } from "../lib/lake-formation-admins-stack";
import { QdrantStack } from "../lib/qdrant-stack";
import { QdrantEcrStack } from "../lib/qdrant-ecr-stack";
import { LambdaBaseEcrStack } from "../lib/lambda-base-ecr-stack";
import { FeedbackAutomationStack } from "../lib/feedback-automation-stack";
import { AiroInvestigatorStack } from "../lib/investigator-stack";
import { S2sIamJwtStack } from "../lib/s2s-iam-jwt-stack";

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
  // Gated to dev for now — widen to test/prod with a one-line change once we're
  // ready to provision real Stripe resources beyond dev-private.
  if (config.envName === 'dev') {
    new AiroStripeServiceStack(app, 'AiroStripeServiceStack', { env });
  }

  // Create GoCode Spend ESSP Lambda stack
  new GocaasSpendLambdaStack(app, 'GocaasSpendLambdaStack', { env });

  // Create Langfuse Metrics ESSP Exporter Lambda stack (5-min cron, hourly buckets)
  new LangfuseMetricsEsspExporterStack(app, 'LangfuseMetricsEsspExporterStack', { env });

  // Create Image Search Service infrastructure (S3 bucket for analysis cache)
  new ImageSearchStack(app, 'ImageSearchStack', { env });

  // Create Eval Snapshots infrastructure (S3 bucket for evaluation screenshots + data)
  new EvalSnapshotsStack(app, 'EvalSnapshotsStack', { env });

  // Shared S3 bucket for offline ML data (per-model prefixes inside the bucket)
  new OfflineMLDataS3Stack(app, 'OfflineMLDataS3Stack', { env });

  // Create Feedback Automation IAM role with Secrets Manager list + read access
  new FeedbackAutomationStack(app, 'FeedbackAutomationStack', { env });

  // Create Feedback S3 infrastructure (S3 bucket for user feedback submissions).
  // Deployed to dev and prod only — feedback data is not needed in the test environment.
  // test is technically deployable via cdk.yml but is intentionally excluded here.
  if (config.envName === 'dev' || config.envName === 'prod') {
    new FeedbackS3Stack(app, 'FeedbackS3Stack', { env });
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

  // Create Qdrant ECR repository (dev and prod only)
  // Deploy this first to allow pre-populating Docker images
  new QdrantEcrStack(app, "QdrantEcrStack", { env });

  // Create Qdrant vector database cluster (dev and prod only)
  // Requires QdrantEcrStack to be deployed first with Docker image
  new QdrantStack(app, "QdrantVectorDbStack", { env });

  app.synth();
}

// Execute the main function
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
