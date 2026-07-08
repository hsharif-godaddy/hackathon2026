import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

/**
 * Stack for Langfuse Exports S3 infrastructure
 *
 * Stores hourly JSONL exports from Langfuse Blob Storage Integration.
 * Used for offline analysis of LLM traces, sessions, observations, and scores.
 * The Langfuse instance (agentobser team, Katana-hosted) writes via its pod's
 * IAM role using the org-scoped bucket policy.
 */
export class LangfuseExportsS3Stack extends GDStack {
  public readonly exportsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.exportsBucket = new s3.Bucket(this, 'LangfuseExportsS3Bucket', {
      bucketName: `airo-builder-langfuse-exports-${config.envName}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        {
          prefix: 'langfuse-exports/',
          expiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.envName !== 'prod',
    });

    // Writer: Langfuse Katana pod (agentobser team, unknown account).
    // Org-scoped policy grants PutObject only. Read access is in the reader policy below.
    const langfuseWriterPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
      ],
      resources: [
        `${this.exportsBucket.bucketArn}/langfuse-exports/*`,
      ],
      principals: [new iam.StarPrincipal()],
      conditions: {
        StringEquals: {
          'aws:PrincipalOrgID': 'o-nkgi7akmvi',
        },
      },
    });

    // Readers: Lake Formation / Athena for querying exports.
    const readerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.exportsBucket.bucketArn,
        `${this.exportsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    });

    this.exportsBucket.addToResourcePolicy(langfuseWriterPolicy);
    this.exportsBucket.addToResourcePolicy(readerPolicy);

    new cdk.CfnOutput(this, 'LangfuseExportsS3BucketName', {
      value: this.exportsBucket.bucketName,
      description: 'S3 bucket for Langfuse trace/session/observation exports',
      exportName: `${config.envName}-langfuse-exports-bucket-name`,
    });

    new cdk.CfnOutput(this, 'LangfuseExportsS3BucketArn', {
      value: this.exportsBucket.bucketArn,
      description: 'ARN of the Langfuse exports S3 bucket',
      exportName: `${config.envName}-langfuse-exports-bucket-arn`,
    });
  }
}
