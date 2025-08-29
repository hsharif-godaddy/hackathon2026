interface Config {
  account: string;
  region: string;
  envName: string;
  route53BaseDomain: string;
}

const devConfig: Config = {
  account: '694282668781',
  region: 'us-west-2',
  envName: 'dev',
  route53BaseDomain: 'airo-builder.dp.aws.gdcld.net'
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
