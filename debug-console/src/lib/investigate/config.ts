const DEFAULT_BUCKET = 'airo-investigations-dev';
const DEFAULT_LAMBDA = 'airo-investigator-dev';

export const INVESTIGATE_CONFIG = {
  bucket: process.env.INVESTIGATE_BUCKET || DEFAULT_BUCKET,
  lambdaFn: process.env.INVESTIGATE_LAMBDA_FN || DEFAULT_LAMBDA,
  region: process.env.AWS_REGION || 'us-west-2',
  // Freshness threshold: if heartbeat older than this, an active investigation
  // is considered zombie and can be taken over. Lambda heartbeats every 10s.
  staleHeartbeatMs: 60_000,
  // Presigned GET URL TTL for report downloads.
  presignedReportTtlSec: 300,
} as const;
