import { createRequire } from 'node:module';

import { parseFeedbackUtcStringToDate } from './feedback-timestamp';
import type { FeedbackS3Record } from './types';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

const require = createRequire(import.meta.url);
const { ParquetSchema, ParquetWriter } = require('parquetjs') as {
  ParquetSchema: new (schema: Record<string, unknown>) => {
    fields: unknown;
    fieldList: unknown[];
  };
  ParquetWriter: {
    openStream(
      schema: InstanceType<typeof ParquetSchema>,
      outputStream: { write: (buf: Buffer, cb: (err?: Error | null) => void) => void; close: (cb?: (err?: Error | null) => void) => void },
      opts: { useDataPageV2?: boolean },
    ): Promise<{
      appendRow: (row: Record<string, unknown>) => Promise<void>;
      close: () => Promise<void>;
    }>;
  };
};

let PARQUET_SCHEMA: InstanceType<typeof ParquetSchema> | null = null;
let parquetSchemaInitError: string | null = null;
try {
  PARQUET_SCHEMA = new ParquetSchema({
    feedback_id: { type: 'UTF8', compression: 'UNCOMPRESSED' },
    customer_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    app_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    feedback_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    feedback_text: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    consent_flag: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
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
    shopper_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    // Per-submission Switchboard gate (`appbuilder-fanout-via-lambda`).
    // Optional so legacy parquet rows (pre-cutover) read back as null and the
    // Lambda treats anything other than strict `true` as no-op.
    fanout_via_lambda: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
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
    fanout_via_lambda: record.fanout_via_lambda,
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

  const chunks: Buffer[] = [];
  const outputStream = {
    write(buf: Buffer, cb: (err?: Error | null) => void) {
      try {
        chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as Parameters<typeof Buffer.from>[0]));
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
    close(cb?: (err?: Error | null) => void) {
      cb?.();
    },
  };

  const writer = await ParquetWriter.openStream(PARQUET_SCHEMA, outputStream, { useDataPageV2: false });
  try {
    await writer.appendRow(rowForParquet(record));
  } finally {
    await writer.close();
  }
  return Buffer.concat(chunks);
}

export { parseFeedbackUtcStringToDate };
