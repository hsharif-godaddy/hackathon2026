import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { fromIni } from '@aws-sdk/credential-providers';

export interface SupportplaneStoreConfig {
  awsRegion: string;
  transcriptsTable: string;
  uploadsTable: string;
  analyticsTable?: string;
  feedbackTable: string; // legacy combined table (still used as migration source)
  feedbackRawS3Table: string; // raw S3 records
  feedbackRawAthenaTable: string; // raw Athena CSV records
  feedbackEnrichedTable: string; // deduped merge of S3 + Athena; all reads use this
  feedbackStatsTable: string;
  feedbackIngestTable: string;
  ticketsTable: string;
  feedbackStartDate: string; // YYYY-MM-DD — shared cutoff: ingest + enriched table filter
}

// Determines the environment tag used for both DynamoDB table selection (reads) and as the value
// for the 'env' column written by feedback-ingest.ts (writes).
// Priority for environment resolution is: ENVIRONMENT_NAME > SP_ENV > FEEDBACK_ENV > 'dev'.
// FEEDBACK_ENV remains for backward compatibility with .env.local setups; this ensures
// both readers and writers use the same environment without risk of divergence.
export function getSpEnv(): string {
  return process.env.ENVIRONMENT_NAME ?? process.env.SP_ENV ?? process.env.FEEDBACK_ENV ?? 'dev';
}

type DynamoClientOptions = Omit<
  NonNullable<ConstructorParameters<typeof DynamoDBClient>[0]>,
  'region' | 'credentials'
>;

type DynamoDocumentOptions = NonNullable<Parameters<typeof DynamoDBDocumentClient.from>[1]>;

/**
 * DynamoDB client with optional cross-account credentials (DYNAMO_AWS_*).
 * Falls back to ambient AWS credentials when DYNAMO_* vars are unset.
 */
export function buildDynamoClient(
  clientOptions: DynamoClientOptions = {},
  documentOptions?: DynamoDocumentOptions
): DynamoDBDocumentClient {
  const region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2';

  const keyId = process.env.DYNAMO_AWS_ACCESS_KEY_ID;
  const secret = process.env.DYNAMO_AWS_SECRET_ACCESS_KEY;
  const token = process.env.DYNAMO_AWS_SESSION_TOKEN;
  const profile = process.env.DYNAMO_AWS_PROFILE;

  type CredentialsType = Exclude<
    ConstructorParameters<typeof DynamoDBClient>[0],
    undefined
  >['credentials'];
  let credentials: CredentialsType | undefined;

  if (keyId && secret) {
    credentials = {
      accessKeyId: keyId,
      secretAccessKey: secret,
      ...(token ? { sessionToken: token } : {}),
    };
  } else if (profile) {
    credentials = fromIni({ profile });
  }

  const base = new DynamoDBClient({
    region,
    // 8s connect + 8s socket timeout; maxAttempts=2 halves retry overhead on VPN-degraded connections
    requestHandler: new NodeHttpHandler({ connectionTimeout: 8000, socketTimeout: 8000 }),
    maxAttempts: 2,
    ...(credentials ? { credentials } : {}),
    ...clientOptions,
  });

  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
    ...documentOptions,
  });
}

export function getConfig(): SupportplaneStoreConfig {
  const env = getSpEnv();
  return {
    awsRegion: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-west-2',
    analyticsTable:
      process.env.SP_L1_ANALYTICS_TABLE || `airo-builde-supportplane-l1-analytics-${env}`,
    transcriptsTable:
      process.env.SP_L1_TRANSCRIPTS_TABLE || `airo-builde-supportplane-l1-transcript-${env}`,
    uploadsTable: process.env.SP_L1_UPLOADS_TABLE || `airo-builde-supportplane-l1-upload-${env}`,
    feedbackTable: process.env.SP_FEEDBACK_TABLE || `airo-builde-supportplane-feedback-${env}`,
    feedbackRawS3Table:
      process.env.SP_FEEDBACK_RAW_S3_TABLE || `airo-builde-supportplane-feedback-raw-s3-${env}`,
    feedbackRawAthenaTable:
      process.env.SP_FEEDBACK_RAW_ATHENA_TABLE ||
      `airo-builde-supportplane-feedback-raw-athena-${env}`,
    feedbackEnrichedTable:
      process.env.SP_FEEDBACK_ENRICHED_TABLE || `airo-builde-supportplane-feedback-enriched-${env}`,
    feedbackStatsTable:
      process.env.SP_FEEDBACK_STATS_TABLE || `airo-builde-supportplane-feedback-stats-${env}`,
    feedbackIngestTable:
      process.env.SP_FEEDBACK_INGEST_TABLE || `airo-builde-supportplane-feedback-ingest-${env}`,
    ticketsTable: process.env.SP_TICKETS_TABLE || `airo-builde-supportplane-tickets-${env}`,
    // Single cutoff for both ingest (feedback-ingest.ts) and enriched-table filtering.
    // Set FEEDBACK_START_DATE=YYYY-MM-DD in .env.local to change.
    feedbackStartDate: process.env.FEEDBACK_START_DATE || '2026-04-01',
  };
}
