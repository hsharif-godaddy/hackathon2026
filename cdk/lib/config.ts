interface Config {
  account: string;
  region: string;
  envName: string;
}

const config: Config = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '694282668781',
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
  envName: process.env.ENV_NAME || 'dev'
};

export default config;
