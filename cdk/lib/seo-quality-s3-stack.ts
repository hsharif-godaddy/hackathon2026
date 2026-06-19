import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/**
 * Stack for SEO Quality S3 infrastructure (marketing data lake).
 *
 * Stores SEO quality snapshots captured after every publish as Parquet files
 * for Athena/Lake Formation querying.
 *
 * Key structure: {table_prefix}/partition_utc_year=.../partition_utc_month=.../
 *   partition_utc_day=.../partition_utc_hour=.../{timestamp}.parquet
 */
export class SeoQualityS3Stack extends GDStack {
  public readonly marketingBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.marketingBucket = new s3.Bucket(this, 'MarketingS3Bucket', {
      bucketName: `airo-builder-marketing-${config.envName}`,
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

    const writerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.marketingBucket.bucketArn,
        `${this.marketingBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        ...config.katanaEcsTaskRoleArn.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    // Cross-account Lake Formation / Athena roles — same shared data platform accounts as FeedbackS3Stack.
    const readerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.marketingBucket.bucketArn,
        `${this.marketingBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    });

    this.marketingBucket.addToResourcePolicy(writerPolicy);
    this.marketingBucket.addToResourcePolicy(readerPolicy);

    new cdk.CfnOutput(this, 'MarketingS3BucketName', {
      value: this.marketingBucket.bucketName,
      description: 'S3 bucket for marketing data lake (SEO quality snapshots)',
      exportName: `${config.envName}-marketing-bucket-name`,
    });

    new cdk.CfnOutput(this, 'MarketingS3BucketArn', {
      value: this.marketingBucket.bucketArn,
      description: 'ARN of the marketing S3 bucket',
      exportName: `${config.envName}-marketing-bucket-arn`,
    });
  }
}
