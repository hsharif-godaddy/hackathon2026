import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';

export interface SupportplaneStoreConfig {
  awsRegion: string;
  transcriptsTable: string;
  uploadsTable: string;
  analyticsTable?: string;
  feedbackTable: string;
  feedbackStatsTable: string;
  feedbackIngestTable: string;
  ticketsTable: string;
}

// Single env var controls all table name suffixes (dev | prod).
// Falls back to ENVIRONMENT_NAME, then 'dev'.
export function getSpEnv(): string {
  return process.env.SP_ENV || process.env.ENVIRONMENT_NAME || 'dev';
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
    uploadsTable:
      process.env.SP_L1_UPLOADS_TABLE || `airo-builde-supportplane-l1-upload-${env}`,
    feedbackTable:
      process.env.SP_FEEDBACK_TABLE || `airo-builde-supportplane-feedback-${env}`,
    feedbackStatsTable:
      process.env.SP_FEEDBACK_STATS_TABLE || `airo-builde-supportplane-feedback-stats-${env}`,
    feedbackIngestTable:
      process.env.SP_FEEDBACK_INGEST_TABLE || `airo-builde-supportplane-feedback-ingest-${env}`,
    ticketsTable:
      process.env.SP_TICKETS_TABLE || `airo-builde-supportplane-tickets-${env}`,
  };
}
