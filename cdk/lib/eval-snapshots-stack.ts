import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Stack for Eval Snapshots infrastructure
 *
 * Creates S3 bucket for storing evaluation snapshots (screenshots + conversation data)
 * captured after initial site builds for manual quality review.
 */
export class EvalSnapshotsStack extends GDStack {
  public readonly snapshotsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.snapshotsBucket = new s3.Bucket(this, 'EvalSnapshotsBucket', {
      bucketName: `airo-eval-snapshots-${config.envName}`,
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
        this.snapshotsBucket.bucketArn,
        `${this.snapshotsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
        ...config.gocodeAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
      ],
    });

    this.snapshotsBucket.addToResourcePolicy(accessPolicy);

    new cdk.CfnOutput(this, 'EvalSnapshotsBucketName', {
      value: this.snapshotsBucket.bucketName,
      description: 'S3 bucket for storing evaluation snapshots',
      exportName: `${config.envName}-eval-snapshots-bucket-name`,
    });

    new cdk.CfnOutput(this, 'EvalSnapshotsBucketArn', {
      value: this.snapshotsBucket.bucketArn,
      description: 'ARN of the eval snapshots S3 bucket',
      exportName: `${config.envName}-eval-snapshots-bucket-arn`,
    });
  }
}
