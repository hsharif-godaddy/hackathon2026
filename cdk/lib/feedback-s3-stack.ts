import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/**
 * Stack for Feedback S3 infrastructure
 *
 * Creates S3 bucket for storing user feedback submissions (NPS, bug reports,
 * support requests) captured from the Airo Builder UI.
 *
 * Key design: feedbacks/{year}/{month}/{day}/{hour}/{appId}/{timestamp}.json
 * - Partitioned by date/hour for efficient Athena querying
 * - appId segment enables per-customer data lookups and deletion
 * - Timestamp filename ensures uniqueness (one customer cannot submit
 *   two feedbacks within the same millisecond)
 */
export class FeedbackS3Stack extends GDStack {
  public readonly feedbackBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.feedbackBucket = new s3.Bucket(this, 'FeedbackS3Bucket', {
      bucketName: `airo-builder-feedback-${config.envName}`,
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
      autoDeleteObjects: config.envName !== 'prod',
    });

    // Writers: app pods (Ops, GoCode, Katana) need full read/write/delete access.
    const writerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.feedbackBucket.bucketArn,
        `${this.feedbackBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        ...config.katanaEcsTaskRoleArn.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    // Readers: Lake Formation / Athena roles need read-only access for querying.
    // Two ckpgluecatal accounts are used: 645584687727 (test) and 028140660016 (prod).
    // Both are GoDaddy shared data platform accounts hosting the central Glue catalog
    // and Lake Formation. This is intentionally cross-account — the data lake is a
    // separate shared AWS account, not the same as dev (694282668781) or prod (644094189644).
    const readerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.feedbackBucket.bucketArn,
        `${this.feedbackBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    });

    this.feedbackBucket.addToResourcePolicy(writerPolicy);
    this.feedbackBucket.addToResourcePolicy(readerPolicy);

    new cdk.CfnOutput(this, 'FeedbackS3BucketName', {
      value: this.feedbackBucket.bucketName,
      description: 'S3 bucket for storing user feedback submissions',
      exportName: `${config.envName}-feedback-bucket-name`,
    });

    new cdk.CfnOutput(this, 'FeedbackS3BucketArn', {
      value: this.feedbackBucket.bucketArn,
      description: 'ARN of the feedback S3 bucket',
      exportName: `${config.envName}-feedback-bucket-arn`,
    });
  }
}
