import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Client } from '@elastic/elasticsearch';
import { IamTokenClient } from 'gd-auth-client';

interface SpendLog {
  request_id: string;
  [key: string]: any;
}

interface LambdaEvent {}

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const SECRET_NAME = process.env.SECRET_NAME!;
const ENV_NAME = process.env.ENV_NAME || 'dev';
const AWS_REGION = 'us-west-2';
const ES_INDEX = 'llm-spend-logs';
const SSO_HOST = ENV_NAME === 'prod' ? 'sso.godaddy.com' : 'sso.test-godaddy.com';
const GOCODE_ENDPOINT = ENV_NAME === 'prod' ? 'https://api.gocode.caas.gdcorp.tools' : 'https://api.gocode.caas.test-gdcorp.tools';

const getGoCodeRoleArn = () => `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/airobuilde-custom-${ENV_NAME}-airo-builder-gocode-access`;

export async function handler(event: LambdaEvent = {}) {
  try {
    console.log('Starting GoCode spend log sync', { event, environment: ENV_NAME });
    
    const secret = await getSecret();
    
    const roleArn = getGoCodeRoleArn();
    console.log(`Assuming role: ${roleArn}`);
    
    const credentials = await assumeRole(roleArn);
    const jwtToken = await getJWTToken(credentials);
    const esClient = createESClient(secret);
    
    await esClient.cluster.health().catch(err => {
      throw new Error(`Failed to connect to Elasticsearch: ${err.message}`);
    });
    
    let totalLogs = 0;
    let totalIndexed = 0;
    
    const logs = await fetchLogsForDate(jwtToken);
    
    console.log(`Indexing ${logs.length} logs`);
    const indexed = await indexLogs(esClient, logs);

    totalLogs += logs.length;
    totalIndexed += indexed;
    
  
    console.log('Sync completed', { totalLogs, successfullyIndexed: totalIndexed, failed: totalLogs - totalIndexed });
    
    return {
      statusCode: 200,
      message: 'Sync completed successfully',
      totalLogs,
      successfullyIndexed: totalIndexed,
      failed: totalLogs - totalIndexed
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
  if (!response.SecretString) throw new Error('Secret has no content');
  return JSON.parse(response.SecretString);
}

async function assumeRole(roleArn: string) {
  const response = await new STSClient({ region: AWS_REGION }).send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `sync-to-es-${Date.now()}`,
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

  const token = await new IamTokenClient(SSO_HOST, {
    credentialProviderChain: () => Promise.resolve({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken
    })
  }).getToken();

  return token;
}

function removeNullFields(obj: any): any {
  if (Array.isArray(obj)) return obj.map(removeNullFields).filter(item => item != null);
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value == null) return acc;
      if (typeof value === 'object') {
        const cleaned = removeNullFields(value);
        if (Object.keys(cleaned).length > 0 || Array.isArray(cleaned)) acc[key] = cleaned;
      } else {
        acc[key] = value;
      }
      return acc;
    }, {} as any);
  }
  return obj;
}

async function fetchLogsForDate(jwtToken: string): Promise<SpendLog[]> {
  const endDate = new Date();
  const startDate = new Date(endDate.toISOString().split('T')[0]);
  startDate.setDate(startDate.getDate() - 1);


  console.log(`Fetching logs for ${startDate} to ${endDate}`);
  const params = new URLSearchParams({
    user_id: getGoCodeRoleArn(),
    summarize: 'false',
    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0]
  });

  console.log(`calling : ${GOCODE_ENDPOINT}/spend/logs?${params}`);
  
  const response = await fetch(`${GOCODE_ENDPOINT}/spend/logs?${params}`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs : ${response.status} - ${JSON.stringify(await response.json())}`);
  }

  const logs = await response.json();
  if (!Array.isArray(logs)) throw new Error(`Expected array response, got: ${typeof logs}`);
  return logs;
}

function createESClient(secret: any) {
  return new Client({
    node: secret.ingestion_url,
    ...(secret.ingestion_user && secret.ingestion_user_password && {
      auth: { username: secret.ingestion_user, password: secret.ingestion_user_password }
    })
  });
}

async function indexLogs(esClient: Client, logs: SpendLog[]) {
  if (logs.length === 0) return 0;

  const BATCH_SIZE = 2000;
  let totalIndexed = 0;

  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);
    const operations = batch.flatMap(log => [
      { index: { _index: ES_INDEX, _id: log.request_id } },
      removeNullFields(log)
    ]);

    console.log(`Indexing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(logs.length / BATCH_SIZE)} (${batch.length} docs)`);
    const response = await esClient.bulk({ operations, refresh: false });

    if (response.errors) {
      const erroredDocs = response.items.filter((item: any) => item.index?.error);
      console.error(`⚠️  ${erroredDocs.length} documents failed to index`);
      erroredDocs.slice(0, 5).forEach((item: any) => {
        console.error(`   - ${item.index._id}: ${item.index.error.reason}`);
      });
      totalIndexed += batch.length - erroredDocs.length;
    } else {
      totalIndexed += batch.length;
    }
  }

  return totalIndexed;
}


