import * as path from 'node:path';

import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import config from './config';

const ES_SECRET_NAME = 'essp_deployment_credentials';

export class WatchtowerStack extends GDStack {
  public readonly fn: lambda.Function;
  public readonly fnRole: iam.Role;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const slackSecretName = `${config.envName}-watchtower-slack-webhook`;

    // The `app/` builder log data stream is named per Katana environment and
    // lives on the cluster `config.airoBuilderEsEndpoint` points at (dev+test →
    // non-prod cluster, prod → prod cluster). Names are not uniform across envs.
    // Both dev and test run on the non-prod ESSP cluster. The dev-private app
    // deployment is effectively idle, so the only live non-prod app logs are
    // `app-test` — point both non-prod Watchtower envs at it. Prod has its own
    // cluster + index.
    const APP_LOG_INDEX_BY_ENV: Record<string, string> = {
      dev: 'logs-gdelastic.katana.app-test',
      test: 'logs-gdelastic.katana.app-test',
      prod: 'logs-gdelastic.katana.app-prod-ecs',
    };
    const appLogIndex = APP_LOG_INDEX_BY_ENV[config.envName] ?? 'logs-gdelastic.katana.app-prod-ecs';

    // APM service name matches Katana environment — prod has no suffix.
    const APM_SERVICE_NAME_BY_ENV: Record<string, string> = {
      dev: 'airo-app-builder-dev',
      test: 'airo-app-builder-test',
      prod: 'airo-app-builder',
    };
    const apmServiceName = APM_SERVICE_NAME_BY_ENV[config.envName] ?? 'airo-app-builder';

    // ALB LoadBalancer dimension value — extracted from the appAlbArn in CDK config.
    // Prod appAlbArn is not yet set in config; skip CloudWatch collection until populated.
    const appAlbArn: string | undefined = (config.monitoring as { appAlbArn?: string }).appAlbArn;
    // ALB ARN format: arn:aws:...:loadbalancer/app/<name>/<id>  →  app/<name>/<id>
    const albLoadBalancerName = appAlbArn ? (appAlbArn.split('loadbalancer/')[1] ?? '') : '';

    // ---- Slack webhook secret (CDK-owned, ops fills via console once) ----
    // `generateStringKey: 'initialValue'` is intentional — it must NOT be a key
    // already present in `secretStringTemplate`. CDK appends a random string at
    // this key; if it matched `webhookUrl`, CDK would overwrite the REPLACE_ME
    // placeholder with a random value, producing 401 errors before ops fills it.
    const slackWebhookSecret = new secretsmanager.Secret(this, 'WatchtowerSlackWebhookSecret', {
      secretName: slackSecretName,
      description: 'Slack incoming webhook URL for Watchtower digest. Populated manually post-deploy.',
      generateSecretString: {
        generateStringKey: 'initialValue',
        secretStringTemplate: JSON.stringify({ webhookUrl: 'REPLACE_ME' }),
        excludeCharacters: '"@/\\\\',
      },
      removalPolicy: config.envName === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.gdTrustedLandingZone.networking.vpcId });
    const privateSubnets = this.gdTrustedLandingZone.networking.dxAppSubnets?.subnets?.map(subnet =>
      ec2.Subnet.fromSubnetId(this, `Subnet-${subnet.subnetId}`, subnet.subnetId)
    ) || [];

    const sg = new ec2.SecurityGroup(this, 'WatchtowerSG', {
      vpc, description: 'Security group for Watchtower Lambda', allowAllOutbound: true,
    });

    this.fnRole = new iam.Role(this, 'WatchtowerRole', {
      roleName: `${config.envName}-watchtower-role`,
      description: 'Lambda execution role for Watchtower observability agent',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyName(this, 'PermissionBoundary', 'GD-AWS-SSG-PB-DEFAULT'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        SecretsManagerAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${ES_SECRET_NAME}*`,
                `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${slackSecretName}*`,
                `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${config.airoBuilderEsApiKeySecret}*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt'],
              resources: ['*'],
              conditions: { StringEquals: { 'kms:ViaService': `secretsmanager.${cdk.Aws.REGION}.amazonaws.com` } },
            }),
            // Allow the Lambda to assume the shared GoCode role for LLM calls (Phase 2)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sts:AssumeRole'],
              resources: [`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/airobuilde-custom-${config.envName}-airo-builder-gocode-access`],
            }),
          ],
        }),
      },
    });

    const logGroup = new logs.LogGroup(this, 'WatchtowerLogGroup', {
      logGroupName: `/aws/lambda/${config.envName}-watchtower`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fn = new lambda.Function(this, 'WatchtowerFn', {
      functionName: `${config.envName}-watchtower`,
      description: 'AAB Watchtower observability agent (Phase 2: LLM daily reasoner)',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/watchtower'), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: ['bash', '-c',
            'cd /asset-input && npm install --ignore-scripts && npm run build && cp dist/*.js package.json /asset-output/ && cp -r node_modules /asset-output/'],
          user: 'root',
        },
      }),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: this.fnRole,
      logGroup,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [sg],
      retryAttempts: 0,
      environment: {
        ES_SECRET_NAME,
        SLACK_SECRET_NAME: slackSecretName,
        STATS_INDEX: 'watchtower_stats',
        APP_LOG_INDEX: appLogIndex,
        AIRO_BUILDER_ES_ENDPOINT: config.airoBuilderEsEndpoint,
        AIRO_BUILDER_ES_API_KEY_SECRET: config.airoBuilderEsApiKeySecret,
        APM_INDEX: 'metrics-apm.service_transaction.1m*',
        APM_SERVICE_NAME: apmServiceName,
        // ALB_LOAD_BALANCER_NAME is empty string when appAlbArn is unset (prod TBD);
        // the Lambda skips CloudWatch collection gracefully when this is empty.
        ALB_LOAD_BALANCER_NAME: albLoadBalancerName,
        // GoCode S2S for LLM daily reasoner (Phase 2)
        // Use cdk.Aws.ACCOUNT_ID (deployment account) not config.account —
        // config.account differs from the deployment account in test (269423819379 vs 694282668781).
        GOCODE_ROLE_ARN: `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/airobuilde-custom-${config.envName}-airo-builder-gocode-access`,
        GOCODE_ENDPOINT: config.envName === 'prod'
          ? 'https://api.gocode.caas.gdcorp.tools'
          : 'https://api.gocode.caas.test-gdcorp.tools',
        SSO_HOST: config.envName === 'prod' ? 'sso.godaddy.com' : 'sso.test-godaddy.com',
      },
    });

    const hourly = new events.Rule(this, 'WatchtowerHourly', {
      ruleName: `${config.envName}-watchtower-hourly`,
      description: 'Hourly Watchtower rollup (tripwire mode)',
      schedule: events.Schedule.cron({ minute: '7' }),
    });
    hourly.addTarget(new targets.LambdaFunction(this.fn, { event: events.RuleTargetInput.fromObject({ mode: 'tripwire' }) }));

    const daily = new events.Rule(this, 'WatchtowerDaily', {
      ruleName: `${config.envName}-watchtower-daily`,
      description: 'Daily Watchtower digest',
      schedule: events.Schedule.cron({ minute: '20', hour: '14' }),
    });
    daily.addTarget(new targets.LambdaFunction(this.fn, { event: events.RuleTargetInput.fromObject({ mode: 'daily' }) }));

    this.fn.node.addDependency(this.fnRole);
    this.fn.node.addDependency(logGroup);
    this.fn.node.addDependency(slackWebhookSecret);

    cdk.Tags.of(this).add('Service', 'airo-app-builder');
    cdk.Tags.of(this).add('Component', 'watchtower');
    cdk.Tags.of(this).add('Environment', config.envName);
  }
}
