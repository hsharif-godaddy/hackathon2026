import { encodeParquet, ParquetSchema, ParquetSchemaInstance } from '@/lib/s3-parquet';
import type { SeoQualityS3Record } from './types';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

let PARQUET_SCHEMA: ParquetSchemaInstance | null = null;
let parquetSchemaInitError: string | null = null;
try {
  // Lake/DDL column names (DATAGOVCON) — mapped from app fields in rowForParquet().
  // DDL comments: snapshot_id → @PrimaryKey; timestamps → timestamptz / *_utc_ts.
  PARQUET_SCHEMA = new ParquetSchema({
    snapshot_id: { type: 'UTF8', compression: 'UNCOMPRESSED' },
    app_id: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    seo_quality_score: { type: 'INT32', compression: 'UNCOMPRESSED' },
    page_scores_json: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    missing_element_text: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    trigger_type_name: { type: 'UTF8', optional: true, compression: 'UNCOMPRESSED' },
    baseline_flag: { type: 'BOOLEAN', compression: 'UNCOMPRESSED' },
    captured_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS', compression: 'UNCOMPRESSED' },
    seo_quality_delta_score: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    affected_page_cnt: { type: 'INT32', optional: true, compression: 'UNCOMPRESSED' },
    regression_flag: { type: 'BOOLEAN', optional: true, compression: 'UNCOMPRESSED' },
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
    seo_quality_score: clampInt32(record.score),
    page_scores_json: record.page_scores,
    missing_element_text: record.missing_elements,
    trigger_type_name: record.triggered_by,
    baseline_flag: record.is_baseline,
    captured_utc_ts: parseTimestamp(record.captured_utc_ts),
    cln_create_utc_ts: parseTimestamp(record.cln_create_utc_ts),
    seo_quality_delta_score: toInt32(record.score_delta),
    affected_page_cnt: toInt32(record.affected_pages),
    regression_flag: record.is_regression,
    shopper_id: record.shopper_id,
  };
}

export async function encodeSeoQualityParquet(record: SeoQualityS3Record): Promise<Buffer> {
  if (parquetSchemaInitError != null || PARQUET_SCHEMA == null) {
    throw new Error(`Parquet schema unavailable: ${parquetSchemaInitError ?? 'unknown'}`);
  }
  return encodeParquet(PARQUET_SCHEMA, rowForParquet(record));
}
