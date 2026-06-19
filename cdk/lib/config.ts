/**
 * Monitoring configuration for CloudWatch alarms
 */
interface MonitoringConfig {
  /** ECS cluster name to monitor */
  ecsClusterName: string;
  /** ECS service name to monitor (optional) */
  ecsServiceName?: string;
  /** ALB ARN for the app/frontend load balancer (optional) */
  appAlbArn?: string;
  /** RDS cluster identifier to monitor */
  rdsClusterIdentifier: string;
  /** Thresholds for various alarm metrics */
  alarmThresholds: {
    /** ALB 5xx error count threshold (per 5 minutes) */
    alb5xxThreshold: number;
    /** ALB 4xx error count threshold (per 5 minutes) */
    alb4xxThreshold: number;
    /** ALB high traffic threshold (requests per minute) */
    albHighTpsThreshold: number;
    /** ECS maximum CPU/memory utilization percentage */
    ecsMaxUtilization: number;
    /** RDS maximum utilization percentage */
    rdsMaxUtilization: number;
    /** RDS maximum database connections */
    rdsMaxConnections: number;
  };
}

/**
 * Main configuration interface for Airo Builder CDK stacks
 */
interface Config {
  account: string;
  region: string;
  envName: string;
  v2CellAccount: string;
  databases: string[];
  vpnIps: any;
  backupRetentionDays: number;
  serverlessV2MinCapacity: number;
  serverlessV2MaxCapacity: number;
  mysqlReadersCount: number;
  // PostgreSQL configuration
  postgresDatabases: string[];
  postgresBackupRetentionDays: number;
  postgresServerlessV2MinCapacity: number;
  postgresServerlessV2MaxCapacity: number;
  postgresReadersCount: number;
  gocodeAssumeRoleArns: string[];
  s2sIamJwtAssumeRoleArns: string[];
  katanaEcsTaskRoleArn: string[];  // Katana ECS Task Role for JWT access
  /**
   * Katana ECS task role ARN(s) for the stripe-service Go microservice.
   * Populating this and re-deploying AiroStripeServiceStack attaches
   * DynamoDB / Secrets / KMS grants to those roles. Starts empty in
   * envs where AiroStripeServiceStack isn't yet instantiated (see
   * main.ts).
   */
  stripeServiceTaskRoleArns: string[];
  /**
   * Gateway egress CIDRs that the stripe-service WAFv2 WebACL allows. All
   * other ingress is blocked at the ALB level. Sourced from the Gateway IPs
   * Confluence page (PCP 6702, us-west-2 NAT IPs for this env) plus the
   * shared TGW CIDR ranges required for services with public origins.
   * https://godaddy-corp.atlassian.net/wiki/spaces/EDGE/pages/3682328004
   */
  stripeGatewayEgressCidrs: string[];
  /**
   * ARNs of the debug-console Katana ECS task role(s) allowed to invoke the
   * investigator Lambda and read/write the investigations state bucket.
   * Scoped narrowly (only the console role) — the broader
   * `katanaEcsTaskRoleArn` list is for JWT access and doesn't need invoke
   * permission on the investigator.
   *
   * NOTE: only put roles here that need full S3 R/W on active/, summaries/,
   * analysis/ and read on events/. The website BFF doesn't need any of
   * these — for a role that only reads `active/<id>/state.json` for the
   * fan-out lock, use `investigatorBffReaderRoleArns` instead.
   */
  investigatorInvokerRoleArns: string[];
  /**
   * ARNs of the website BFF Katana ECS task role(s) that need to invoke
   * the investigator Lambda AND read the active-investigation lock file
   * — and nothing else. Granted only:
   *   - `lambda:InvokeFunction` on the investigator Lambda
   *   - `s3:GetObject` on `active/<customerId>/<appId>/state.json` keys
   * History, events, summaries, and analysis prefixes stay off-limits so a
   * compromised website role can't forge or wipe other customers'
   * investigations. Empty list = no BFF reader principals attached.
   */
  investigatorBffReaderRoleArns: string[];
  awsIamJwtAccount: string[];
  /** Base URL for the CRM API (mTLS endpoint). */
  crmApiBase: string;
  /**
   * Secret path name for the Katana-managed AIRO_CLIENT_CERT secret.
   * Used as both Lambda env var (CRM_CERT_SECRET_ARN) and SecretId in GetSecretValue.
   * Dev:  /Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_CERT
   * Prod: /Katana/Secrets/airobuilde/app/prod-ecs/AIRO_CLIENT_CERT
   */
  crmCertSecretArn: string;
  /**
   * Secret path name for the Katana-managed AIRO_CLIENT_KEY secret.
   * Dev:  /Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_KEY
   * Prod: /Katana/Secrets/airobuilde/app/prod-ecs/AIRO_CLIENT_KEY
   */
  crmKeySecretArn: string;
  /**
   * Additional secret path prefixes to allow in IAM GetSecretValue.
   * Dev grants both pre-test and test Katana envs so either can be used.
   */
  crmExtraSecretPrefixes?: string[];
  /** Loki endpoint for direct log queries from the investigator Lambda. */
  lokiEndpoint: string;
  /** Airo-app ES endpoint for frontend log queries. */
  airoBuilderEsEndpoint: string;
  /**
   * ASM secret path names for direct evidence query credentials.
   * Lambda reads these at runtime; all are plain-string secrets.
   */
  lokiApiKeySecret: string;
  airoBuilderEsApiKeySecret: string;
  /**
   * Secrets Manager secret name holding the agents-service JWT signing keys
   * (the `${env}-airo-jwt-keys` secret created by AiroJWTKeyStack). The
   * investigator Lambda reads the active key to mint an agents-service token,
   * mirroring app/'s JWTService and debug-console's agent-jwt
   * (JWT_SECRETS_NAME).
   */
  jwtSecretsName: string;
  /**
   * IAM role ARN for the GH Actions runner that uploads the platform
   * code-review-graph to S3 (refresh-platform-graph.yml). Granted
   * s3:PutObject on the platform-graph/ prefix only (bucket resource
   * policy). This is the self-hosted `airo-cicd-runners` instance role
   * (GD-AWS-USA-GD-AiroBuilde-CICD in 754151945003) — the identity the
   * runner actually presents (confirmed via an upload AccessDenied error
   * naming the assumed-role). Same pool serves dev + prod, so the same
   * principal is granted on each env's bucket. Empty string = no grant
   * (Lambda still reads what's there; the builder upload 403s until the
   * stack is deployed with this grant).
   */
  platformGraphBuilderRoleArn?: string;
  /** Public base URL for the debug-console service in this environment. */
  debugConsoleBaseUrl: string;
  /** Full URL for the GoDaddy SSO token endpoint (used by investigator to mint JWTs). */
  ssoEndpoint: string;
  /**
   * Atlassian tenant base URL. Same tenant for all envs. Used by the fanout
   * Lambda only to build human-facing `/browse/<key>` deep-links in the Slack
   * message — NOT for API calls (those go through the api.atlassian.com
   * gateway built from jiraCloudId; see jiraCloudId and jira-client.mjs).
   */
  jiraBaseUrl: string;
  /**
   * Atlassian cloud ID for the tenant. The fanout Lambda's jira-client.mjs
   * calls the REST API via the NSA OAuth gateway URL
   * `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...`. Same tenant
   * (godaddy-corp) for all envs.
   */
  jiraCloudId: string;
  /**
   * Jira project key the fanout Lambda creates issues under. AABSP =
   * "AAB Support Plane" (Suresh Gupta). Issues land here for triage.
   */
  jiraProjectKey: string;
  /**
   * Salesforce Lightning base URL for building deep-links to CRM cases in
   * the fanout Slack message. Format: `https://<org>.lightning.force.com`.
   * Lambda builds case URLs as `${base}/lightning/r/Case/${caseRecordId}/view`.
   * Empty string disables CRM hyperlinking — Slack message renders the
   * case number as plain text instead. Useful for sandbox envs where the
   * Lightning instance differs from prod.
   */
  salesforceLightningBase: string;
  monitoring: MonitoringConfig;
  jwt: {
    rotationIntervalDays: number;
    keyExpiryDays: number;
    gracePeriodDays: number;
  };
  dataLakeAdminRoleNames: string[];
  /** Cross-account DPaaS EMR batch roles with read/write on the events bucket. */
  eventsEmrBatchRoleArns: string[];
  /**
   * Daily budget-service → S3 lake export Lambda.
   * `dbUrlSecretName` is the Secrets Manager secret *name* (path) whose
   * SecretString is a libpq connection URL
   * (postgres://user:pass@host:port/db?sslmode=require) — matches the
   * existing Katana DATABASE_URL secret budget-service uses. The stack
   * builds the wildcarded ARN for IAM. Empty value makes
   * BudgetServiceLakeExportStack a no-op so envs that haven't been wired
   * up yet still synth/deploy.
   */
  budgetServiceLakeExport: {
    dbUrlSecretName: string;
  };
  /**
   * Hourly DLMS partition registration for SEO quality lake table.
   * Empty `lakeDatabaseName` makes SeoQualityLakePartitionStack a no-op.
   */
  seoQualityLakePartition: {
    lakeDatabaseName: string;
    lakeTableName: string;
    lakeApiEnv: 'dev' | 'test' | 'prod';
  };
}

const devConfig: Config = {
  account: '694282668781',
  region: 'us-west-2',
  envName: 'dev',
  v2CellAccount: '418549769352',
  databases: ['pre-dev', 'dev', 'test'],
  backupRetentionDays: 7,
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 4,
  mysqlReadersCount: 0,
  // PostgreSQL configuration
  postgresDatabases: ['dev'],
  postgresBackupRetentionDays: 7,
  postgresServerlessV2MinCapacity: 0.5,
  postgresServerlessV2MaxCapacity: 4,
  postgresReadersCount: 0,
  gocodeAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops',
    'arn:aws:iam::694282668781:role/airobuilde-custom-dev-gocode-spend-sync-role',
  ],
  s2sIamJwtAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops',
    'arn:aws:iam::694282668781:role/airobuilde-custom-dev-gocode-spend-sync-role',
  ],
  katanaEcsTaskRoleArn: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment1046GlobalEcsTaskRoleCA367FA5', // pretest
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5688GlobalEcsTaskRole6C689234',
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5808GlobalEcsTaskRoleF525C3A7',
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment9599GlobalEcsTaskRole78E503A1', // budget-service dev-private
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment7794GlobalEcsTaskRole03DD121F', // console-service dev-private
    'arn:aws:iam::694282668781:role/GD-AWS-USA-GD-AiroBuilde-Ops'
  ],
  stripeServiceTaskRoleArns: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment1017GlobalEcsTaskRole6285482A', // stripe-service dev-private
  ],
  // dev-private NAT (PCP 6702, us-west-2) + TGW ranges (required for public-origin services)
  stripeGatewayEgressCidrs: [
    '54.68.138.152/32', // dev-private NAT us-west-2
    '160.153.192.0/20', // TGW ARIN
    '118.139.184.0/22', // TGW APNIC
    '146.255.32.0/22',  // TGW RIPE
  ],
  investigatorInvokerRoleArns: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment7794GlobalEcsTaskRole03DD121F', // console-service dev-private
  ],
  // Website BFF — fan-out lock reader only. Granted Invoke + GetObject on
  // active/*/state.json so duplicate-submit detection works, with no
  // ListBucket / no PutObject / no access to history/events/summaries/
  // analysis. See investigator-stack.ts BffReaderInvoke + BffReaderActive
  // policies.
  investigatorBffReaderRoleArns: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment1046GlobalEcsTaskRoleCA367FA5', // website pre-test
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5808GlobalEcsTaskRoleF525C3A7', // website test
  ],
  crmApiBase: process.env.CRM_API_BASE ?? 'https://crm.int.test-godaddy.com',
  crmCertSecretArn: '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_CERT',
  crmKeySecretArn: '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_KEY',
  crmExtraSecretPrefixes: ['/Katana/Secrets/airobuilde/app/test/AIRO_CLIENT_'],
  lokiEndpoint: 'https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd',
  airoBuilderEsEndpoint: 'https://airobuilde-non-prod-usw2.es.us-west-2.aws.found.io:9243',
  lokiApiKeySecret: '/Katana/Secrets/airobuilde/console/dev-private/LOKI_API_KEY',
  airoBuilderEsApiKeySecret: '/Katana/Secrets/airobuilde/console/dev-private/AIRO_BUILDER_ES_API_KEY',
  jwtSecretsName: 'dev-airo-jwt-keys',
  platformGraphBuilderRoleArn: 'arn:aws:iam::754151945003:role/GD-AWS-USA-GD-AiroBuilde-CICD',
  debugConsoleBaseUrl: 'https://console.airo-builder.int.test-gdcorp.tools',
  ssoEndpoint: 'https://sso.test-godaddy.com/v1/secure/api/token',
  vpnIps: {
    "165.1.180.132/31": "Prisma External (India West)",
    "160.153.26.244/30": "Prisma NAT",
    "166.62.16.233/32": "Prisma NAT",
    "160.153.26.233/32": "Prisma NAT",
    "166.62.16.244/30": "Prisma NAT",
    "132.148.54.234/32": "Prisma NAT",
    "132.148.54.244/30": "Prisma NAT"
  },
  awsIamJwtAccount: ['847636408845', '333184933228'],
  monitoring: {
    ecsClusterName: 'katanaRuntime',
    rdsClusterIdentifier: 'dev-mysql-v2-cluster',
    appAlbArn: 'arn:aws:elasticloadbalancing:us-west-2:694282668781:loadbalancer/app/airobuildeappdevprivatee66716e84/34f28f40a512e6fa',
    alarmThresholds: {
      alb5xxThreshold: 10,
      alb4xxThreshold: 50,
      albHighTpsThreshold: 1000,
      ecsMaxUtilization: 90,
      rdsMaxUtilization: 80,
      rdsMaxConnections: 100,
    },
  },
  jwt: {
    rotationIntervalDays: 7,    // Rotate keys weekly
    keyExpiryDays: 60,          // Keys expire after 60 days
    gracePeriodDays: 30         // Keep old keys for 30 days during rotation
  },
  dataLakeAdminRoleNames: [
    'GD-AWS-USA-GD-AiroBuilde-Ops',
    'GD-AWS-USA-GD-AiroBuilde-Dev-Private-PowerUser',
  ],
  eventsEmrBatchRoleArns: [],
  jiraBaseUrl: 'https://godaddy-corp.atlassian.net',
  jiraCloudId: '1f012970-03f4-4025-b750-cbaa332d8a3b',
  jiraProjectKey: 'AABSP',
  // Dev/test CRM (CMAPI) creates cases against the same Salesforce prod
  // Lightning instance the support team uses today; verified from
  // `https://godaddy-corp.atlassian.net/wiki/spaces/CARESFINT/pages/3863389051`.
  // If a sandbox-specific Lightning URL ever ships, override per env.
  salesforceLightningBase: 'https://godaddy2.lightning.force.com',
  budgetServiceLakeExport: {
    // Katana-managed DATABASE_URL secret (libpq connection URL).
    // SuperUser credentials for now — swap to a read-only role secret
    // before flipping the export on for prod.
    dbUrlSecretName: '/Katana/Secrets/airobuilde/budget-service/dev-private/DATABASE_URL',
  },
  seoQualityLakePartition: {
    lakeDatabaseName: 'airo_builder_cln_laketest',
    lakeTableName: 'airo_builder_seo_quality_cln_laketest',
    // Laketest tables are registered in DLMS test (not dev API).
    lakeApiEnv: 'test',
  },
};

const testConfig: Config = {
  account: '269423819739',
  region: 'us-west-2',
  envName: 'test',
  v2CellAccount: '418549769352',
  databases: ['test'],
  backupRetentionDays: 15,
  serverlessV2MinCapacity: 0.5,
  serverlessV2MaxCapacity: 8,
  mysqlReadersCount: 0,
  // PostgreSQL configuration
  postgresDatabases: ['test'],
  postgresBackupRetentionDays: 15,
  postgresServerlessV2MinCapacity: 0.5,
  postgresServerlessV2MaxCapacity: 8,
  postgresReadersCount: 0,
  gocodeAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  s2sIamJwtAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  katanaEcsTaskRoleArn: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5808GlobalEcsTaskRoleF525C3A7', // airo builder ui test
    'arn:aws:iam::269423819739:role/airobuilde-custom-KatanaEnvironment9636GlobalEcsTaskRoleC9421049', // budget-service test
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment7794GlobalEcsTaskRole03DD121F', // console-service dev-private (test is dev-private only for console)
  ],
  stripeServiceTaskRoleArns: [
    'arn:aws:iam::269423819739:role/airobuilde-custom-KatanaEnvironment1080GlobalEcsTaskRole41B00ECB', // stripe-service test
  ],
  // test NAT (PCP 6702, us-west-2) + TGW ranges (required for public-origin services)
  stripeGatewayEgressCidrs: [
    '54.189.94.106/32', // test NAT us-west-2
    '160.153.192.0/20', // TGW ARIN
    '118.139.184.0/22', // TGW APNIC
    '146.255.32.0/22',  // TGW RIPE
  ],
  // AiroInvestigatorStack isn't deployed in test (see main.ts), so these are
  // safe empty lists; kept here to satisfy the type contract.
  investigatorInvokerRoleArns: [],
  investigatorBffReaderRoleArns: [],
  crmApiBase: process.env.CRM_API_BASE ?? 'https://crm.int.test-godaddy.com',
  crmCertSecretArn: '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_CERT',
  crmKeySecretArn: '/Katana/Secrets/airobuilde/app/pre-test/AIRO_CLIENT_KEY',
  crmExtraSecretPrefixes: ['/Katana/Secrets/airobuilde/app/test/AIRO_CLIENT_'],
  lokiEndpoint: 'https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd',
  airoBuilderEsEndpoint: 'https://airobuilde-non-prod-usw2.es.us-west-2.aws.found.io:9243',
  lokiApiKeySecret: '/Katana/Secrets/airobuilde/console/dev-private/LOKI_API_KEY',
  airoBuilderEsApiKeySecret: '/Katana/Secrets/airobuilde/console/dev-private/AIRO_BUILDER_ES_API_KEY',
  jwtSecretsName: 'test-airo-jwt-keys',
  debugConsoleBaseUrl: 'https://console.airo-builder.int.test-gdcorp.tools',
  ssoEndpoint: 'https://sso.test-godaddy.com/v1/secure/api/token',
  vpnIps: {},
  awsIamJwtAccount: ['333184933228'],
  monitoring: {
    ecsClusterName: 'katanaRuntime',
    rdsClusterIdentifier: 'test-mysql-v2-cluster',
    appAlbArn: 'arn:aws:elasticloadbalancing:us-west-2:694282668781:loadbalancer/app/airobuildeapptestdirectc6743dcfc/239795c4eebe32af',
    alarmThresholds: {
      alb5xxThreshold: 15,
      alb4xxThreshold: 75,
      albHighTpsThreshold: 1500,
      ecsMaxUtilization: 90,
      rdsMaxUtilization: 80,
      rdsMaxConnections: 200,
    },
  },
  jwt: {
    rotationIntervalDays: 14,   // Rotate keys bi-weekly in test
    keyExpiryDays: 90,          // Keys expire after 90 days
    gracePeriodDays: 30         // Keep old keys for 30 days during rotation
  },
  dataLakeAdminRoleNames: [
    'GD-AWS-USA-GD-AiroBuilde-Ops',
  ],
  eventsEmrBatchRoleArns: [],
  // FeedbackFanoutStack isn't deployed in test (see main.ts), but jiraBaseUrl,
  // jiraProjectKey, and salesforceLightningBase are required to satisfy the
  // type contract.
  jiraBaseUrl: 'https://godaddy-corp.atlassian.net',
  jiraCloudId: '1f012970-03f4-4025-b750-cbaa332d8a3b',
  jiraProjectKey: 'AABSP',
  salesforceLightningBase: 'https://godaddy2.lightning.force.com',
  budgetServiceLakeExport: {
    dbUrlSecretName: '/Katana/Secrets/airobuilde/budget-service/test/DATABASE_URL',
  },
  seoQualityLakePartition: {
    lakeDatabaseName: '',
    lakeTableName: '',
    lakeApiEnv: 'test',
  },
};

const prodConfig: Config = {
  account: '644094189644',
  region: 'us-west-2',
  envName: 'prod',
  v2CellAccount: '506695300582',
  databases: ['prod'],
  backupRetentionDays: 30,
  serverlessV2MinCapacity: 2,
  serverlessV2MaxCapacity: 16,
  mysqlReadersCount: 1,
  // PostgreSQL configuration
  postgresDatabases: ['prod'],
  postgresBackupRetentionDays: 30,
  postgresServerlessV2MinCapacity: 2,
  postgresServerlessV2MaxCapacity: 16,
  postgresReadersCount: 1,
  gocodeAssumeRoleArns: [
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c24-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c35-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c36-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c37-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c38-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c39-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c40-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c41-onegroup',
    'arn:aws:iam::644094189644:role/airobuilde-custom-prod-gocode-spend-sync-role',
  ],
  s2sIamJwtAssumeRoleArns: [
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c24-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c35-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c36-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c37-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c38-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c39-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c40-onegroup',
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c41-onegroup',
    'arn:aws:iam::644094189644:role/airobuilde-custom-prod-gocode-spend-sync-role',
  ],
  katanaEcsTaskRoleArn: [
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment6030GlobalEcsTaskRole99409837', // airo builder ui prod
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment7797GlobalEcsTaskRole2CAC93CD', // console-service prod
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment9637GlobalEcsTaskRoleCE42F0DB', // budget-service prod
  ],
  stripeServiceTaskRoleArns: [
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment1081GlobalEcsTaskRole31913DA4', // stripe-service prod
  ],
  // prod NAT (PCP 6702, us-west-2) + TGW ranges (required for public-origin services)
  stripeGatewayEgressCidrs: [
    '52.10.30.90/32',   // prod NAT us-west-2
    '44.239.96.28/32',  // prod NAT us-west-2
    '35.85.83.18/32',   // prod NAT us-west-2
    '160.153.192.0/20', // TGW ARIN
    '118.139.184.0/22', // TGW APNIC
    '146.255.32.0/22',  // TGW RIPE
  ],
  investigatorInvokerRoleArns: [
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment7797GlobalEcsTaskRole2CAC93CD', // console-service prod
  ],
  // Website BFF — fan-out lock reader only (see comment in devConfig).
  investigatorBffReaderRoleArns: [
    'arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment6030GlobalEcsTaskRole99409837', // website prod-ecs
  ],
  crmApiBase: process.env.CRM_API_BASE ?? 'https://crm.int.godaddy.com',
  crmCertSecretArn: '/Katana/Secrets/airobuilde/app/prod-ecs/AIRO_CLIENT_CERT',
  crmKeySecretArn: '/Katana/Secrets/airobuilde/app/prod-ecs/AIRO_CLIENT_KEY',
  lokiEndpoint: 'https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd',
  airoBuilderEsEndpoint: 'https://airobuilde-prod-usw2.es.us-west-2.aws.found.io:9243',
  lokiApiKeySecret: '/Katana/Secrets/airobuilde/console/prod/LOKI_API_KEY',
  airoBuilderEsApiKeySecret: '/Katana/Secrets/airobuilde/console/prod/AIRO_BUILDER_ES_API_KEY',
  jwtSecretsName: 'prod-airo-jwt-keys',
  platformGraphBuilderRoleArn: 'arn:aws:iam::754151945003:role/GD-AWS-USA-GD-AiroBuilde-CICD',
  debugConsoleBaseUrl: 'https://console.airo-builder.godaddy.com',
  ssoEndpoint: 'https://sso.godaddy.com/v1/secure/api/token',
  vpnIps: {},
  awsIamJwtAccount: ['377100941779'],
  monitoring: {
    ecsClusterName: 'katanaRuntime',
    rdsClusterIdentifier: 'prod-mysql-v2-cluster',
    alarmThresholds: {
      alb5xxThreshold: 20,
      alb4xxThreshold: 100,
      albHighTpsThreshold: 5000,
      ecsMaxUtilization: 85,
      rdsMaxUtilization: 80,
      rdsMaxConnections: 300,
    },
  },
  jwt: {
    rotationIntervalDays: 30,   // Rotate keys monthly in production
    keyExpiryDays: 120,         // Keys expire after 120 days
    gracePeriodDays: 30         // Keep old keys for 30 days during rotation
  },
  dataLakeAdminRoleNames: [
    'GD-AWS-USA-GD-AiroBuilde-Ops',
  ],
  eventsEmrBatchRoleArns: [
    'arn:aws:iam::664289052486:role/dpaas-custom-enterprise-batch-EMRInstanceRole',
  ],
  jiraBaseUrl: 'https://godaddy-corp.atlassian.net',
  jiraCloudId: '1f012970-03f4-4025-b750-cbaa332d8a3b',
  jiraProjectKey: 'AABSP',
  salesforceLightningBase: 'https://godaddy2.lightning.force.com',
  budgetServiceLakeExport: {
    dbUrlSecretName: '/Katana/Secrets/airobuilde/budget-service/prod/DATABASE_URL',
  },
  seoQualityLakePartition: {
    lakeDatabaseName: 'airo_builder_cln',
    lakeTableName: 'airo_builder_seo_quality_cln',
    lakeApiEnv: 'prod',
  },
};


let config: Config;

const envName = process.env.ENV_NAME || 'dev';

switch (envName) {
  case 'dev':
    config = devConfig;
    break;
  case 'test':
    config = testConfig;
    break;
  case 'prod':
    config = prodConfig;
    break;
  default:
    throw new Error(`Invalid ENV_NAME value: ${envName} - expected dev, test, or prod`);
}

export default config;
