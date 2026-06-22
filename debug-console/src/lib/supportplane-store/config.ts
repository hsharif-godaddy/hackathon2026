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
