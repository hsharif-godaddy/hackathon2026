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
  bedrockAssumeRoleArns: string[];
  gocodeAssumeRoleArns: string[];
  awsIamJwtAccount: string;
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
  bedrockAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  gocodeAssumeRoleArns: [
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
  },
  awsIamJwtAccount: '847636408845'
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
  bedrockAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  gocodeAssumeRoleArns: [
    'arn:aws:iam::418549769352:role/pioneerc1-custom-pioneerc1-hybrid-instance-c4-onegroup',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Dev-Private-PowerUser',
    'arn:aws:iam::418549769352:role/GD-AWS-USA-GD-PioneerC1-Ops'
  ],
  vpnIps: {},
  awsIamJwtAccount: '333184933228'
};

const prodConfig: Config = {
  account: '644094189644',
  region: 'us-west-2',
  envName: 'prod',
  v2CellAccount: '',  // FIXME : Update with actual prod V2 Cell account when available
  databases: ['prod'],
  backupRetentionDays: 30,
  serverlessV2MinCapacity: 2,
  serverlessV2MaxCapacity: 16,
  mysqlReadersCount: 1,
  bedrockAssumeRoleArns: [
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c24-onegroup',
  ],
  gocodeAssumeRoleArns: [
    'arn:aws:iam::506695300582:role/pioneerc1-custom-pioneerc1-hybrid-instance-c24-onegroup',
  ],
  vpnIps: {},
  awsIamJwtAccount: '377100941779'
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
