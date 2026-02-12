import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Client } from '@elastic/elasticsearch';
import { IamTokenClient } from 'gd-auth-client';

import {
  DailyResponse,
  ES_BATCH_SIZE,
  ES_INDEX_ENDUSER,
  ES_INDEX_MODEL,
  extractEndUserDocs,
  extractModelDocs,
  fetchAllPages,
} from './shared.js';

interface LambdaEvent {}

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const SECRET_NAME = process.env.SECRET_NAME!;
const ENV_NAME = process.env.ENV_NAME || 'dev';
const AWS_REGION = 'us-west-2';
const SSO_HOST = ENV_NAME === 'prod' ? 'sso.godaddy.com' : 'sso.test-godaddy.com';
const GOCODE_ENDPOINT = ENV_NAME === 'prod' ? 'https://api.gocode.caas.gdcorp.tools' : 'https://api.gocode.caas.test-gdcorp.tools';

const getGoCodeRoleArn = () => `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/airobuilde-custom-${ENV_NAME}-airo-builder-gocode-access`;

function getLastTwoDays(): string[] {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayUtc = new Date(todayUtc);
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1);
  return [
    yesterdayUtc.toISOString().split('T')[0],
    todayUtc.toISOString().split('T')[0]
  ];
}

export async function handler(event: LambdaEvent = {}) {
  try {
    console.log('Starting GoCode activity sync', { event, environment: ENV_NAME });

    const secret = await getSecret();
    const roleArn = getGoCodeRoleArn();
    console.log(`Assuming role: ${roleArn}`);

    const credentials = await assumeRole(roleArn);
    const jwt = await getJWTToken(credentials);
    const esClient = createESClient(secret);

    await esClient.cluster.health().catch(err => {
      throw new Error(`Failed to connect to Elasticsearch: ${err.message}`);
    });

    const days = getLastTwoDays();
    console.log(`Syncing activity for: ${days.join(', ')}`);

    let totalModelDocs = 0;
    let totalEndUserDocs = 0;

    for (const day of days) {
      console.log(`Processing ${day}...`);

      const userParams = new URLSearchParams({ start_date: day, end_date: day });
      const userResults = await fetchAllPages(jwt, fetchUserDaily, userParams);
      const modelDocs = extractModelDocs(userResults, roleArn);
      const modelIndexed = await indexDocs(esClient, ES_INDEX_MODEL, modelDocs, doc => `${doc.date}-${doc.model}`);
      console.log(`  Models: ${modelDocs.length} docs, ${modelIndexed} indexed`);
      totalModelDocs += modelIndexed;

      const custParams = new URLSearchParams({ start_date: day, end_date: day });
      const custResults = await fetchAllPages(jwt, fetchCustomerDaily, custParams);
      const endUserDocs = extractEndUserDocs(custResults);
      const endUserIndexed = await indexDocs(esClient, ES_INDEX_ENDUSER, endUserDocs, doc => `${doc.date}-${doc.end_user}`);
      console.log(`  End users: ${endUserDocs.length} docs, ${endUserIndexed} indexed`);
      totalEndUserDocs += endUserIndexed;
    }

    console.log('Sync completed', { totalModelDocs, totalEndUserDocs });

    return {
      statusCode: 200,
      message: 'Sync completed successfully',
      totalModelDocs,
      totalEndUserDocs
    };

  } catch (error) {
    console.error('Sync failed:', error);
    return {
      statusCode: 500,
      message: 'Sync failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function getSecret() {
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  if (!response.SecretString) throw new Error(`Secret '${SECRET_NAME}' has no content`);
  try {
    return JSON.parse(response.SecretString);
  } catch (err) {
    throw new Error(`Secret '${SECRET_NAME}' contains invalid JSON: ${err instanceof Error ? err.message : err}`);
  }
}

async function assumeRole(roleArn: string) {
  const response = await new STSClient({ region: AWS_REGION }).send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `sync-activity-${Date.now()}`,
      DurationSeconds: 3600
    })
  );

  return {
    accessKeyId: response.Credentials!.AccessKeyId!,
    secretAccessKey: response.Credentials!.SecretAccessKey!,
    sessionToken: response.Credentials!.SessionToken!
  };
}

async function getJWTToken(credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string }) {
  const client = new IamTokenClient(SSO_HOST, {
    credentialProviderChain: () => Promise.resolve({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken
    })
  });

  client.once('background_error', (primaryError: any) => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'lambda.iamToken.primaryRegionFailure',
      message: primaryError.message,
      code: primaryError.code,
      ssoHost: SSO_HOST,
      primaryRegion: 'us-west-2',
      errorName: primaryError.name,
      timestamp: new Date().toISOString()
    }));
  });

  return client.getToken();
}

async function fetchUserDaily(jwt: string, params: URLSearchParams, page: number): Promise<DailyResponse> {
  const p = new URLSearchParams(params);
  p.set('page', String(page));
  const response = await fetch(`${GOCODE_ENDPOINT}/user/daily/activity?${p}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Accept-Encoding': 'gzip' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<DailyResponse>;
}

async function fetchCustomerDaily(jwt: string, params: URLSearchParams, page: number): Promise<DailyResponse> {
  const p = new URLSearchParams(params);
  p.set('page', String(page));
  const response = await fetch(`${GOCODE_ENDPOINT}/customer/daily/activity?${p}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'Accept-Encoding': 'gzip' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<DailyResponse>;
}

function createESClient(secret: any) {
  return new Client({
    node: secret.ingestion_url,
    ...(secret.ingestion_user && secret.ingestion_user_password && {
      auth: { username: secret.ingestion_user, password: secret.ingestion_user_password }
    })
  });
}

async function indexDocs<T extends { date: string }>(
  esClient: Client,
  index: string,
  docs: T[],
  getId: (doc: T) => string
): Promise<number> {
  if (docs.length === 0) return 0;

  let totalIndexed = 0;
  for (let i = 0; i < docs.length; i += ES_BATCH_SIZE) {
    const batch = docs.slice(i, i + ES_BATCH_SIZE);
    const operations = batch.flatMap(doc => [
      { index: { _index: index, _id: getId(doc) } },
      doc
    ]);

    console.log(`Indexing batch ${Math.floor(i / ES_BATCH_SIZE) + 1}/${Math.ceil(docs.length / ES_BATCH_SIZE)} (${batch.length} docs) to ${index}`);
    const response = await esClient.bulk({ operations, refresh: false });

    if (response.errors) {
      const failed = response.items.filter((item: any) => item.index?.error);
      console.error(`${failed.length} docs failed in batch to ${index}`);
      for (const item of failed.slice(0, 3)) {
        console.error(`  _id=${item.index?._id} type=${item.index?.error?.type} reason=${item.index?.error?.reason}`);
      }
      totalIndexed += batch.length - failed.length;
    } else {
      totalIndexed += batch.length;
    }
  }

  return totalIndexed;
}
