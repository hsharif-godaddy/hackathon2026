import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

/**
 * S3 landing zone for SupportPlane L1 transcript Excel uploads.
 *
 * Object key layout (Hive-style, matches feedback/events pattern):
 *   l1_transcripts/xlsx/year=YYYY/month=MM/day=DD/{upload-id}.xlsx
 *
 * Writers: debug-console Katana ECS task role (SupportPlane upload panel).
 * Readers: Lake Formation / Athena roles for downstream lake ingestion.
 *
 * Env variable for debug-console: L1_TRANSCRIPTS_S3_BUCKET
 */
export class FeedbackL1TranscriptStack extends GDStack {
  public readonly l1TranscriptsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.l1TranscriptsBucket = new s3.Bucket(this, 'L1TranscriptsS3Bucket', {
      bucketName: `airo-builder-l1-transcripts-${config.envName}`,
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
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(60),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.envName !== 'prod',
    });

    const consoleWriterRoleArns = config.katanaEcsTaskRoleArn.filter((arn) =>
      arn.includes('7794') || arn.includes('7797'),
    );
    const writerPrincipals = [
      new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
      ...(consoleWriterRoleArns.length > 0
        ? consoleWriterRoleArns
        : config.katanaEcsTaskRoleArn
      ).map((arn) => new iam.ArnPrincipal(arn)),
    ];

    this.l1TranscriptsBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.l1TranscriptsBucket.bucketArn,
        `${this.l1TranscriptsBucket.bucketArn}/*`,
      ],
      principals: writerPrincipals,
    }));

    this.l1TranscriptsBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.l1TranscriptsBucket.bucketArn,
        `${this.l1TranscriptsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    }));

    new cdk.CfnOutput(this, 'L1TranscriptsS3BucketName', {
      value: this.l1TranscriptsBucket.bucketName,
      description: 'S3 bucket for SupportPlane L1 xlsx uploads (path: l1_transcripts/xlsx/year=YYYY/month=MM/day=DD/)',
      exportName: `${config.envName}-l1-transcripts-bucket-name`,
    });

    new cdk.CfnOutput(this, 'L1TranscriptsS3BucketArn', {
      value: this.l1TranscriptsBucket.bucketArn,
      description: 'ARN of the L1 transcripts S3 bucket',
      exportName: `${config.envName}-l1-transcripts-bucket-arn`,
    });

    // new cdk.CfnOutput(this, 'L1TranscriptsTablePrefix', {
    //   value: 'l1_transcripts/xlsx',
    //   description: 'Glue/Athena table prefix (Hive partitions: year=.../month=.../day=.../)',
    //   exportName: `${config.envName}-l1-transcripts-table-prefix`,
    // });
  }
}
