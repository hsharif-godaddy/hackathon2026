import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function buildTestParquet(row) {
  const { ParquetSchema, ParquetWriter } = require('parquetjs');
  const schema = new ParquetSchema({
    feedback_id: { type: 'UTF8' },
    customer_id: { type: 'UTF8', optional: true },
    app_id: { type: 'UTF8', optional: true },
    feedback_utc_ts: { type: 'TIMESTAMP_MILLIS' },
    feedback_text: { type: 'UTF8', optional: true },
    consent_flag: { type: 'BOOLEAN', optional: true },
    rating: { type: 'INT32', optional: true },
    feedback_origin_name: { type: 'UTF8', optional: true },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS' },
  });

  const chunks = [];
  const stream = {
    write(buf, cb) { chunks.push(buf); cb(); },
    close(cb) { if (cb) cb(); },
  };
  const writer = await ParquetWriter.openStream(schema, stream, { useDataPageV2: true });
  await writer.appendRow(row);
  await writer.close();
  return Buffer.concat(chunks);
}

await test('parseFeedbackParquet decodes single row', async () => {
  const buf = await buildTestParquet({
    feedback_id: 'sub-1',
    customer_id: 'cust-1',
    app_id: 'app-1',
    feedback_utc_ts: new Date(1747834200000),
    feedback_text: 'broken',
    consent_flag: true,
    rating: 3,
    feedback_origin_name: 'issue',
    cln_create_utc_ts: new Date(1747834200000),
  });

  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  const rec = await parseFeedbackParquet(buf);
  assert.equal(rec.feedback_id, 'sub-1');
  assert.equal(rec.customer_id, 'cust-1');
  assert.equal(rec.app_id, 'app-1');
  assert.equal(rec.feedback_text, 'broken');
  assert.equal(rec.rating, 3);
  assert.equal(rec.feedback_origin_name, 'issue');
});

await test('parseFeedbackParquet throws on empty buffer', async () => {
  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  await assert.rejects(() => parseFeedbackParquet(Buffer.alloc(0)), /parquet/i);
});

/**
 * Schema-drift guard: this test writes a parquet using the EXACT column set
 * the BFF encoder produces today (`app/src/app/api/feedback/s3-store/feedback-to-parquet.ts`).
 * If a future change adds a column to the BFF schema or removes one without
 * updating the parser, this round-trip will start failing — preventing a
 * silent prod regression where fields the Lambda relies on (e.g.
 * `fanout_via_lambda`, `feedback_category`) come back undefined and the
 * handler silently no-ops or sends bad CRM bodies.
 *
 * Keep this list in sync with `feedback-to-parquet.ts:PARQUET_SCHEMA`.
 */
async function buildFullSchemaParquet(row) {
  const { ParquetSchema, ParquetWriter } = require('parquetjs');
  const schema = new ParquetSchema({
    feedback_id: { type: 'UTF8' },
    customer_id: { type: 'UTF8', optional: true },
    app_id: { type: 'UTF8', optional: true },
    feedback_utc_ts: { type: 'TIMESTAMP_MILLIS' },
    feedback_text: { type: 'UTF8', optional: true },
    consent_flag: { type: 'BOOLEAN', optional: true },
    rating: { type: 'INT32', optional: true },
    plan_type_name: { type: 'UTF8', optional: true },
    subscription_id: { type: 'UTF8', optional: true },
    subscription_status: { type: 'UTF8', optional: true },
    total_credit_cnt: { type: 'INT32', optional: true },
    available_credit_cnt: { type: 'INT32', optional: true },
    feedback_topic_list: { type: 'UTF8', optional: true },
    feedback_origin_name: { type: 'UTF8', optional: true },
    feedback_category: { type: 'UTF8', optional: true },
    app_publish_flag: { type: 'BOOLEAN', optional: true },
    publish_url: { type: 'UTF8', optional: true },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS' },
    origin: { type: 'UTF8', optional: true },
    experiments_line: { type: 'UTF8', optional: true },
    preview_url: { type: 'UTF8', optional: true },
    published_url_full: { type: 'UTF8', optional: true },
    full_story_url: { type: 'UTF8', optional: true },
    subscription_info: { type: 'UTF8', optional: true },
    shopper_id: { type: 'UTF8', optional: true },
    fanout_via_lambda: { type: 'BOOLEAN', optional: true },
  });
  const chunks = [];
  const stream = {
    write(buf, cb) { chunks.push(buf); cb(); },
    close(cb) { if (cb) cb(); },
  };
  const writer = await ParquetWriter.openStream(schema, stream, { useDataPageV2: false });
  await writer.appendRow(row);
  await writer.close();
  return Buffer.concat(chunks);
}

await test('parseFeedbackParquet round-trips the full BFF schema (every column the BFF writes is parsed)', async () => {
  const ts = new Date(1747834200000);
  const fullRow = {
    feedback_id: 'sub-1',
    customer_id: 'cust-1',
    app_id: 'app-1',
    feedback_utc_ts: ts,
    feedback_text: 'broken thing',
    consent_flag: true,
    rating: 3,
    plan_type_name: 'Pro Annual',
    subscription_id: 'sub-x',
    subscription_status: 'Active',
    total_credit_cnt: 100,
    available_credit_cnt: 42,
    feedback_topic_list: '["topic-a"]',
    feedback_origin_name: 'first-publish-banner',
    feedback_category: 'issue',
    app_publish_flag: true,
    publish_url: 'https://example.com',
    cln_create_utc_ts: ts,
    origin: 'first-publish-banner',
    experiments_line: 'exp1=A, exp2=B',
    preview_url: 'https://preview.example.com/?t=abc',
    published_url_full: 'https://customer.app.example.com',
    full_story_url: 'https://app.fullstory.com/ui/123',
    subscription_info: 'Pro Annual / Active',
    shopper_id: '9469965',
    fanout_via_lambda: true,
  };
  const buf = await buildFullSchemaParquet(fullRow);

  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  const rec = await parseFeedbackParquet(buf);

  // Spot-check every column the handler reads — schema drift surfaces here.
  assert.equal(rec.feedback_id, 'sub-1');
  assert.equal(rec.customer_id, 'cust-1');
  assert.equal(rec.app_id, 'app-1');
  assert.equal(rec.feedback_text, 'broken thing');
  assert.equal(rec.rating, 3);
  assert.equal(rec.consent_flag, true);
  assert.equal(rec.feedback_category, 'issue');
  assert.equal(rec.feedback_origin_name, 'first-publish-banner');
  assert.equal(rec.feedback_topic_list, '["topic-a"]');
  assert.equal(rec.shopper_id, '9469965');
  assert.equal(rec.fanout_via_lambda, true);
  assert.equal(rec.preview_url, 'https://preview.example.com/?t=abc');
  assert.equal(rec.published_url_full, 'https://customer.app.example.com');
  assert.equal(rec.full_story_url, 'https://app.fullstory.com/ui/123');
  assert.equal(rec.subscription_info, 'Pro Annual / Active');
  assert.equal(rec.experiments_line, 'exp1=A, exp2=B');
});

await test('parseFeedbackParquet handles fanout_via_lambda=false (legacy gate path)', async () => {
  const ts = new Date(1747834200000);
  const buf = await buildFullSchemaParquet({
    feedback_id: 'sub-1', customer_id: 'cust-1', app_id: 'app-1',
    feedback_utc_ts: ts, cln_create_utc_ts: ts,
    fanout_via_lambda: false,
  });
  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  const rec = await parseFeedbackParquet(buf);
  assert.equal(rec.fanout_via_lambda, false, 'Lambda gate must read false correctly');
});

await test('parseFeedbackParquet handles missing optional fields (legacy parquets pre-fanout)', async () => {
  // Subset schema — represents pre-fanout parquets without the new columns.
  const buf = await buildTestParquet({
    feedback_id: 'sub-1',
    customer_id: 'cust-1',
    app_id: 'app-1',
    feedback_utc_ts: new Date(1747834200000),
    feedback_text: 'old',
    consent_flag: false,
    rating: 5,
    feedback_origin_name: 'feedback',
    cln_create_utc_ts: new Date(1747834200000),
  });
  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  const rec = await parseFeedbackParquet(buf);
  // fanout_via_lambda missing → handler treats as no-op (correct backward-compat).
  assert.equal(rec.fanout_via_lambda, undefined);
  assert.equal(rec.shopper_id, undefined);
});
