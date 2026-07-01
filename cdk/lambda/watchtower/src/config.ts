import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface EsWriteCreds { node: string; username: string; password: string }
export interface EsReadCreds { node: string; apiKey: string }
export interface WatchtowerConfig {
  esWrite: EsWriteCreds;
  esRead: EsReadCreds;
  slackWebhookUrl: string;
  appLogIndex: string;
  statsIndex: string;
  // Source B: APM RED (metrics-apm.service_transaction.1m)
  apmIndex: string;
  apmServiceName: string;
  // Source C: CloudWatch ALB — empty string means skip CloudWatch collection
  albLoadBalancerName: string;
  // GoCode S2S for LLM reasoner — empty string means skip LLM (graceful degradation)
  gocodeRoleArn: string;
  gocodeEndpoint: string;
  ssoHost: string;
}

export function parseEsWriteSecret(json: string): EsWriteCreds {
  const s = JSON.parse(json) as Record<string, string>;
  if (!s.ingestion_url || !s.ingestion_user || !s.ingestion_user_password) {
    throw new Error('essp_deployment_credentials missing ingestion_* fields');
  }
  return { node: s.ingestion_url, username: s.ingestion_user, password: s.ingestion_user_password };
}

export function parseSlackSecret(json: string): string {
  const url = (JSON.parse(json) as { webhookUrl?: string }).webhookUrl ?? '';
  return url.startsWith('https://hooks.slack.com/') ? url : '';
}

async function getSecret(client: SecretsManagerClient, secretId: string): Promise<string> {
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) throw new Error(`secret ${secretId} has no SecretString`);
  return out.SecretString;
}

export async function loadConfig(env: NodeJS.ProcessEnv): Promise<WatchtowerConfig> {
  const region = env.AWS_REGION ?? 'us-west-2';
  const client = new SecretsManagerClient({ region });
  const esWrite = parseEsWriteSecret(await getSecret(client, env.ES_SECRET_NAME ?? 'essp_deployment_credentials'));
  const slackWebhookUrl = parseSlackSecret(await getSecret(client, env.SLACK_SECRET_NAME ?? 'watchtower_slack_webhook'));
  const node = env.AIRO_BUILDER_ES_ENDPOINT;
  const esApiKeySecret = env.AIRO_BUILDER_ES_API_KEY_SECRET;
  if (!node || !esApiKeySecret) throw new Error('missing AIRO_BUILDER_ES_ENDPOINT/AIRO_BUILDER_ES_API_KEY_SECRET');
  const apiKey = await getSecret(client, esApiKeySecret);
  return {
    esWrite,
    esRead: { node, apiKey },
    slackWebhookUrl,
    appLogIndex: env.APP_LOG_INDEX ?? 'logs-gdelastic.katana.app-prod-ecs',
    statsIndex: env.STATS_INDEX ?? 'watchtower_stats',
    apmIndex: env.APM_INDEX ?? 'metrics-apm.service_transaction.1m*',
    apmServiceName: env.APM_SERVICE_NAME ?? '',
    albLoadBalancerName: env.ALB_LOAD_BALANCER_NAME ?? '',
    gocodeRoleArn: env.GOCODE_ROLE_ARN ?? '',
    gocodeEndpoint: env.GOCODE_ENDPOINT ?? '',
    ssoHost: env.SSO_HOST ?? 'sso.test-godaddy.com',
  };
}
