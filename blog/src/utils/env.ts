export type DeployEnv = 'dev' | 'test' | 'prod';

export const envMap: Record<DeployEnv, { airoBuilderUrl: string; presentationEnv: string; siteUrl: string }> = {
  dev: {
    airoBuilderUrl: 'https://airo-builder.dev-godaddy.com/',
    presentationEnv: 'dev',
    siteUrl: 'https://airo-builder.dev-godaddy.com',
  },
  test: {
    airoBuilderUrl: 'https://airo-builder.test-godaddy.com/',
    presentationEnv: 'test',
    siteUrl: 'https://airo-builder.test-godaddy.com',
  },
  prod: {
    airoBuilderUrl: 'https://airo-builder.godaddy.com/',
    presentationEnv: 'prod',
    siteUrl: 'https://airo-builder.godaddy.com',
  },
};

function resolve(): DeployEnv {
  const raw = (import.meta.env.PUBLIC_DEPLOY_ENV ?? 'dev') as string;
  if (raw in envMap) return raw as DeployEnv;
  return 'dev';
}

export const deployEnv = resolve();
export const { airoBuilderUrl, presentationEnv, siteUrl } = envMap[deployEnv];
