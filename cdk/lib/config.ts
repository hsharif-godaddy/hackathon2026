interface Config {
  account: string;
  region: string;
  envName: string;
  route53BaseDomain: string;
  v2CellAccount: string;
  databases: string[];
  vpnIps: any;
}

const devConfig: Config = {
  account: '694282668781',
  region: 'us-west-2',
  envName: 'dev',
  route53BaseDomain: 'airo-builder.dp.aws.gdcld.net',
  v2CellAccount: '418549769352',
  databases: ['pre-dev', 'dev', 'test'],
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

let config: Config;

const envName = process.env.ENV_NAME || 'dev';

switch (envName) {
  case 'dev':
    config = devConfig;
    break;
  default:
    throw new Error(`Invalid ENV_NAME value: ${envName} - expected dev, test, or prod`);
}

export default config;
