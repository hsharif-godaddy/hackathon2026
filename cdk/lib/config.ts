interface Config {
  account: string;
  region: string;
  envName: string;
  route53BaseDomain: string;
  v2CellAccount: string;
  databases: string[];
  vpnIps: any;
  backupRetentionDays: number;
  serverlessV2MaxCapacity: number;
  bedrockAssumeRoleArns: string[];
}

const devConfig: Config = {
  account: '694282668781',
  region: 'us-west-2',
  envName: 'dev',
  route53BaseDomain: 'airo-builder.dp.aws.gdcld.net',
  v2CellAccount: '418549769352',
  databases: ['pre-dev', 'dev', 'test'],
  backupRetentionDays: 7,
  serverlessV2MaxCapacity: 4,
  bedrockAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  vpnIps: {
    "165.1.180.132/31": "Prisma External (India West)",
    "160.153.26.244/30": "Prisma NAT",
    "166.62.16.233/32": "Prisma NAT",
    "160.153.26.233/32": "Prisma NAT",
    "166.62.16.244/30": "Prisma NAT",
    "132.148.54.234/32": "Prisma NAT",
    "132.148.54.244/30": "Prisma NAT"
  }
};

const testConfig: Config = {
  account: '269423819739',
  region: 'us-west-2',
  envName: 'test',
  route53BaseDomain: 'airo-builder.test.aws.gdcld.net',
  v2CellAccount: '418549769352',
  databases: ['test'],
  backupRetentionDays: 15,
  serverlessV2MaxCapacity: 8,
  bedrockAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  vpnIps: {}
};

const prodConfig: Config = {
  account: 'NOT_DEFINED', // FIXME : Update with actual prod account when available
  region: 'us-west-2',
  envName: 'prod',
  route53BaseDomain: 'airo-builder.aws.gdcld.net',
  v2CellAccount: 'NOT_DEFINED',
  databases: ['prod'],
  backupRetentionDays: 30,
  serverlessV2MaxCapacity: 16,
  bedrockAssumeRoleArns: [
    // FIXME: Update with actual prod role ARNs when available
  ],
  vpnIps: {}
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
