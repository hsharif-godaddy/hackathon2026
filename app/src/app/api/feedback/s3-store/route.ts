/**
 * Feedback S3 Store API Endpoint
 *
 * Persists structured feedback records to S3 for analytics (Athena/Lake Formation).
 * Called fire-and-forget from FeedbackForm (legacy) and FeedbackMultiStep "Share Feedback" mode only.
 * Support and issue/bug-report modes do not write to S3.
 *
 * S3 key structure:
 *   {table_prefix}/year={yyyy}/month={mm}/day={dd}/hour={hh}/appId={appId}/{timestamp_ms}.json
 *
 * Table prefix:
 *   prod bucket  → airo_builder_feedback_cln
 *   dev/local    → airo_builder_feedback_cln_laketest
 */

import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FeedbackStorePayload } from '@/components/feedback/types';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

let s3Client: S3Client | null = null;
let s3ClientInitError: string | null = null;
try {
  s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });
} catch (err) {
  s3ClientInitError = err instanceof Error ? err.message : String(err);
  logger.error('feedback.store.s3.client_init_failed', { error: s3ClientInitError });
}

const FEEDBACK_BUCKET = process.env.FEEDBACK_BUCKET;
const FEEDBACK_TABLE_PREFIX = FEEDBACK_BUCKET === 'airo-builder-feedback-prod'
  ? 'airo_builder_feedback_cln'
  : 'airo_builder_feedback_cln_laketest';

// Warn at startup so misconfiguration is visible in prod Loki (debug would be suppressed)
if (!FEEDBACK_BUCKET) {
  logger.warn('feedback.store.s3.not_configured', {
    message: 'FEEDBACK_BUCKET not set — S3 writes skipped (expected in test env)',
  });
} else if (FEEDBACK_BUCKET !== 'airo-builder-feedback-dev' && FEEDBACK_BUCKET !== 'airo-builder-feedback-prod') {
  logger.warn('feedback.store.s3.unexpected_bucket', {
    bucket: FEEDBACK_BUCKET,
    message: 'Unrecognised bucket name — falling back to laketest prefix; verify FEEDBACK_BUCKET',
  });
}

// Only alphanumeric, hyphen, underscore — prevents path traversal via app_id containing /
const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function buildS3Key(appId: string | null, now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  return `${FEEDBACK_TABLE_PREFIX}/year=${year}/month=${month}/day=${day}/hour=${hour}/appId=${appId || 'unknown'}/${now.getTime()}.json`;
}

function formatUtcTs(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!FEEDBACK_BUCKET) {
    logger.warn('feedback.store.s3.skipped_not_configured');
    return NextResponse.json({ error: 'S3 not configured' }, { status: 503 });
  }
  if (!s3Client) {
    logger.error('feedback.store.s3.client_unavailable', { initError: s3ClientInitError });
    return NextResponse.json({ error: 'S3 client init failed' }, { status: 500 });
  }

  // Reject oversized bodies before parsing — Content-Length is a reliable signal for
  // well-behaved clients. Requests without Content-Length (e.g. chunked transfer encoding)
  // bypass this check; withCustomerAuth is the primary mitigation for those callers.
  // 100 KB is generous for a feedback payload (fields are short strings + scalars).
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 100_000) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  let body: FeedbackStorePayload;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn('feedback.store.s3.invalid_payload', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  // Type-only coercion — prevents Athena schema corruption from unexpected client-sent types
  const appId = typeof body.app_id === 'string' ? body.app_id : null;
  const feedbackText = typeof body.feedback_text === 'string' ? body.feedback_text : null;
  const consentFlag = typeof body.consent_flag === 'boolean' ? body.consent_flag : null;
  const rating = typeof body.rating === 'number' && Number.isInteger(body.rating) ? body.rating : null;

  // Reject app_id values that would corrupt the Hive partition key (e.g. containing /)
  if (appId !== null && !APP_ID_PATTERN.test(appId)) {
    logger.warn('feedback.store.s3.invalid_app_id', { appId });
    return NextResponse.json({ error: 'Invalid app_id format' }, { status: 400 });
  }

  const now = new Date();
  const s3Key = buildS3Key(appId, now);
  const tsStr = formatUtcTs(now);

  const record = {
    customer_id: authContext.user.customerId ?? null,
    app_id: appId,
    feedback_utc_ts: tsStr,
    feedback_text: feedbackText,
    consent_flag: consentFlag,
    rating,
    cln_create_utc_ts: tsStr,
  };

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: FEEDBACK_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
    }));

    logger.info('feedback.store.s3.success', {
      appId,
      customerId: authContext.user.customerId,
    });
  } catch (err) {
    logger.error('feedback.store.s3.failure', {
      appId,
      s3Key,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'S3 write failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
