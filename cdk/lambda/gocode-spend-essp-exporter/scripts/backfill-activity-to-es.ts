/**
 * Backfill GoCode activity data into Elasticsearch.
 * - /user/daily/activity → llm_spend_model_daily (model metrics via api_key cross-ref)
 * - /customer/daily/activity → llm_spend_enduser_daily (end_user metrics)
 *
 * Required env: ES_ENDPOINT, ES_API_KEY, AWS_ACCOUNT_ID, plus AWS creds for GoCode role.
 *
 * Optional env:
 *   ENV_NAME       - "prod" | "dev" | "test" (default: "prod")
 *   START_DATE     - YYYY-MM-DD (default: 7 days ago)
 *   END_DATE       - YYYY-MM-DD (default: today)
 *   DRY_RUN        - "true" to skip ES writes
 */

import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { Client } from '@elastic/elasticsearch';
import 'dotenv/config';
import { IamTokenClient } from 'gd-auth-client';

import {
  DailyResponse,
  ES_BATCH_SIZE,
  ES_INDEX_ENDUSER,
  ES_INDEX_MODEL,
  extractEndUserDocs,
  extractModelDocs,
  fetchAllPages,
} from '../src/shared.js';

const ENV_NAME = process.env.ENV_NAME || 'prod';
if (ENV_NAME === 'prod' && process.env.BACKFILL_ALLOW_PROD !== 'true') {
  console.error('Refusing to run against prod without explicit opt-in. Set BACKFILL_ALLOW_PROD=true to proceed.');
  process.exit(1);
}
const GOCODE_ENDPOINT = ENV_NAME === 'prod' ? 'https://api.gocode.caas.gdcorp.tools' : 'https://api.gocode.caas.test-gdcorp.tools';
const SSO_HOST = ENV_NAME === 'prod' ? 'sso.godaddy.com' : 'sso.test-godaddy.com';
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || '644094189644';
const ENTITY_ARN = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/airobuilde-custom-${ENV_NAME}-airo-builder-gocode-access`;

const DRY_RUN = process.env.DRY_RUN === 'true';

async function getJwtViaAws(): Promise<string> {
  const sts = new STSClient({ region: AWS_REGION });
  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: ENTITY_ARN,
      RoleSessionName: `backfill-activity-${Date.now()}`,
      DurationSeconds: 3600
    })
  );
  const creds = response.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error('AssumeRole did not return credentials');
  }
  const client = new IamTokenClient(SSO_HOST, {
    credentialProviderChain: () =>
      Promise.resolve({
        accessKeyId: creds.AccessKeyId!,
        secretAccessKey: creds.SecretAccessKey!,
        sessionToken: creds.SessionToken!
      })
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

function createESClient(): Client {
  const endpoint = process.env.ES_ENDPOINT;
  const apiKey = process.env.ES_API_KEY;
  if (!endpoint || !apiKey) throw new Error('ES_ENDPOINT and ES_API_KEY required in .env');
  return new Client({ node: endpoint, auth: { apiKey } });
}

async function indexDocs<T extends { date: string }>(
  esClient: Client,
  index: string,
  docs: T[],
  getId: (doc: T) => string
): Promise<number> {
  if (docs.length === 0) return 0;
  if (DRY_RUN) {
    console.log(`  [DRY_RUN] Would index ${docs.length} docs to ${index}`);
    return docs.length;
  }

  let totalIndexed = 0;
  for (let i = 0; i < docs.length; i += ES_BATCH_SIZE) {
    const batch = docs.slice(i, i + ES_BATCH_SIZE);
    const operations = batch.flatMap(doc => [
      { index: { _index: index, _id: getId(doc) } },
      doc
    ]);
    const response = await esClient.bulk({ operations, refresh: false });
    if (response.errors) {
      const failed = response.items.filter((item: Record<string, unknown>) =>
        (item as { index?: { error?: unknown } }).index?.error
      );
      console.error(`  ${failed.length} docs failed in batch to ${index}`);
      for (const item of failed.slice(0, 3)) {
        const entry = item as { index?: { _id?: string; error?: { type?: string; reason?: string } } };
        console.error(`    _id=${entry.index?._id} type=${entry.index?.error?.type} reason=${entry.index?.error?.reason}`);
      }
      totalIndexed += batch.length - failed.length;
    } else {
      totalIndexed += batch.length;
    }
  }
  return totalIndexed;
}

function getDateRange(): { startStr: string; endStr: string } {
  const defaultStart = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().split('T')[0];
  })();
  return {
    startStr: process.env.START_DATE || defaultStart,
    endStr: process.env.END_DATE || new Date().toISOString().split('T')[0]
  };
}

function listDays(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  const end = new Date(endStr + 'T00:00:00.000Z');
  for (const d = new Date(startStr + 'T00:00:00.000Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().split('T')[0]);
  }
  return out;
}

async function run(): Promise<void> {
  console.log(`Environment: ${ENV_NAME}, GoCode: ${GOCODE_ENDPOINT}, SSO: ${SSO_HOST}`);
  console.log(`Entity ARN: ${ENTITY_ARN}`);

  const jwt = await getJwtViaAws();
  const esClient = DRY_RUN ? (null as unknown as Client) : createESClient();

  if (!DRY_RUN) {
    await esClient.cluster.health().catch(err => {
      throw new Error(`ES health check failed: ${err.message}`);
    });
  }

  const { startStr, endStr } = getDateRange();
  const days = listDays(startStr, endStr);
  console.log(`Backfill ${startStr} → ${endStr} (${days.length} days).${DRY_RUN ? ' [DRY_RUN]' : ''}`);

  let totalModelDocs = 0;
  let totalEndUserDocs = 0;

  for (const day of days) {
    console.log(`\n${day}:`);

    const userParams = new URLSearchParams({ start_date: day, end_date: day });
    const userResults = await fetchAllPages(jwt, fetchUserDaily, userParams);
    const modelDocs = extractModelDocs(userResults, ENTITY_ARN);
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

  console.log(`\nDone. Models: ${totalModelDocs}, End users: ${totalEndUserDocs}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
