/**
 * Feedback S3 Store API Endpoint
 *
 * Persists structured feedback records to S3 for analytics (Athena/Lake Formation).
 * Called fire-and-forget from FeedbackMultiStep "Share Feedback" mode only.
 * Support and issue/bug-report modes do not write to S3.
 *
 * S3 key structure:
 *   {table_prefix}/year={yyyy}/month={mm}/day={dd}/hour={hh}/appId={appId}/{timestamp_ms}.parquet
 *
 * Table prefix:
 *   prod bucket  → airo_builder_feedback_cln
 *   dev/local    → airo_builder_feedback_cln_laketest
 *
 * Optional lake columns (see FeedbackS3Record): feedback_topic_list (JSON array string),
 * feedback_origin_name, app_publish_flag, publish_url (only when flag true).
 */

import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FeedbackStorePayload } from '@/components/feedback/types';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { encodeFeedbackParquet } from './feedback-to-parquet';
import type { FeedbackS3Record } from './types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  return `${FEEDBACK_TABLE_PREFIX}/year=${year}/month=${month}/day=${day}/hour=${hour}/appId=${appId || 'unknown'}/${now.getTime()}.parquet`;
}

function formatUtcTs(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function previewForInvalidTopicList(raw: unknown): string {
  try {
    if (typeof raw === 'string') {
      return raw.slice(0, 200);
    }
    return JSON.stringify(raw).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

function parseFeedbackTopicListInput(raw: unknown): string | null {
  if (raw == null) {
    return null;
  }
  let strings: string[];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    try {
      const parsed = JSON.parse(t) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }
      strings = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return null;
    }
  } else if (Array.isArray(raw)) {
    strings = raw.filter((x): x is string => typeof x === 'string');
  } else {
    return null;
  }
  const cleaned = [...new Set(strings.map(s => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (cleaned.length === 0) {
    return null;
  }
  return JSON.stringify(cleaned);
}

function parseFeedbackOriginName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const t = raw.trim();
  if (!t) {
    return null;
  }
  return t;
}

function parseAppPublishFlag(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') {
    return raw;
  }
  return null;
}

function parsePublishUrl(raw: unknown, appPublishFlag: boolean | null): string | null {
  if (appPublishFlag !== true) {
    return null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const t = raw.trim();
  if (!t) {
    return null;
  }
  if (!/^https?:\/\//i.test(t)) {
    return null;
  }
  return t;
}

// Default auth (no { level: 3 }): same UX contract as POST /api/slack-webhook/feedback —
// optional fire-and-forget from a long-lived tab; level 3 HBI would prompt re-auth without
// changing the fact that a valid customer JWT is still required.
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
  const planTypeName = typeof body.plan_type_name === 'string' ? body.plan_type_name : null;
  const subscriptionId = typeof body.subscription_id === 'string' ? body.subscription_id : null;
  const subscriptionStatus = typeof body.subscription_status === 'string' ? body.subscription_status : null;
  const totalCreditCnt = typeof body.total_credit_cnt === 'number' && Number.isFinite(body.total_credit_cnt) ? body.total_credit_cnt : null;
  const availableCreditCnt = typeof body.available_credit_cnt === 'number' && Number.isFinite(body.available_credit_cnt) ? body.available_credit_cnt : null;
  if (typeof body.total_credit_cnt === 'number' && totalCreditCnt === null) {
    logger.warn('feedback.store.s3.invalid_credits', { field: 'total_credit_cnt', value: body.total_credit_cnt });
  }
  if (typeof body.available_credit_cnt === 'number' && availableCreditCnt === null) {
    logger.warn('feedback.store.s3.invalid_credits', { field: 'available_credit_cnt', value: body.available_credit_cnt });
  }

  const feedbackTopicList = parseFeedbackTopicListInput(body.feedback_topic_list);
  if (body.feedback_topic_list != null && feedbackTopicList === null) {
    logger.warn('feedback.store.s3.invalid_topic_list', {
      type: typeof body.feedback_topic_list,
      preview: previewForInvalidTopicList(body.feedback_topic_list),
    });
  }
  const feedbackOriginName = parseFeedbackOriginName(body.feedback_origin_name);
  const appPublishFlag = parseAppPublishFlag(body.app_publish_flag);
  const publishUrl = parsePublishUrl(body.publish_url, appPublishFlag);
  if (appPublishFlag === true && publishUrl === null) {
    logger.warn('feedback.store.s3.missing_publish_url', {
      hadClientUrl: typeof body.publish_url === 'string' && body.publish_url.trim().length > 0,
    });
  }

  // Reject app_id values that would corrupt the Hive partition key (e.g. containing /)
  if (appId !== null && !APP_ID_PATTERN.test(appId)) {
    logger.warn('feedback.store.s3.invalid_app_id', { appId });
    return NextResponse.json({ error: 'Invalid app_id format' }, { status: 400 });
  }

  const now = new Date();
  const s3Key = buildS3Key(appId, now);
  const tsStr = formatUtcTs(now);

  const record: FeedbackS3Record = {
    feedback_id: randomUUID(),
    customer_id: authContext.user.customerId ?? null,
    app_id: appId,
    feedback_utc_ts: tsStr,
    feedback_text: feedbackText,
    consent_flag: consentFlag,
    rating,
    plan_type_name: planTypeName,
    subscription_id: subscriptionId,
    subscription_status: subscriptionStatus,
    total_credit_cnt: totalCreditCnt,
    available_credit_cnt: availableCreditCnt,
    feedback_topic_list: feedbackTopicList,
    feedback_origin_name: feedbackOriginName,
    app_publish_flag: appPublishFlag,
    publish_url: publishUrl,
    cln_create_utc_ts: tsStr,
  };

  let parquetBody: Buffer;
  try {
    parquetBody = await encodeFeedbackParquet(record);
  } catch (err) {
    logger.error('feedback.store.s3.parquet_encode_failed', {
      appId,
      feedbackId: record.feedback_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Parquet encode failed' }, { status: 500 });
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: FEEDBACK_BUCKET,
      Key: s3Key,
      Body: parquetBody,
      ContentType: 'application/vnd.apache.parquet',
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
