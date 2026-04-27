import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import {
  createEsClient,
  ensureIndex,
  ES_INDEX,
  EsCredentials,
  INDEX_MAPPING,
  ingest,
  LangfuseConfig,
  trailingHourWindow,
} from './shared.js';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

// Shape: { LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY }.
const LANGFUSE_SECRET_NAME = process.env.LANGFUSE_SECRET_NAME ?? 'langfuse_test';
const ES_SECRET_NAME = process.env.ES_SECRET_NAME ?? 'essp_deployment_credentials';
const INDEX = process.env.ES_INDEX ?? ES_INDEX;

interface LangfuseSecret {
  LANGFUSE_BASE_URL?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}

async function getSecretJson<T>(secretId: string): Promise<T> {
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) throw new Error(`Secret '${secretId}' has no content`);
  try {
    return JSON.parse(response.SecretString) as T;
  } catch (err) {
    throw new Error(`Secret '${secretId}' contains invalid JSON`, { cause: err });
  }
}

function asLangfuseConfig(secret: LangfuseSecret): LangfuseConfig {
  if (!secret.LANGFUSE_BASE_URL || !secret.LANGFUSE_PUBLIC_KEY || !secret.LANGFUSE_SECRET_KEY) {
    throw new Error(
      `Secret '${LANGFUSE_SECRET_NAME}' missing required fields ` +
      '(LANGFUSE_BASE_URL/LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY)'
    );
  }
  return {
    baseUrl: secret.LANGFUSE_BASE_URL,
    publicKey: secret.LANGFUSE_PUBLIC_KEY,
    secretKey: secret.LANGFUSE_SECRET_KEY,
  };
}

export async function handler() {
  console.log('Starting Langfuse metrics ingest');

  const lfSecret = await getSecretJson<LangfuseSecret>(LANGFUSE_SECRET_NAME);
  const esSecret = await getSecretJson<EsCredentials>(ES_SECRET_NAME);
  const lf = asLangfuseConfig(lfSecret);
  const esClient = createEsClient(esSecret);

  await esClient.cluster.health().catch(function fail(err: Error) {
    throw new Error('Failed to connect to Elasticsearch', { cause: err });
  });

  await ensureIndex(esClient, INDEX, INDEX_MAPPING);

  const range = trailingHourWindow();
  console.log('Window: %s -> %s (index=%s)', range.fromTimestamp, range.toTimestamp, INDEX);

  // NOTE: do not catch & return a 500 payload here. EventBridge invocations
  // ignore the response body, so swallowing errors silently marks the
  // invocation as a success in CloudWatch — the Lambda Errors metric never
  // fires and any future alarm built on it is blind. Let the error propagate
  // so EventBridge sees a failed invocation and CW records it.
  const result = await ingest(lf, esClient, INDEX, range);
  console.log('Done. docs=%d indexed=%d rowsByQuery=%j', result.docs, result.indexed, result.rowsByQuery);
  return {
    statusCode: 200,
    message: 'Ingest completed',
    window: range,
    ...result,
  };
}
