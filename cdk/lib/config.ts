interface Config {
  account: string;
  region: string;
  envName: string;
  route53BaseDomain: string;
  v2CellAccount: string;
}

const devConfig: Config = {
  account: '694282668781',
  region: 'us-west-2',
  envName: 'dev',
  route53BaseDomain: 'airo-builder.dp.aws.gdcld.net',
  v2CellAccount: '418549769352'
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
