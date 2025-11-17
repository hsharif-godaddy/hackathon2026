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
  /** ALB ARN for the proxy/backend load balancer (optional) */
  proxyAlbArn?: string;
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
  gocodeAssumeRoleArns: string[];
  katanaEcsTaskRoleArn: string[];  // Katana ECS Task Role for JWT access
  awsIamJwtAccount: string[];
  monitoring: MonitoringConfig;
  jwt: {
    rotationIntervalDays: number;
    keyExpiryDays: number;
    gracePeriodDays: number;
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
  gocodeAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  katanaEcsTaskRoleArn: [
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5688GlobalEcsTaskRole6C689234',
    'arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5808GlobalEcsTaskRoleF525C3A7',
    'arn:aws:iam::694282668781:role/GD-AWS-USA-GD-AiroBuilde-Ops'
  ],
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
    proxyAlbArn: 'arn:aws:elasticloadbalancing:us-west-2:694282668781:loadbalancer/app/airobuildeproxydevprivatc822c546/f5995fa15ce542e9',
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
  }
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
  gocodeAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  katanaEcsTaskRoleArn: ['arn:aws:iam::694282668781:role/airobuilde-custom-KatanaEnvironment5808GlobalEcsTaskRoleF525C3A7'],
  vpnIps: {},
  awsIamJwtAccount: ['333184933228'],
  monitoring: {
    ecsClusterName: 'katanaRuntime',
    rdsClusterIdentifier: 'test-mysql-v2-cluster',
    proxyAlbArn: 'arn:aws:elasticloadbalancing:us-west-2:694282668781:loadbalancer/app/airobuildeproxytestpubli81c42a37/c783043b3e0df23b',
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
  }
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
  gocodeAssumeRoleArns: [
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c24-onegroup',
  ],
  katanaEcsTaskRoleArn: ['arn:aws:iam::644094189644:role/airobuilde-custom-KatanaEnvironment6030GlobalEcsTaskRole99409837'],
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
  }
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
