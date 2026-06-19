import { encodeParquet, ParquetSchema, ParquetSchemaInstance } from '@/lib/s3-parquet';
import { parseFeedbackUtcStringToDate } from './feedback-timestamp';
import type { FeedbackS3Record } from './types';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

let PARQUET_SCHEMA: ParquetSchemaInstance | null = null;
let parquetSchemaInitError: string | null = null;
try {
  PARQUET_SCHEMA = new ParquetSchema({
    feedback_id: { type: 'UTF8', compression: 'UNCOMPRESSED' },
    customer_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    app_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    feedback_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    feedback_text: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    consent_flag: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
    public_share_consent_flag: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
    rating: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    plan_type_name: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    subscription_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    subscription_status: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    total_credit_cnt: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    available_credit_cnt: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    feedback_topic_list: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    feedback_origin_name: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    feedback_category: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    app_publish_flag: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
    publish_url: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    // Fanout Lambda enrichment fields (all optional UTF8 — see types.ts).
    origin: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    experiments_line: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    preview_url: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    published_url_full: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    full_story_url: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    subscription_info: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    // Customer profile fields (BFF best-effort fetch via Profile API).
    shopper_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    customer_first_name: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    customer_last_name: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    customer_email: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    customer_phone: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    // Per-submission Switchboard gate (`appbuilder-fanout-via-lambda`).
    // Optional so legacy parquet rows (pre-cutover) read back as null and the
    // Lambda treats anything other than strict `true` as no-op.
    fanout_via_lambda: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
    // Per-submission Jira-ticket eligibility config — raw JSON string from the
    // `appbuilder-fanout-jira-eligibility` Switchboard value. Optional so
    // legacy rows read back as null; the Lambda applies its built-in default.
    jira_eligibility_config: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
  });
} catch (err) {
  parquetSchemaInitError = err instanceof Error ? err.message : String(err);
}

function clampInt32(n: number): number {
  return Math.min(Math.max(n, INT32_MIN), INT32_MAX);
}

function toInt32Credit(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return clampInt32(Math.trunc(value));
}

function toInt32Rating(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return clampInt32(Math.trunc(value));
}

function rowForParquet(record: FeedbackS3Record): Record<string, unknown> {
  return {
    feedback_id: record.feedback_id,
    customer_id: record.customer_id,
    app_id: record.app_id,
    feedback_utc_ts: parseFeedbackUtcStringToDate(record.feedback_utc_ts),
    feedback_text: record.feedback_text,
    consent_flag: record.consent_flag,
    public_share_consent_flag: record.public_share_consent_flag,
    rating: toInt32Rating(record.rating),
    plan_type_name: record.plan_type_name,
    subscription_id: record.subscription_id,
    subscription_status: record.subscription_status,
    total_credit_cnt: toInt32Credit(record.total_credit_cnt),
    available_credit_cnt: toInt32Credit(record.available_credit_cnt),
    feedback_topic_list: record.feedback_topic_list,
    feedback_origin_name: record.feedback_origin_name,
    feedback_category: record.feedback_category,
    app_publish_flag: record.app_publish_flag,
    publish_url: record.publish_url,
    cln_create_utc_ts: parseFeedbackUtcStringToDate(record.cln_create_utc_ts),
    origin: record.origin,
    experiments_line: record.experiments_line,
    preview_url: record.preview_url,
    published_url_full: record.published_url_full,
    full_story_url: record.full_story_url,
    subscription_info: record.subscription_info,
    shopper_id: record.shopper_id,
    customer_first_name: record.customer_first_name,
    customer_last_name: record.customer_last_name,
    customer_email: record.customer_email,
    customer_phone: record.customer_phone,
    fanout_via_lambda: record.fanout_via_lambda,
    jira_eligibility_config: record.jira_eligibility_config,
  };
}

/**
 * Encode one feedback row as a single-row Apache Parquet v1 file (UNCOMPRESSED
 * column values; Spectrum-friendly).
 */
export async function encodeFeedbackParquet(record: FeedbackS3Record): Promise<Buffer> {
  if (parquetSchemaInitError != null || PARQUET_SCHEMA == null) {
    throw new Error(`Parquet schema unavailable: ${parquetSchemaInitError ?? 'unknown'}`);
  }
  return encodeParquet(PARQUET_SCHEMA, rowForParquet(record));
}

export { parseFeedbackUtcStringToDate };
