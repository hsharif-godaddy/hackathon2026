import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

/**
 * Lambda Base Image ECR Stack
 *
 * Creates an ECR repository that mirrors the AWS Lambda Node runtime base
 * image (public.ecr.aws/lambda/nodejs:*) into Airo's own ECR account. This
 * satisfies GoDaddy's GCI policy requirement that production Docker images
 * source their base layers from within GoDaddy's ECR surface.
 *
 * Follows the same pattern as QdrantEcrStack — the ECR repo is a separate
 * stack deployed before the investigator Lambda, so the image can be
 * populated before `AiroInvestigatorStack` builds the Docker image.
 *
 * Lifecycle:
 *   1. Deploy this stack (creates the ECR repo).
 *   2. Run `.github/workflows/docker-mirror-lambda-base.yml` (or trigger
 *      manually) — it mirrors public.ecr.aws/lambda/nodejs:20 → this repo.
 *   3. Deploy AiroInvestigatorStack — Dockerfile pulls from this repo.
 *
 * Only deployed for dev and prod (test skipped, matches QdrantEcrStack).
 */
export class LambdaBaseEcrStack extends GDStack {
  public readonly repository?: ecr.Repository;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    if (!['dev', 'prod'].includes(config.envName)) return;

    this.repository = new ecr.Repository(this, 'LambdaNodejsRepo', {
      repositoryName: 'lambda-nodejs',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 5, description: 'Keep only 5 tags' }],
      // RETAIN in both envs — the investigator Lambda image points at this
      // repo; accidental deletion of the ECR repo would brick the next deploy.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, 'LambdaNodejsRepoUri', {
      value: this.repository.repositoryUri,
      description: 'Run docker-mirror-lambda-base.yml workflow to populate this repo',
      exportName: `${config.envName}-lambda-nodejs-ecr-uri`,
    });

    cdk.Tags.of(this).add('component', 'investigator');
  }
}
