import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/** Glue/Athena table prefix under `airo-builder-events-{env}` (prod uses _cln; others use laketest). */
export function eventsTablePrefixForEnv(envName: string): string {
  return envName === 'prod' ? 'airo_builder_events_cln' : 'airo_builder_events_cln_laketest';
}

/**
 * Stack for product-analytics / builder events S3 infrastructure.
 *
 * Replaces the legacy `airo_builder_events` prefix on the feedback bucket with a
 * dedicated bucket per environment, e.g.:
 *   s3://airo-builder-events-prod/airo_builder_events_cln/year=.../...
 *
 * Key design matches FeedbackS3Stack: Hive-style date partitions under the table prefix.
 */
export class EventsS3Stack extends GDStack {
  public readonly eventsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.eventsBucket = new s3.Bucket(this, 'EventsS3Bucket', {
      bucketName: `airo-builder-events-${config.envName}`,
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
        this.eventsBucket.bucketArn,
        `${this.eventsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        ...config.katanaEcsTaskRoleArn.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    const readerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.eventsBucket.bucketArn,
        `${this.eventsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    });

    this.eventsBucket.addToResourcePolicy(writerPolicy);
    this.eventsBucket.addToResourcePolicy(readerPolicy);

    if (config.eventsEmrBatchRoleArns.length > 0) {
      const emrBatchPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          this.eventsBucket.bucketArn,
          `${this.eventsBucket.bucketArn}/*`,
        ],
        principals: config.eventsEmrBatchRoleArns.map(arn => new iam.ArnPrincipal(arn)),
      });
      this.eventsBucket.addToResourcePolicy(emrBatchPolicy);
    }

    const tablePrefix = eventsTablePrefixForEnv(config.envName);

    new cdk.CfnOutput(this, 'EventsS3BucketName', {
      value: this.eventsBucket.bucketName,
      description: 'S3 bucket for Airo Builder product analytics / events',
      exportName: `${config.envName}-events-bucket-name`,
    });

    new cdk.CfnOutput(this, 'EventsS3BucketArn', {
      value: this.eventsBucket.bucketArn,
      description: 'ARN of the events S3 bucket',
      exportName: `${config.envName}-events-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'EventsTablePrefix', {
      value: tablePrefix,
      description: 'Glue/Athena table prefix (Hive partitions under this prefix)',
      exportName: `${config.envName}-events-table-prefix`,
    });
  }
}
