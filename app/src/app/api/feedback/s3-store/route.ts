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
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FeedbackStorePayload } from '@/components/feedback/types';
import { airoCertTokenService, fetchCustomerProfile } from '@/lib/crm';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, checkSwitchboardObject } from '@/lib/switchboard/server';
import { encodeFeedbackParquet } from './feedback-to-parquet';
import type { FeedbackS3Record } from './types';

/**
 * Switchboard flag that gates per-submission Lambda fanout.
 * - ON  → UI skips Slack + companion-hub; Lambda owns delivery.
 * - OFF → today's BFF/UI flow keeps running; Lambda no-ops on read.
 * Issue/support paths use `/api/crm/case` regardless of this flag —
 * only the NPS path writes parquet today.
 */
const FANOUT_VIA_LAMBDA_FLAG = 'appbuilder-fanout-via-lambda';

/**
 * Switchboard JSON-typed value gating which categories/ratings the fanout
 * Lambda opens an AABSP Jira ticket for. Resolved at submit time as an object
 * and stamped (re-serialized to a canonical JSON string) into the parquet row
 * column `jira_eligibility_config`; the Lambda parses it and applies its
 * built-in default (issue/support OFF, feedback ON, strict `rating < 7`) when
 * the value is absent or malformed. Object shape:
 *   {"issue":bool,"support":bool,"feedback":{"enabled":bool,"maxRating":number}}
 */
const JIRA_ELIGIBILITY_FLAG = 'appbuilder-fanout-jira-eligibility';

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

// Lambda client used to fan out parquet writes to airo-fanout-<env>.
// We invoke the Lambda directly (InvocationType=Event) instead of using
// an S3 → Lambda trigger because GD's permissions boundary
// GD-AWS-SSG-PB-DEFAULT explicitly denies s3:PutBucketNotification —
// CDK's BucketNotificationsHandler can't modify the bucket. The Katana
// task role for this container is granted lambda:InvokeFunction by
// FeedbackFanoutStack. When FANOUT_LAMBDA_FN is unset (e.g. local dev,
// pre-deploy) the invoke is skipped silently so the parquet write stays
// the BFF's source-of-truth concern.
let lambdaClient: LambdaClient | null = null;
try {
  lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-west-2' });
} catch (err) {
  logger.error('feedback.store.lambda.client_init_failed', {
    error: err instanceof Error ? err.message : String(err),
  });
}
const FANOUT_LAMBDA_FN = process.env.FANOUT_LAMBDA_FN;

const FEEDBACK_BUCKET = process.env.FEEDBACK_BUCKET;

// Misconfig signal: bucket configured (so parquet is being written) but the
// Lambda function name is not set, which means the entire fanout path is a
// silent no-op. Surface at startup so this can't quietly survive a deploy.
if (FEEDBACK_BUCKET && !FANOUT_LAMBDA_FN) {
  logger.warn('feedback.store.fanout.fn_not_configured', {
    message: 'FANOUT_LAMBDA_FN not set — Lambda fanout will be skipped on every submission. Set the env var to airo-fanout-<env> on the website Katana container.',
  });
}
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

// Default auth (no { level: 3 }): feedback is an optional submit from a
// long-lived tab; level 3 HBI would prompt re-auth without changing the fact
// that a valid customer JWT is still required.
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  // No FEEDBACK_BUCKET → local dev or pre-deploy: succeed without writing.
  // The client decides what to do (it'll log the Slack block JSON locally
  // when isLocalDev()). 503 here would just produce a noisy error toast.
  if (!FEEDBACK_BUCKET) {
    logger.warn('feedback.store.s3.skipped_not_configured');
    return NextResponse.json({ success: true, devSkipped: true });
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

  // Fanout-Lambda enrichment fields: type-only coercion, no validation —
  // the Lambda treats blanks as graceful fallback. `origin` mirrors
  // `feedback_origin_name` (already trimmed/validated above).
  const experimentsLine = typeof body.experiments_line === 'string' ? body.experiments_line : null;
  const previewUrlRaw = typeof body.preview_url === 'string' ? body.preview_url.trim() : '';
  const previewUrl = previewUrlRaw && /^https?:\/\//i.test(previewUrlRaw) ? previewUrlRaw : null;
  const publishedUrlFullRaw = typeof body.published_url_full === 'string' ? body.published_url_full.trim() : '';
  const publishedUrlFull = publishedUrlFullRaw && /^https?:\/\//i.test(publishedUrlFullRaw) ? publishedUrlFullRaw : null;
  const fullStoryUrlRaw = typeof body.full_story_url === 'string' ? body.full_story_url.trim() : '';
  const fullStoryUrl = fullStoryUrlRaw && /^https?:\/\//i.test(fullStoryUrlRaw) ? fullStoryUrlRaw : null;
  const subscriptionInfo = typeof body.subscription_info === 'string' ? body.subscription_info : null;

  // Feedback dialog category — 'issue' | 'support' | 'feedback'. Used by the
  // fanout Lambda to pick the right Slack Block Kit builder. Null-tolerant
  // (legacy callers without category render Slack as a graceful skip).
  const ALLOWED_CATEGORIES = ['issue', 'support', 'feedback'];
  const rawCategory = typeof body.feedback_category === 'string' ? body.feedback_category.trim() : null;
  const feedbackCategory = rawCategory && ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : null;

  // Reject app_id values that would corrupt the Hive partition key (e.g. containing /)
  if (appId !== null && !APP_ID_PATTERN.test(appId)) {
    logger.warn('feedback.store.s3.invalid_app_id', { appId });
    return NextResponse.json({ error: 'Invalid app_id format' }, { status: 400 });
  }

  // Resolve the per-submission Switchboard gate. Failure-mode: fail closed —
  // a system failure stamps `null` and the Lambda treats anything other than
  // strict `true` as no-op, so the BFF/UI legacy path remains the source of
  // truth. We log both success and failure so ops can verify rollout in Loki.
  const fanoutViaLambda: boolean | null = await (async () => {
    try {
      const value = await checkSwitchboardFlag(FANOUT_VIA_LAMBDA_FLAG, request);
      logger.info('feedback.store.s3.fanout_flag', { flag: FANOUT_VIA_LAMBDA_FLAG, value });
      return value;
    } catch (err) {
      logger.warn('feedback.store.s3.fanout_flag_lookup_failed', {
        flag: FANOUT_VIA_LAMBDA_FLAG,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();

  // Resolve the Jira-ticket eligibility config from the JSON-typed Switchboard
  // setting (the gasket plugin surfaces it as an already-parsed object). We
  // re-serialize to a canonical JSON string for the parquet column, which the
  // fanout Lambda parses and reconciles against its built-in default
  // (issue/support OFF, feedback ON, strict rating < 7). `checkSwitchboardObject`
  // returns null when the flag is absent or not an object → stamp null and the
  // Lambda applies its default. Soft-default to null on any lookup failure so a
  // Switchboard outage falls back to the Lambda baseline rather than failing
  // the submission.
  const jiraEligibilityConfig: string | null = await (async () => {
    try {
      const value = await checkSwitchboardObject(JIRA_ELIGIBILITY_FLAG, request);
      const serialized = value ? JSON.stringify(value) : null;
      logger.info('feedback.store.s3.jira_eligibility_flag', {
        flag: JIRA_ELIGIBILITY_FLAG,
        present: serialized != null,
      });
      return serialized;
    } catch (err) {
      logger.warn('feedback.store.s3.jira_eligibility_lookup_failed', {
        flag: JIRA_ELIGIBILITY_FLAG,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();

  // Best-effort customer profile fetch — populates the legacy CRM case shape
  // (firstName/lastName/email/phone, not raw IDs). Profile API failure must
  // NOT block the parquet write: legacy rows render fine in the Lambda with
  // null-safe fallbacks (customer_id used as contactName, no email/phone).
  // Mirrors the pattern used by app/src/lib/crm/case-client.ts:openCrmCase
  // which we replaced for the fanout flow.
  let profileFirstName: string | null = null;
  let profileLastName: string | null = null;
  let profileEmail: string | null = null;
  let profilePhone: string | null = null;
  if (authContext.user.customerId) {
    try {
      const ssoToken = await airoCertTokenService.getToken();
      const profile = await fetchCustomerProfile(authContext.user.customerId, ssoToken);
      profileFirstName = profile.firstName || null;
      profileLastName = profile.lastName || null;
      profileEmail = profile.email || null;
      profilePhone = profile.phone;
    } catch (err) {
      logger.warn('feedback.store.s3.profile_fetch_failed', {
        customerId: authContext.user.customerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    feedback_category: feedbackCategory,
    app_publish_flag: appPublishFlag,
    publish_url: publishUrl,
    cln_create_utc_ts: tsStr,
    origin: feedbackOriginName,
    experiments_line: experimentsLine,
    preview_url: previewUrl,
    published_url_full: publishedUrlFull,
    full_story_url: fullStoryUrl,
    subscription_info: subscriptionInfo,
    shopper_id: authContext.user.shopperId ?? null,
    customer_first_name: profileFirstName,
    customer_last_name: profileLastName,
    customer_email: profileEmail,
    customer_phone: profilePhone,
    fanout_via_lambda: fanoutViaLambda,
    jira_eligibility_config: jiraEligibilityConfig,
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

  // Async-invoke fanout Lambda with an S3-event-shaped payload. Best
  // effort: the parquet is the system of record, so an invoke failure
  // does NOT roll back the 200 — ops can replay from the parquet via
  // `aws lambda invoke ... --payload <S3 event>` if needed.
  if (FANOUT_LAMBDA_FN && lambdaClient) {
    try {
      await lambdaClient.send(new InvokeCommand({
        FunctionName: FANOUT_LAMBDA_FN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          Records: [{
            s3: {
              bucket: { name: FEEDBACK_BUCKET },
              object: { key: s3Key },
            },
          }],
        })),
      }));
      logger.info('feedback.store.fanout.invoked', { appId, s3Key });
    } catch (err) {
      logger.warn('feedback.store.fanout.invoke_failed', {
        appId,
        s3Key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ success: true });
});
