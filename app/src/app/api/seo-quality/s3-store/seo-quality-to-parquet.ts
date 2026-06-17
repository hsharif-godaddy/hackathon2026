import { encodeParquet, ParquetSchema, ParquetSchemaInstance } from '@/lib/s3-parquet';
import type { SeoQualityS3Record } from './types';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

let PARQUET_SCHEMA: ParquetSchemaInstance | null = null;
let parquetSchemaInitError: string | null = null;
try {
  PARQUET_SCHEMA = new ParquetSchema({
    snapshot_id: { type: 'UTF8', compression: 'UNCOMPRESSED' },
    app_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    score: { type: 'INT32', compression: 'UNCOMPRESSED' },
    page_scores: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    missing_elements: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    triggered_by: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    is_baseline: { type: 'BOOLEAN', compression: 'UNCOMPRESSED' },
    captured_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    score_delta: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    affected_pages: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    is_regression: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
    shopper_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
  });
} catch (err) {
  parquetSchemaInitError = err instanceof Error ? err.message : String(err);
}

function clampInt32(n: number): number {
  return Math.min(Math.max(Math.trunc(n), INT32_MIN), INT32_MAX);
}

function toInt32(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return clampInt32(value);
}

function parseTimestamp(isoString: string): Date {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${isoString}`);
  return d;
}

function rowForParquet(record: SeoQualityS3Record): Record<string, unknown> {
  return {
    snapshot_id: record.snapshot_id,
    app_id: record.app_id,
    score: clampInt32(record.score),
    page_scores: record.page_scores,
    missing_elements: record.missing_elements,
    triggered_by: record.triggered_by,
    is_baseline: record.is_baseline,
    captured_utc_ts: parseTimestamp(record.captured_utc_ts),
    cln_create_utc_ts: parseTimestamp(record.cln_create_utc_ts),
    score_delta: toInt32(record.score_delta),
    affected_pages: toInt32(record.affected_pages),
    is_regression: record.is_regression,
    shopper_id: record.shopper_id,
  };
}

export async function encodeSeoQualityParquet(record: SeoQualityS3Record): Promise<Buffer> {
  if (parquetSchemaInitError != null || PARQUET_SCHEMA == null) {
    throw new Error(`Parquet schema unavailable: ${parquetSchemaInitError ?? 'unknown'}`);
  }
  return encodeParquet(PARQUET_SCHEMA, rowForParquet(record));
}
