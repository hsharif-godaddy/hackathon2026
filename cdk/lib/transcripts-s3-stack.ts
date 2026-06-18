import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

/**
 * CDK stack for SupportPlane L1 transcript storage.
 *
 * Object key layout (Hive-style, matches feedback/events pattern):
 *   l1_transcripts/year=YYYY/month=MM/day=DD/{transcript-id}.{txt|json|csv}
 *
 * Writers: debug-console Katana ECS task role (upload panel + SharePoint sync).
 * Readers: Lake Formation / Athena roles for querying via the data lake.
 *
 * Env variable for debug-console: S3_TRANSCRIPTS_BUCKET (set via Katana secret or .env.local)
 */
export class TranscriptsS3Stack extends GDStack {
  public readonly transcriptsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.transcriptsBucket = new s3.Bucket(this, 'TranscriptsS3Bucket', {
      bucketName: `airo-builder-transcripts-${config.envName}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Move non-current versions to IA after 30 days, expire after 90
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
        {
          // Current versions: move to IA after 60 days (transcripts are queried
          // heavily in the first month, then drop off)
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

    // Writers: debug-console (SupportPlane upload panel + SharePoint sync Lambda).
    // Uses the same Katana ECS task roles already defined in config — these are
    // the roles the console-service container runs as in each environment.
    const consoleWriterRoleArns = config.katanaEcsTaskRoleArn.filter((arn) =>
      // Narrow to console-service roles only (see config.ts for role comments)
      arn.includes('7794') || arn.includes('7797'),
    );
    const writerPrincipals = [
      new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`),
      // Fallback: if no narrow match (e.g. test env hasn't been wired), grant all katana roles
      ...(consoleWriterRoleArns.length > 0
        ? consoleWriterRoleArns
        : config.katanaEcsTaskRoleArn
      ).map((arn) => new iam.ArnPrincipal(arn)),
    ];

    const writerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        this.transcriptsBucket.bucketArn,
        `${this.transcriptsBucket.bucketArn}/*`,
      ],
      principals: writerPrincipals,
    });

    // Readers: Lake Formation / Athena cross-account roles for querying.
    // Same two DPaaS accounts as feedback/events: 645584687727 (test) and 028140660016 (prod).
    const readerPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        this.transcriptsBucket.bucketArn,
        `${this.transcriptsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::645584687727:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess'),
        new iam.ArnPrincipal('arn:aws:iam::028140660016:role/ckpgluecatal-custom-DataLakeProducerDataAccessRole'),
      ],
    });

    this.transcriptsBucket.addToResourcePolicy(writerPolicy);
    this.transcriptsBucket.addToResourcePolicy(readerPolicy);

    new cdk.CfnOutput(this, 'TranscriptsS3BucketName', {
      value: this.transcriptsBucket.bucketName,
      description: 'S3 bucket for SupportPlane L1 transcript storage (path: l1_transcripts/year=YYYY/month=MM/day=DD/)',
      exportName: `${config.envName}-transcripts-bucket-name`,
    });

    new cdk.CfnOutput(this, 'TranscriptsS3BucketArn', {
      value: this.transcriptsBucket.bucketArn,
      description: 'ARN of the transcripts S3 bucket',
      exportName: `${config.envName}-transcripts-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'TranscriptsTablePrefix', {
      value: 'l1_transcripts',
      description: 'Glue/Athena table prefix (Hive partitions: year=.../month=.../day=.../)',
      exportName: `${config.envName}-transcripts-table-prefix`,
    });

    // ── Jira OAuth secret ─────────────────────────────────────────────────────
    // NSA (2LO / client_credentials) credentials for the airo-app-builder-vpj14963b2
    // service account. Shape: { "clientId": "...", "clientSecret": "..." }
    // After deploy: populate via AWS Console → Secrets Manager → set the real values.
    // debug-console reads this via JIRA_OAUTH_SECRET_ARN env var (Katana secret).
    const jiraOauthSecret = new secretsmanager.Secret(this, 'JiraOauthSecret', {
      secretName: `${config.envName}-airo-supportplane-jira-oauth`,
      description: 'Atlassian OAuth 2.0 client_credentials for the SupportPlane NSA service account (airo-app-builder-vpj14963b2)',
      secretObjectValue: {
        clientId:     cdk.SecretValue.unsafePlainText('REPLACE_ME'),
        clientSecret: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Grant console-service ECS task roles GetSecretValue on the Jira secret.
    const consoleRoleArns = consoleWriterRoleArns.length > 0
      ? consoleWriterRoleArns
      : config.katanaEcsTaskRoleArn;

    for (const roleArn of consoleRoleArns) {
      jiraOauthSecret.addToResourcePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [jiraOauthSecret.secretArn],
        principals: [new iam.ArnPrincipal(roleArn)],
      }));
    }

    new cdk.CfnOutput(this, 'JiraOauthSecretArn', {
      value: jiraOauthSecret.secretArn,
      description: 'ARN of the Jira OAuth secret — set as JIRA_OAUTH_SECRET_ARN in Katana',
      exportName: `${config.envName}-supportplane-jira-oauth-secret-arn`,
    });
  }
}
