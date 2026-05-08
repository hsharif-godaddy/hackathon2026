import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'node:path';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

/**
 * Airo Investigator Stack
 *
 * Provisions:
 *  - S3 bucket `airo-investigations-<env>` for per-investigation state + reports
 *  - Lambda container image (airo-investigator) that runs the
 *    airo-log-investigate skill via Claude CLI on demand
 *  - IAM role granting the Lambda S3 rw + Secrets Manager read
 *  - Permission for the debug-console app role to Invoke this Lambda
 *
 * State layout in the bucket:
 *   active/<customerId>/<appId>/state.json         current investigation snapshot
 *   active/<customerId>/<appId>/result.md          final report (overwritten per run)
 *   history/<customerId>/<appId>/<investigationId>/state.json     frozen snapshot
 *   history/<customerId>/<appId>/<investigationId>/result.md      frozen report
 *   history/<customerId>/<appId>/<investigationId>/trace.jsonl    claude stream log
 *
 * The Lambda is invoked async (InvocationType=Event) by the debug-console API.
 */
export class AiroInvestigatorStack extends GDStack {
  public readonly stateBucket: s3.Bucket;
  public readonly investigatorFn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // ---- S3 bucket ----
    this.stateBucket = new s3.Bucket(this, 'InvestigationsBucket', {
      bucketName: `airo-investigations-${config.envName}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Prune history older than 90 days. Active state is overwritten in place.
          prefix: 'history/',
          expiration: cdk.Duration.days(90),
        },
        {
          // Multi-part upload orphans.
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.envName !== 'prod',
    });

    // No Secrets Manager entry — all secrets are per-invocation:
    //   - gocodeApiKey is supplied by the user in the console UI and
    //     forwarded in the invoke payload (Claude CLI uses it as
    //     ANTHROPIC_AUTH_TOKEN)
    //   - jomaxToken is forwarded from the calling user's session
    // ANTHROPIC_BASE_URL (the GoCode proxy URL) is a non-secret constant and
    // is set as a plain Lambda environment variable below.

    // ---- VPC + Direct Connect subnets (resolved from trusted landing zone) ----
    // Mirrors gocaas-spend-lambda-stack.ts and langfuse-metrics-essp-exporter-stack.ts.
    // The landing zone's `dxAppSubnets` are the same private DX subnets the
    // debug-console ECS service runs in, so the Lambda ends up in the same
    // VPC + subnet pool as console without hardcoding IDs per environment.
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      vpcId: this.gdTrustedLandingZone.networking.vpcId,
    });
    // Fall through with an empty array if dxAppSubnets isn't resolved at
    // synth time — matches gocaas-spend-lambda-stack.ts. A throw here kills
    // synth for every other stack in `main.ts` because constructors run
    // eagerly when the CDK app loads; we want any real subnet-missing
    // problem to surface as a CloudFormation deploy failure, not as a
    // synth abort that blocks unrelated diffs and deploys.
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map((subnet) =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId),
    ) ?? [];

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Egress for airo-investigator Lambda - reaches console, GoCode, agent containers via DX',
      allowAllOutbound: true,
    });

    // ---- IAM role for the Lambda ----
    const lambdaRole = new iam.Role(this, 'InvestigatorLambdaRole', {
      roleName: `${config.envName}-airo-investigator-role`,
      description: 'Execution role for the Airo investigator Lambda',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'PermissionBoundary',
        'GD-AWS-SSG-PB-DEFAULT',
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        // Required for Lambda to create ENIs in the VPC's private subnets.
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        StateBucket: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                this.stateBucket.bucketArn,
                `${this.stateBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ---- CloudWatch log group (explicit instead of deprecated logRetention) ----
    const logGroup = new logs.LogGroup(this, 'InvestigatorLogGroup', {
      logGroupName: `/aws/lambda/airo-investigator-${config.envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // ---- Lambda (container image built from ../../investigator) ----
    this.investigatorFn = new lambda.DockerImageFunction(this, 'InvestigatorFn', {
      functionName: `airo-investigator-${config.envName}`,
      description: 'Runs the airo frontend log investigator skill via Claude CLI',
      // `assetName` is required by GDStagingStack (AppScopedStagingSynthesizer)
      // so gd-safeguard can route the image to a per-app ECR repo. Without it
      // CDK fails with "Assets synthesized with AppScopedStagingSynthesizer
      // must include an 'assetName' in the asset source definition."
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', '..', 'investigator'), {
        assetName: 'airo-investigator',
        // Pull the Lambda base from Airo's private ECR mirror. The mirror is
        // created by LambdaBaseEcrStack and populated by
        // docker-mirror-lambda-base.yml before this Docker asset builds.
        buildArgs: {
          LAMBDA_BASE_REPO: `${config.account}.dkr.ecr.${config.region}.amazonaws.com/lambda-nodejs`,
          LAMBDA_BASE_TAG: '22',
        },
        // The Lambda is explicitly X86_64 below. Force the Docker asset to
        // linux/amd64 so local Apple Silicon builds cannot publish an ARM64
        // image that Lambda rejects with Runtime.InvalidEntrypoint.
        platform: ecrAssets.Platform.LINUX_AMD64,
        cmd: ['handler.handler'],
      }),
      role: lambdaRole,
      // Claude CLI is CPU-bound during search/synthesis. Lambda allocates CPU
      // proportional to memory, so use ~2 vCPU in dev-private and ~4 vCPU in
      // prod without changing the 15-minute safety cap.
      memorySize: config.envName === 'prod' ? 8192 : 4096,
      timeout: cdk.Duration.minutes(15),
      ephemeralStorageSize: cdk.Size.gibibytes(4),
      architecture: lambda.Architecture.X86_64,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        STATE_BUCKET: this.stateBucket.bucketName,
        ANTHROPIC_BASE_URL: 'https://caas-gocode-prod.caas-prod.prod.onkatana.net',
        // The frontend log searcher honors CONSOLE_BASE. Set it here so
        // dev-private runs hit the test console instead of production.
        CONSOLE_BASE: config.envName === 'prod'
          ? 'https://console.airo-builder.godaddy.com'
          : 'https://console.airo-builder.test-godaddy.com',
        // GoCode proxy validator rejects Anthropic API fields it doesn't
        // understand. Claude CLI >=2.1 sends the beta `context_management`
        // field (automatic compaction), and the proxy returns
        // "context_management: Extra inputs are not permitted". This flag
        // tells the CLI to skip all experimental beta features so only
        // stable, proxy-compatible payloads go out.
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup,
    });

    // ---- Allow debug-console's app role to invoke this Lambda ----
    // Narrowly scoped to the console Katana ECS task role(s) for this env
    // (see config.investigatorInvokerRoleArns). `addPermission` creates an
    // explicit AWS::Lambda::Permission / resource-policy entry; using
    // `grantInvoke` on a role imported via `fromRoleArn({ mutable: false })`
    // can silently skip attaching the resource policy, leaving the Lambda
    // unreachable from the calling role.
    for (const roleArn of config.investigatorInvokerRoleArns ?? []) {
      this.investigatorFn.addPermission(`InvokeFromConsole-${hash(roleArn)}`, {
        principal: new iam.ArnPrincipal(roleArn),
        action: 'lambda:InvokeFunction',
      });
    }

    // ---- Allow debug-console's app role to read/write state bucket directly ----
    // Console creates the initial state.json (lock acquire) and polls for
    // updates; we keep this tight to the same console role(s) that can
    // invoke the Lambda.
    //
    // Scoping: the console only needs `active/` for lock acquire, state
    // polling, and inline report fetch. `history/` is written exclusively
    // by the Lambda and exists for audit only — we do NOT grant the
    // console write access to it (a compromised console role could
    // otherwise overwrite archived investigations for other customers).
    // `ListBucket` is scoped to `active/*` via a `s3:prefix` condition
    // for the same reason.
    if ((config.investigatorInvokerRoleArns ?? []).length > 0) {
      const principals = config.investigatorInvokerRoleArns.map((arn) => new iam.ArnPrincipal(arn));

      this.stateBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'ConsoleReadWriteActivePrefix',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`${this.stateBucket.bucketArn}/active/*`],
        principals,
      }));

      this.stateBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'ConsoleListActivePrefix',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [this.stateBucket.bucketArn],
        principals,
        conditions: {
          StringLike: { 's3:prefix': ['active/*'] },
        },
      }));
    }

    // ---- Outputs ----
    new cdk.CfnOutput(this, 'InvestigatorFnName', {
      value: this.investigatorFn.functionName,
      description: 'Set INVESTIGATE_LAMBDA_FN on debug-console to this value',
    });
    new cdk.CfnOutput(this, 'StateBucketName', {
      value: this.stateBucket.bucketName,
      description: 'Set INVESTIGATE_BUCKET on debug-console to this value',
    });
  }
}

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).slice(0, 8);
}
