import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Stack for Image Search Service infrastructure
 *
 * Creates S3 bucket for storing image analysis results that can be shared
 * across all developers to avoid re-running expensive AI analysis.
 */
export class ImageSearchStack extends GDStack {
  public readonly analysisBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // Create S3 bucket for storing image analyses
    // This allows developers to share analysis results instead of re-running Haiku
    this.analysisBucket = new s3.Bucket(this, 'ImageAnalysisBucket', {
      bucketName: `airo-image-analyses-${config.envName}`,

      // Enable versioning for data safety
      versioned: true,

      // Use S3-managed encryption (SSE-S3)
      encryption: s3.BucketEncryption.S3_MANAGED,

      // Block all public access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // Enable server access logging would require a separate logging bucket
      // For dev, we'll skip this to keep it simple

      // Lifecycle rules to manage storage costs
      lifecycleRules: [
        {
          // Move old versions to cheaper storage after 30 days
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          // Delete old versions after 90 days
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],

      // For dev environment, allow bucket deletion
      // Note: autoDeleteObjects requires iam:CreateRole which PowerUser doesn't have
      // Bucket can be manually emptied before deletion if needed
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Grant access to the PowerUser role used by developers
    // This allows anyone with the airobuild-dev-private-sso profile to access
    const devAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.analysisBucket.bucketArn,
        `${this.analysisBucket.bucketArn}/*`,
      ],
      principals: [
        // Allow PowerUser role from the account
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        // Allow the GoCode access roles
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    this.analysisBucket.addToResourcePolicy(devAccessPolicy);

    // Output bucket name for configuration
    new cdk.CfnOutput(this, 'ImageAnalysisBucketName', {
      value: this.analysisBucket.bucketName,
      description: 'S3 bucket for storing image analysis results',
      exportName: `${config.envName}-image-analysis-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ImageAnalysisBucketArn', {
      value: this.analysisBucket.bucketArn,
      description: 'ARN of the image analysis S3 bucket',
      exportName: `${config.envName}-image-analysis-bucket-arn`,
    });
  }
}
