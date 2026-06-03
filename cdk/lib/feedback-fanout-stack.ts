import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import { AlarmUtil } from './AlarmUtil';
import config from './config';

/**
 * Props for the feedback fanout Lambda stack.
 *
 * Pass the bucket as ARN + name strings (not the Bucket object) to avoid a
 * cross-stack dependency cycle. CDK's `addEventNotification` on a directly
 * referenced bucket from another stack creates a back-ref that triggers
 * "DependencyCycle" at synth time. Importing via `fromBucketAttributes`
 * inside this stack keeps the BucketNotificationsHandler local to this
 * stack — no cyclic export from FeedbackS3Stack to FeedbackFanoutStack.
 */
interface FeedbackFanoutStackProps extends GDStackProps {
  feedbackBucketArn: string;
  feedbackBucketName: string;
  /**
   * Katana-managed ASM secret PATH (not full ARN) for the airo client cert.
   * Used as the SecretId at runtime; IAM is granted with the wildcard ARN
   * pattern below to tolerate ASM's random suffix.
   */
  crmCertSecretArn: string;
  /** Same as crmCertSecretArn but for the private key. */
  crmKeySecretArn: string;
  crmBaseUrl: string;
  ssoUrl: string;
}

/**
 * Feedback Fanout Lambda Stack
 *
 * Provisions:
 *  - Lambda container image (airo-fanout-<env>) inside the GoDaddy VPC,
 *    invoked DIRECTLY by the BFF (`/api/feedback/s3-store` route)
 *    immediately after the parquet write. Reads the parquet row and fans
 *    out to Slack + CRM (CMAPI) + Jira (AABSP).
 *    There is NO S3 → Lambda trigger: GD's permissions boundary
 *    `GD-AWS-SSG-PB-DEFAULT` denies `s3:PutBucketNotification`, which
 *    CDK's BucketNotificationsHandler (and the EventBridge enable path)
 *    both call. BFF lambda.invoke is the supported pattern.
 *  - CDK-owned Slack webhook + Jira OAuth Secrets Manager secrets,
 *    populated post-deploy by ops via the AWS Console (REPLACE_ME
 *    placeholders are preserved by `generateStringKey: 'initialValue'`
 *    so the Lambda's runtime sentinel-check actually fires).
 *  - SQS DLQ (14-day retention) for catastrophic Lambda failures —
 *    parquet decode crash, Lambda code bug, OOM, IAM deny. Routine
 *    downstream hiccups stay out of the DLQ via the bulkhead pattern
 *    (every downstream wraps in try/catch warn-not-throw; see
 *    `fanout/README.md` for full failure-handling table).
 *  - 4 CloudWatch alarms wired to the env-shared SNS topic via AlarmUtil:
 *    DLQ depth (P0), Lambda errors (P1), Lambda throttles (P1, catches
 *    reservedConcurrentExecutions exhaustion before DLQ noise dominates),
 *    p99 duration > 30s (P2).
 *
 * Reuses:
 *  - The feedback bucket from FeedbackS3Stack (passed as ARN+name strings
 *    and re-imported via `fromBucketAttributes` to avoid a cross-stack
 *    dependency cycle).
 *  - Katana-managed CRM cert + key secrets (CRM_CERT_SECRET_ARN /
 *    CRM_KEY_SECRET_ARN); IAM granted via wildcard ARN to tolerate ASM's
 *    random suffix.
 *
 * Flag-gated entry: per-submission via the `appbuilder-fanout-via-lambda`
 * Switchboard flag. The BFF (`app/src/app/api/feedback/s3-store/route.ts`)
 * resolves the flag at submit time and stamps the boolean into the
 * parquet's `fanout_via_lambda` column. Lambda reads from there — no
 * switchboard client / IAM in Lambda, atomic flip per submission.
 *
 * Image base: pulled from Airo's private ECR mirror (LambdaBaseEcrStack)
 * to satisfy GCI policy. Mirror must be populated by
 * docker-mirror-lambda-base.yml before this stack deploys.
 */
export class FeedbackFanoutStack extends GDStack {
  public readonly fanoutFunction: lambda.DockerImageFunction;
  public readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: FeedbackFanoutStackProps) {
    super(scope, id, props);

    // Import the feedback bucket as an external resource so cross-stack
    // notification wiring stays self-contained in this stack (avoids
    // DependencyCycle between FeedbackS3Stack and FeedbackFanoutStack).
    const feedbackBucket: s3.IBucket = s3.Bucket.fromBucketAttributes(this, 'ImportedFeedbackBucket', {
      bucketArn: props.feedbackBucketArn,
      bucketName: props.feedbackBucketName,
    });

    // Dev-only suffix: the first deploy attempts on dev-private failed
    // (s3:PutBucketNotification denied by GD permissions boundary) and
    // CloudFormation's rollback retained the auto-generated Lambda
    // execution role + RETAIN-policied secrets + log group as orphans.
    // PowerUser SSO can't delete the orphan IAM role (no
    // iam:DeleteRolePolicy). Bumping every CFN identifier with a `-v2`
    // suffix in dev sidesteps the orphans by creating a fresh resource
    // set; test/prod stay clean (first deploy ever, no orphans).
    // TODO(skilaru, AIROBUILD-XXXX): drop the suffix once an admin cleans the
    // dev orphans listed in the tracking ticket. Until then the suffix is bumped
    // each time a failed deploy leaves a fresh orphan (v2 → v4, skipped v3
    // because v3 secrets were RETAIN-policied and orphaned in the v3 attempt).
    // The orphans live in IAM/Secrets and PowerUser SSO cannot delete them.
    const SUFFIX_KEBAB: string = config.envName === 'dev' ? '-v4' : '';
    const SUFFIX_PASCAL: string = config.envName === 'dev' ? 'V4' : '';

    // ---- Slack webhook secret (CDK-owned, ops fills via console once) ----
    // Mirrors airo-stripe-service-stack.ts pattern: CDK creates the Secret
    // with a JSON template containing REPLACE_ME placeholder, RETAIN policy
    // protects the value from stack-destroy churn, and ops populates the
    // real webhook URL via AWS Console after first deploy. Lambda's slack
    // module skips Slack posting when the value is unset/REPLACE_ME.
    //
    // Same convention as the Stripe platform key + webhook signing secrets,
    // JWT keys, and Qdrant API key + TLS certs in this codebase.
    // `generateStringKey: 'initialValue'` is intentional — it must NOT be a
    // key already present in `secretStringTemplate`. CDK appends a random
    // string at this key on first deploy; if it matched `webhookUrl` (or
    // `apiToken` below), CDK would OVERWRITE the REPLACE_ME placeholder with
    // a random value, defeating the silent-skip check in `fanout/slack.mjs`
    // (`url === 'REPLACE_ME'`) and producing 401 Slack-webhook errors on
    // every invoke between deploy and ops-fill. Mirrors
    // airo-stripe-service-stack.ts:95 — same trap, same fix.
    const slackWebhookSecret = new secretsmanager.Secret(this, `SlackFeedbackWebhookSecret${SUFFIX_PASCAL}`, {
      secretName: `${config.envName}-airo-fanout-slack-webhook${SUFFIX_KEBAB}`,
      description: 'Slack incoming webhook URL for fanout Lambda. Populated manually.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: JSON.stringify({ webhookUrl: 'REPLACE_ME' }),
        excludeCharacters: '"@/\\',
      },
      // DESTROY in dev so failed-deploy rollbacks actually delete the secret
      // and prevent "already exists" orphan collisions on the next deploy.
      // RETAIN in test/prod to preserve manually-filled webhook URLs.
      removalPolicy: config.envName === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // ---- Jira OAuth secret (CDK-owned, ops fills via console) ----
    // Same RETAIN-with-REPLACE_ME-template pattern as the Slack webhook secret
    // above. Holds an Atlassian Native Service Account (NSA) OAuth 2.0
    // client_credentials pair `{clientId, clientSecret}`, sourced from CyberArk.
    // The Lambda's jira-client.mjs POSTs these to auth.atlassian.com to mint a
    // short-lived (60-min) Bearer token and calls the api.atlassian.com gateway.
    // NSA credentials have no fixed expiry — Atlassian admins rotate for-cause
    // only — so there is no scheduled-rotation requirement here.
    // Same `generateStringKey: 'initialValue'` trap as the Slack secret above.
    // If `generateStringKey` matched `clientSecret`, CDK would replace the
    // REPLACE_ME placeholder with a random ~32-char string on first deploy,
    // and `fanout/jira-client.mjs` would then attempt a client_credentials mint
    // with a random secret — producing 401s on every Jira call until ops
    // manually overwrites the secret value. Using a key NOT in the template
    // preserves both `clientId` and `clientSecret` as REPLACE_ME so the
    // skip-on-placeholder paths in the Lambda actually work.
    const jiraOauthSecret: secretsmanager.Secret = new secretsmanager.Secret(this, `JiraOauthSecret${SUFFIX_PASCAL}`, {
      secretName: `${config.envName}-airo-fanout-jira-oauth${SUFFIX_KEBAB}`,
      description: 'Atlassian Native Service Account OAuth 2.0 client_credentials (clientId + clientSecret) for AABSP fanout Lambda. Sourced from CyberArk, populated manually post-deploy.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: JSON.stringify({ clientId: 'REPLACE_ME', clientSecret: 'REPLACE_ME' }),
        excludeCharacters: '"@/\\',
      },
      removalPolicy: config.envName === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // ---- Dead Letter Queue ----
    // Retains failed events for 14 days so ops can inspect/replay before
    // they age out. SQS-managed encryption matches the rest of our queues.
    this.dlq = new sqs.Queue(this, `FanoutDLQ${SUFFIX_PASCAL}`, {
      queueName: `airo-fanout-dlq-${config.envName}${SUFFIX_KEBAB}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ---- CloudWatch log group (explicit instead of deprecated logRetention) ----
    // Mirrors investigator-stack.ts and gocaas-spend-lambda-stack.ts.
    const logGroup = new logs.LogGroup(this, `FanoutLogGroup${SUFFIX_PASCAL}`, {
      logGroupName: `/aws/lambda/airo-fanout-${config.envName}${SUFFIX_KEBAB}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // ---- VPC + Direct Connect subnets (resolved from trusted landing zone) ----
    // Mirrors investigator-stack.ts. The Lambda needs to be inside the
    // GoDaddy VPC so it can resolve internal DNS like
    // `sso.test-godaddy.com` (cert-based SSO mint endpoint) and
    // `crm.int.test-godaddy.com` over Direct Connect — these resolve only
    // from the corp network, not from public AWS Lambda networking. Without
    // VPC config the Lambda hits `getaddrinfo ENOTFOUND` on every CRM call.
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      vpcId: this.gdTrustedLandingZone.networking.vpcId,
    });
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map((subnet) =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId),
    ) ?? [];
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, `FanoutLambdaSecurityGroup${SUFFIX_PASCAL}`, {
      vpc,
      description: 'Egress for airo-fanout Lambda - reaches CMAPI, SSO, Slack, Atlassian',
      allowAllOutbound: true,
    });

    // ---- Lambda (container image built from ../../fanout) ----
    this.fanoutFunction = new lambda.DockerImageFunction(this, `FanoutFunction${SUFFIX_PASCAL}`, {
      functionName: `airo-fanout-${config.envName}${SUFFIX_KEBAB}`,
      description: 'Fans out feedback parquet writes to Slack, CRM, and AABSP Jira',
      // `assetName` is required by GDStagingStack (AppScopedStagingSynthesizer)
      // so gd-safeguard can route the image to a per-app ECR repo. Without it
      // CDK fails with "Assets synthesized with AppScopedStagingSynthesizer
      // must include an 'assetName' in the asset source definition."
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', '..', 'fanout'), {
        assetName: 'airo-fanout',
        // Pull the Lambda base from Airo's private ECR mirror — same pattern
        // as investigator-stack.ts. The mirror is created by
        // LambdaBaseEcrStack and populated by docker-mirror-lambda-base.yml.
        buildArgs: {
          LAMBDA_BASE_REPO: `${config.account}.dkr.ecr.${config.region}.amazonaws.com/lambda-nodejs`,
          LAMBDA_BASE_TAG: '22',
        },
        // The Lambda is explicitly ARM_64 below — fanout is light I/O work
        // and ARM is ~20% cheaper. Force the asset platform to linux/arm64
        // so x86 build hosts (legacy CI) cannot publish an x86 image that
        // Lambda rejects with Runtime.InvalidEntrypoint.
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      // Cap concurrent fanout to protect downstream services (Slack, CRM,
      // Jira) from a parquet-writer storm.
      reservedConcurrentExecutions: 50,
      // Disable AWS Lambda async-invocation auto-retry. Default is 2 retries
      // which compounds non-idempotent side effects: each retry re-runs the
      // ENTIRE handler, so any error after `postCase` succeeds (Slack 5xx,
      // Jira 401, state-write race, exec timeout) results in a second CRM
      // case, second Slack message, second Jira issue. CMAPI's async POST is
      // expected to upsert on `externalSystemId` per the documented
      // idempotency contract (see Confluence p4117200898), but we cannot
      // depend on that — observed prod runs produced two consecutive case
      // numbers from a single Lambda invocation when the SF Adapter
      // pipeline retried. With retryAttempts=0, genuine failures land in
      // the DLQ for manual replay (the parquet is the source of truth) and
      // we trade automatic retry for predictable side-effect counts.
      retryAttempts: 0,
      logGroup,
      deadLetterQueue: this.dlq,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        FEEDBACK_BUCKET: feedbackBucket.bucketName,
        SLACK_WEBHOOK_SECRET_ARN: slackWebhookSecret.secretArn,
        CRM_CERT_SECRET_ARN: props.crmCertSecretArn,
        CRM_KEY_SECRET_ARN: props.crmKeySecretArn,
        CRM_BASE_URL: props.crmBaseUrl,
        AIRO_SSO_ENDPOINT: props.ssoUrl,
        // ---- Jira (AABSP) ----
        // Lambda's jira-client.mjs reads `{clientId, clientSecret}` from this
        // secret and mints an NSA OAuth 2.0 client_credentials bearer, then
        // calls the api.atlassian.com gateway (JIRA_CLOUD_ID in the path).
        // JIRA_BASE_URL (tenant) is used only for Slack /browse/<key> links.
        JIRA_OAUTH_SECRET_ARN: jiraOauthSecret.secretArn,
        JIRA_BASE_URL: config.jiraBaseUrl,
        JIRA_CLOUD_ID: config.jiraCloudId,
        JIRA_PROJECT_KEY: config.jiraProjectKey,
        // Salesforce Lightning base URL for building deep-links to CRM
        // cases in the Slack message. Lambda renders
        // `${SALESFORCE_LIGHTNING_BASE}/lightning/r/Case/${caseId}/view` per
        // submission. Empty string disables the hyperlink (case number
        // renders as plain text). Pattern verified against Confluence
        // page 3863389051 (DIFY Salesforce Bug Reporting SOP).
        SALESFORCE_LIGHTNING_BASE: config.salesforceLightningBase,
        // Cutover gating is per-submission via the `appbuilder-fanout-via-lambda`
        // Switchboard flag (resolved by the BFF and stamped into the parquet's
        // `fanout_via_lambda` column). No environment kill-switch — Lambda
        // no-ops on every event whose row lacks `fanout_via_lambda === true`,
        // which is the safe default while the flag rolls out.
        LOG_LEVEL: config.envName === 'prod' ? 'info' : 'debug',
      },
    });

    // ECR repo policy for Lambda pull is NOT managed by this stack.
    //
    // gd-safeguard's AppScopedStagingSynthesizer routes the fanout Docker
    // image asset to a per-app ECR repo (`6082/airo-fanout`). Lambda needs
    // a `LambdaECRImageRetrievalPolicy` resource policy on that repo to
    // pull the image; without it CloudFormation reports:
    //   "AWS Lambda does not have permission to access the provided code
    //    artifact. Please configure the required permissions in the ECR
    //    repository."
    //
    // We CAN'T manage this policy here for two reasons:
    //   1. AwsCustomResource → ecr:SetRepositoryPolicy is denied by the
    //      GD-AWS-SSG-PB-MINIFIED permissions boundary on all Lambda
    //      execution roles in this account.
    //   2. The CI deploy role (GD-AWS-SSG-Deploy-Role) also lacks
    //      ecr:SetRepositoryPolicy, so a pre-deploy CLI step doesn't work
    //      either.
    //
    // Operational note: the policy is provisioned ONCE per env, by an
    // admin SSO with ecr:SetRepositoryPolicy, after the per-app repo first
    // exists (created by the asset publish on first CDK deploy attempt).
    // Once set, the policy persists; CDK deploys after that work fine.
    // gd-safeguard automatically attaches the equivalent
    // LambdaECRImageRetrievalPolicy on most existing per-app repos
    // (verified on prod 6082/airo-fanout and 6082/airo-investigator).
    // If a future gd-safeguard staging refresh wipes the policy, an admin
    // re-attach is required — a CI-managed re-attach is not currently
    // possible without a permissions-boundary exception.

    // ---- IAM ----
    // Read the parquet object that triggered us. Scoped to the table prefix
    // the BFF actually writes to (`airo_builder_feedback_cln*` covers both
    // `airo_builder_feedback_cln` for prod and `airo_builder_feedback_cln_laketest`
    // for non-prod — see app/src/app/api/feedback/s3-store/route.ts:73-75)
    // so the Lambda role can't read other top-level prefixes (e.g. raw user
    // uploads if the bucket is later widened).
    feedbackBucket.grantRead(this.fanoutFunction, 'airo_builder_feedback_cln*/*');
    // Dedup ledger lives under dedup/ inside the same bucket. Lambda needs
    // read+write+delete to manage the ledger.
    feedbackBucket.grantReadWrite(this.fanoutFunction, 'dedup/*');

    // Secrets Manager: CRM cert + key. Two separate Katana-managed secrets;
    // wildcard suffix on each ARN tolerates the random 6-char suffix ASM
    // appends on creation (mirrors investigator-stack.ts's
    // CrmCertKeySecretRead pattern).
    const arnPrefix = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:`;
    this.fanoutFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'CrmCertKeySecretRead',
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `${arnPrefix}${props.crmCertSecretArn}*`,
        `${arnPrefix}${props.crmKeySecretArn}*`,
      ],
    }));

    // Slack webhook secret read — narrow grant on the exact ARN of the
    // CDK-created Secret resource above (no wildcard needed since CDK
    // controls its full ARN deterministically).
    slackWebhookSecret.grantRead(this.fanoutFunction);

    // Jira OAuth secret read — same narrow-grant pattern as Slack above.
    jiraOauthSecret.grantRead(this.fanoutFunction);

    // CDK-owned secrets (slackWebhookSecret + jiraOauthSecret) are
    // encrypted with the AWS-managed `aws/secretsmanager` KMS key. CDK's
    // `secret.grantRead()` only attaches kms:Decrypt when the secret has an
    // explicit customer-managed `encryptionKey`, which is undefined for
    // AWS-managed keys — so the Lambda role would otherwise hit
    // "Access to KMS is not allowed" on every GetSecretValue call. The
    // ViaService condition scopes the grant strictly to Secrets-Manager-
    // initiated decrypts so a compromised role still can't call KMS
    // directly. (CRM cert/key secrets are Katana-managed and use a
    // different KMS path, which is why they don't need this.)
    this.fanoutFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'SecretsManagerKmsDecrypt',
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com`,
        },
      },
    }));

    // ---- BFF invoke grant ----
    // No S3 → Lambda trigger possible: GD's permissions boundary
    // GD-AWS-SSG-PB-DEFAULT explicitly denies s3:PutBucketNotification,
    // which CDK's BucketNotificationsHandler (and the EventBridge enable
    // path) both call. Instead, the BFF /api/feedback/s3-store route
    // synchronously writes the parquet and then invokes this Lambda
    // directly with InvocationType=Event. The Katana ECS task role(s)
    // for the website container need lambda:InvokeFunction on this
    // function. Lambda invoke is NOT denied by the boundary.
    for (const roleArn of config.katanaEcsTaskRoleArn) {
      this.fanoutFunction.grantInvoke(new iam.ArnPrincipal(roleArn));
    }

    // ---- Alarms ----
    // All three alarms route through AlarmUtil so they auto-attach to the
    // env-shared SNS topic from SSM /AdminParams/SNS/AlarmNotificationTopic
    // (Slack notifications). Without AlarmUtil the alarms would fire and
    // self-resolve in CloudWatch but no notification would go out.

    // Any DLQ message means a fanout permanently failed — page immediately.
    AlarmUtil.createCloudWatchAlarm(
      this,
      `DLQDepthAlarm${SUFFIX_PASCAL}`,
      this.dlq.metricApproximateNumberOfMessagesVisible(),
      1,
      `P0: airo-fanout DLQ has messages (${config.envName}) — a fanout permanently failed`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING,
    );

    // Sustained Lambda errors — 5 errors in a 15-minute window.
    AlarmUtil.createCloudWatchAlarm(
      this,
      `LambdaErrorRateAlarm${SUFFIX_PASCAL}`,
      this.fanoutFunction.metricErrors({ period: cdk.Duration.minutes(15) }),
      5,
      `P1: airo-fanout Lambda errors >= 5 in 15 min (${config.envName})`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING,
    );

    // Sustained throttles — Lambda hit reservedConcurrentExecutions ceiling.
    // Errors counter doesn't include throttles when invocation type is Event
    // (those messages get DLQ'd silently). Without this alarm a viral
    // landing page could exhaust the 50-slot reserved concurrency and land
    // every excess submission in DLQ before the DLQ-depth alarm fires.
    // Threshold 5/15min keeps signal:noise reasonable for the rollout
    // (steady state should be 0 throttles).
    AlarmUtil.createCloudWatchAlarm(
      this,
      `LambdaThrottlesAlarm${SUFFIX_PASCAL}`,
      this.fanoutFunction.metricThrottles({ period: cdk.Duration.minutes(15) }),
      5,
      `P1: airo-fanout Lambda throttles >= 5 in 15 min (${config.envName}) — reserved concurrency exhausted`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING,
    );

    // p99 duration > 30s for one 15-min window. Below the 60s timeout but
    // high enough to catch downstream slowness before it becomes a timeout.
    AlarmUtil.createCloudWatchAlarm(
      this,
      `LambdaDurationAlarm${SUFFIX_PASCAL}`,
      this.fanoutFunction.metricDuration({
        statistic: 'p99',
        period: cdk.Duration.minutes(15),
      }),
      cdk.Duration.seconds(30).toMilliseconds(),
      `P2: airo-fanout p99 duration > 30s (${config.envName}) — downstream slow`,
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      cloudwatch.TreatMissingData.NOT_BREACHING,
    );

    // ---- Outputs ----
    new cdk.CfnOutput(this, 'FanoutFunctionArn', {
      value: this.fanoutFunction.functionArn,
      exportName: `${config.envName}-fanout-function-arn`,
    });
    new cdk.CfnOutput(this, 'FanoutFunctionName', {
      value: this.fanoutFunction.functionName,
      description: 'airo-fanout Lambda function name',
    });
    new cdk.CfnOutput(this, 'FanoutDLQArn', {
      value: this.dlq.queueArn,
      exportName: `${config.envName}-fanout-dlq-arn`,
    });
  }
}
