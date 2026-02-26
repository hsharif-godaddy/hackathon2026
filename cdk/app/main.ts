import config from "../lib/config";
import { App } from "aws-cdk-lib";
import {AiroBuilderStack} from "../lib/application-stack";
import { MySQLV2Stack } from "../lib/mysql-v2-stack";
import { AiroJWTKeyStack } from "../lib/airo-jwt-key-stack";
import { MonitoringStack } from '../lib/monitoring-stack';
import { GocaasSpendLambdaStack } from "../lib/gocaas-spend-lambda-stack";
import { ImageSearchStack } from "../lib/image-search-stack";
import { EvalSnapshotsStack } from "../lib/eval-snapshots-stack";
import { QdrantStack } from "../lib/qdrant-stack";
import { QdrantEcrStack } from "../lib/qdrant-ecr-stack";

/**
 * Main function to execute the CDK app
 *
 * Creates and orchestrates the following stacks:
 * - MySQLV2Stack: Aurora RDS database cluster
 * - AiroBuilderStack: IAM roles for GoCode access
 * - MonitoringStack: CloudWatch alarms and alert integrations
 */
async function main() {
  const app: App = new App();

  // Define target deployment environment(s)
  const env = { account: config.account, region: config.region };

  // Create MySQL V2 stack using existing VPC, for env based databases
  new MySQLV2Stack(app, 'MySQLV2Stack', { env });

  // Create application stack with IAM roles
  new AiroBuilderStack(app, 'AiroBuilderStack', { env });

  // Create monitoring stack with CloudWatch alarms
  // Configuration is dynamically loaded from config based on ENV_NAME
  new MonitoringStack(app, 'MonitoringStack', {
    env,
    ...config.monitoring,
  });

  // Create JWT Key Management stack for secure token signing
  new AiroJWTKeyStack(app, 'AiroJWTKeyStack', { env: env });

  // Create GoCode Spend ESSP Lambda stack
  new GocaasSpendLambdaStack(app, 'GocaasSpendLambdaStack', { env });

  // Create Image Search Service infrastructure (S3 bucket for analysis cache)
  new ImageSearchStack(app, 'ImageSearchStack', { env });

  // Create Eval Snapshots infrastructure (S3 bucket for evaluation screenshots + data)
  new EvalSnapshotsStack(app, 'EvalSnapshotsStack', { env });

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
