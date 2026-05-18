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
 *   events/<customerId>/<appId>/<investigationId>/NNNNNN.json     append-only event log (SSE source)
 *   summaries/<yyyy-mm-dd>/<investigationId>.json  durable per-investigation summary card
 *   summaries/_meta/<investigationId>.pointer.json id → date pointer for direct lookup
 *   analysis/<customerId>/<appId>/<investigationId>.json  structured analysis sidecar (Lambda-written)
 *
 * The Lambda is invoked async (InvocationType=Event) by the debug-console API.
 */
export class AiroInvestigatorStack extends GDStack {
  public readonly stateBucket: s3.Bucket;
  public readonly investigatorFn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    // debug-console fetches presigned GET URLs for result.md directly from
    // the browser so the report can stream regardless of size. Without CORS
    // the browser blocks the cross-origin request even though the signature
    // is valid.
    const corsAllowedOrigins: string[] = config.envName === 'prod'
      ? ['https://console.airo-builder.godaddy.com']
      : [
        'https://console.airo-builder.test-godaddy.com',
        'http://localhost:3000',
        'http://localhost:8080',
      ];

    // ---- S3 bucket ----
    this.stateBucket = new s3.Bucket(this, 'InvestigationsBucket', {
      bucketName: `airo-investigations-${config.envName}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: corsAllowedOrigins,
          // Presigned GETs carry auth in the query string — no custom
          // request headers are needed. Keep tight to shrink surface.
          allowedHeaders: [],
          exposedHeaders: ['ETag', 'Content-Length', 'Content-Type'],
          maxAge: 300,
        },
      ],
      lifecycleRules: [
        {
          // Prune history older than 90 days. Active state is overwritten in place.
          prefix: 'history/',
          expiration: cdk.Duration.days(90),
        },
        {
          // Event log for live SSE stream + future subscribers. Short-lived —
          // once an investigation is terminal, the history/ snapshot is the
          // record of truth. 30 days is plenty for debugging replays.
          prefix: 'events/',
          expiration: cdk.Duration.days(30),
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

    // Per-invocation auth strategy (gated by GOCODE_USE_S2S_AUTH env var):
    //
    //   GOCODE_USE_S2S_AUTH=true
    //     handler.mjs uses gd-auth-client to mint a GoCode IAM JWT directly
    //     from the Lambda's execution role (the role ARN in the JWT's sub
    //     claim must be registered with GoCode S2S — see note below). The
    //     JWT is passed to Claude CLI as ANTHROPIC_AUTH_TOKEN (sent as
    //     Authorization: Bearer against GoCode's Anthropic-compatible
    //     /v1/messages endpoint).
    //
    //   GOCODE_USE_S2S_AUTH=false (default)
    //     gocodeApiKey is supplied by the user in the console UI and
    //     forwarded in the invoke payload; Claude CLI uses it as
    //     ANTHROPIC_AUTH_TOKEN against the legacy Anthropic proxy endpoint.
    //
    // jomaxToken is always per-invocation (forwarded from user's session).
    //
    // NOTE: the execution role (${env}-airo-investigator-role) must be
    // registered with GoCode S2S before GOCODE_USE_S2S_AUTH=true works.
    // Open a "Register or Update S2S Access" issue in gdcorp-dna/gocode
    // with the role ARN as the auth identity. See confluence
    // "Guide for GoCode Service to Service API Calling for Dummies".

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
        // Required so gd-auth-client IamTokenClient can call the GoCode
        // SSO IAM JWT API Gateway. Without this, token mint returns 403
        // before GoCode sees the request. Mirrors the iamJwtAccess policy
        // on the agents gocode-access role (cdk/lib/application-stack.ts):
        // same action, same resource pattern, same account list sourced
        // from config.awsIamJwtAccount so dev-p covers both dev + test
        // GoCode environments.
        GoCodeSsoIamJwt: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['execute-api:Invoke'],
              resources: config.awsIamJwtAccount.map(
                (acct) => `arn:aws:execute-api:*:${acct}:*`,
              ),
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
        // S2S auth enabled in both envs after GoCode approved the
        // ${env}-airo-investigator-role registrations (dev-p → GoCode
        // test, prod → GoCode prod).
        GOCODE_USE_S2S_AUTH: 'true',
        // GoCode S2S endpoint (Anthropic + OpenAI compatible, Bearer JWT).
        // Must match the GoCode env the role was registered with.
        ANTHROPIC_BASE_URL: config.envName === 'prod'
          ? 'https://api.gocode.caas.gdcorp.tools'
          : 'https://api.gocode.caas.test-gdcorp.tools',
        SSO_HOST: ssoHostForEnv(config.envName),
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

      // SSE stream route reads per-investigation event objects. Read-only —
      // the Lambda is the sole writer. Same cross-customer isolation rationale
      // as history/: a compromised console role must not be able to forge
      // events for other customers.
      this.stateBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'ConsoleReadEventsPrefix',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [`${this.stateBucket.bucketArn}/events/*`],
        principals,
      }));

      // Summary cards written by debug-console on terminal observation.
      // analysis/ is written by the Lambda but read by debug-console when
      // building summaries (readAnalysis in ensureSummary).
      this.stateBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'ConsoleReadWriteSummariesPrefix',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [
          `${this.stateBucket.bucketArn}/summaries/*`,
          `${this.stateBucket.bucketArn}/analysis/*`,
        ],
        principals,
      }));

      this.stateBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'ConsoleListActiveEventsAndSummariesPrefix',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [this.stateBucket.bucketArn],
        principals,
        conditions: {
          StringLike: { 's3:prefix': ['active/*', 'events/*', 'summaries/*'] },
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

// Per-env SSO host used by gd-auth-client IamTokenClient to mint the JWT.
// Dev-private targets the test SSO (matches the pattern agents service
// uses in dev-p). Prod targets the prod SSO. AiroInvestigatorStack is not
// deployed to test (see cdk/app/main.ts).
//
// This is a 2-way switch on purpose: only `prod` and `dev` (= dev-private)
// envs deploy this stack today. agents/.../s2s-auth.ts has a 3-way switch
// because it also serves a separate `test` env. If a future envName like
// `test` or a fresh dev variant is added here, extend this map FIRST —
// the catch-all `else` branch will silently route any new env to the
// test SSO, which only happens to be correct for dev-p by coincidence.
function ssoHostForEnv(envName: string): string {
  if (envName === 'prod') return 'sso.godaddy.com';
  if (envName === 'dev') return 'sso.test-godaddy.com';
  throw new Error(`ssoHostForEnv: unsupported envName "${envName}" — extend the map before deploying`);
}


function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).slice(0, 8);
}
