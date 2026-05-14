import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/**
 * Shared S3 bucket for offline ML datasets and artifacts.
 * Organize by key prefix per model or use case (e.g. `cost-attributtion-classifier/training/`).
 */
export class OfflineMLDataS3Stack extends GDStack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'OfflineMLDataBucket', {
      bucketName: `airo-offline-ml-data-${config.envName}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    const accessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.bucket.bucketArn,
        `${this.bucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        ...config.katanaEcsTaskRoleArn.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    this.bucket.addToResourcePolicy(accessPolicy);

    new cdk.CfnOutput(this, 'OfflineMLDataBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for offline ML data (per-model prefixes under this bucket)',
      exportName: `${config.envName}-offline-ml-data-bucket-name`,
    });

    new cdk.CfnOutput(this, 'OfflineMLDataBucketArn', {
      value: this.bucket.bucketArn,
      description: 'ARN of the offline ML data S3 bucket',
      exportName: `${config.envName}-offline-ml-data-bucket-arn`,
    });
  }
}
