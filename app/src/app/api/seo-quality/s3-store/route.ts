import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { APP_ID_PATTERN, buildLakePartitionS3Key, formatUtcTs, s3Client, s3ClientInitError, SAFE_FILE_ID_PATTERN } from '@/lib/s3-parquet';
import { encodeSeoQualityParquet } from './seo-quality-to-parquet';
import type { SeoQualityS3Record, SeoQualityStorePayload } from './types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SEO_QUALITY_BUCKET = process.env.SEO_QUALITY_BUCKET;

const SEO_QUALITY_TABLE_PREFIX = SEO_QUALITY_BUCKET === 'airo-builder-marketing-prod'
  ? 'airo_builder_seo_quality_cln'
  : 'airo_builder_seo_quality_cln_laketest';

if (!SEO_QUALITY_BUCKET) {
  logger.warn('seo-quality.store.s3.not_configured', {
    message: 'SEO_QUALITY_BUCKET not set — S3 writes skipped (expected in local dev)',
  });
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!SEO_QUALITY_BUCKET) {
    logger.warn('seo-quality.store.s3.skipped_not_configured');
    return NextResponse.json({ success: true, devSkipped: true });
  }
  if (!s3Client) {
    logger.error('seo-quality.store.s3.client_unavailable', { initError: s3ClientInitError });
    return NextResponse.json({ error: 'S3 client init failed' }, { status: 500 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 50_000) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  let body: SeoQualityStorePayload;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn('seo-quality.store.s3.invalid_payload', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const appId = typeof body.app_id === 'string' ? body.app_id : null;
  const rawSnapshotId = typeof body.snapshot_id === 'string' ? body.snapshot_id : null;
  const snapshotId = rawSnapshotId !== null && SAFE_FILE_ID_PATTERN.test(rawSnapshotId) ? rawSnapshotId : randomUUID();
  const score = typeof body.score === 'number' ? body.score : 0;
  const pageScores = typeof body.page_scores === 'string' ? body.page_scores : null;
  const missingElements = typeof body.missing_elements === 'string' ? body.missing_elements : null;
  const triggeredBy = typeof body.triggered_by === 'string' ? body.triggered_by : null;
  const isBaseline = typeof body.is_baseline === 'boolean' ? body.is_baseline : false;
  const capturedUtcTs = typeof body.captured_utc_ts === 'string' ? body.captured_utc_ts : new Date().toISOString();
  const scoreDelta = typeof body.score_delta === 'number' ? body.score_delta : null;
  const affectedPages = typeof body.affected_pages === 'number' ? body.affected_pages : null;
  const isRegression = typeof body.is_regression === 'boolean' ? body.is_regression : null;

  if (appId !== null && !APP_ID_PATTERN.test(appId)) {
    logger.warn('seo-quality.store.s3.invalid_app_id', { appId });
    return NextResponse.json({ error: 'Invalid app_id format' }, { status: 400 });
  }

  const now = new Date();
  const s3Key = buildLakePartitionS3Key(SEO_QUALITY_TABLE_PREFIX, now, snapshotId);
  const tsStr = formatUtcTs(now);

  const record: SeoQualityS3Record = {
    snapshot_id: snapshotId,
    app_id: appId,
    score,
    page_scores: pageScores,
    missing_elements: missingElements,
    triggered_by: triggeredBy,
    is_baseline: isBaseline,
    captured_utc_ts: capturedUtcTs,
    cln_create_utc_ts: tsStr,
    score_delta: scoreDelta,
    affected_pages: affectedPages,
    is_regression: isRegression,
    shopper_id: authContext.user.shopperId ?? null,
  };

  let parquetBody: Buffer;
  try {
    parquetBody = await encodeSeoQualityParquet(record);
  } catch (err) {
    logger.error('seo-quality.store.s3.parquet_encode_failed', {
      appId,
      snapshotId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Parquet encode failed' }, { status: 500 });
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: SEO_QUALITY_BUCKET,
      Key: s3Key,
      Body: parquetBody,
      ContentType: 'application/vnd.apache.parquet',
    }));

    logger.info('seo-quality.store.s3.success', {
      appId,
      snapshotId,
      isBaseline,
      score,
    });
  } catch (err) {
    logger.error('seo-quality.store.s3.failure', {
      appId,
      s3Key,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'S3 write failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
