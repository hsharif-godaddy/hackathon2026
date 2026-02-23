import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Qdrant ECR Repository Stack
 *
 * Creates the ECR repository for Qdrant Docker images separately from the main
 * Qdrant infrastructure stack. This allows:
 * - Pre-populating the Docker image before deploying the ECS service
 * - Avoiding circular dependencies during CloudFormation rollbacks
 * - Independent lifecycle management of container images
 *
 * Only deployed for dev and prod environments.
 */
export class QdrantEcrStack extends GDStack {
  /** ECR repository for custom Qdrant image */
  public readonly repository?: ecr.Repository;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Only create resources for dev and prod
    if (!["dev", "prod"].includes(config.envName)) {
      return;
    }

    // ECR Repository for custom image
    // Use DESTROY in dev for easy cleanup on rollback, RETAIN in prod for safety
    const repository = new ecr.Repository(this, "QdrantRepo", {
      repositoryName: `${config.envName}-qdrant`,
      removalPolicy:
        config.envName === "dev"
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      emptyOnDelete: config.envName === "dev", // Allow deletion even with images
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: "Keep only 10 images",
        },
      ],
    });
    this.repository = repository;

    // Output
    new cdk.CfnOutput(this, "QdrantEcrRepository", {
      value: repository.repositoryUri,
      description: "ECR repository URI for Qdrant custom image",
      exportName: `${config.envName}-qdrant-ecr-uri`,
    });

    // Tags
    cdk.Tags.of(this).add("component", "qdrant");
  }
}
