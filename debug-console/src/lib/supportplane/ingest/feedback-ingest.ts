/**
 * feedback-ingest.ts
 *
 * Two-phase hybrid ingestion for Feedback Analytics:
 *   Phase 1 — Athena: complete calendar months older than current month
 *   Phase 2 — S3 parquet: current month + recent days
 *
 * Ported from airo_support_v2/backend/src/services/analytics-ingest.service.ts
 * Uses DynamoDB for persistent storage via feedback-db module.
 */

import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
} from '@aws-sdk/client-athena';
import { fromIni } from '@aws-sdk/credential-providers';
import { parquetReadObjects, parquetMetadata } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import { logger } from '@/lib/logger';
import {
  getAlreadyIngestedKeys,
  clearFeedbackData,
  insertFeedbackAthenaRow,
  insertFeedbackS3Row,
  rebuildFeedbackComposite,
  logIngestionSuccess,
  logIngestionError,
  recomputeDailyStats,
} from '@/lib/supportplane/db/feedback-db';
import { getSpEnv } from '@/lib/supportplane/store/config';

// ── Config from env ───────────────────────────────────────────────

// Treat empty/whitespace env values as unset. A blank `FOO=` line in .env still
// produces '' in process.env, and the `??` operator does NOT fall through on '',
// so it would poison the default (e.g. an empty FEEDBACK_S3_BUCKET= yields a
// `Bucket: ''` request that the AWS SDK rejects). Use this for any var that has
// a meaningful default.
function envOr(value: string | undefined, fallback: string): string {
  const trimmed: string = value?.trim() ?? '';
  return trimmed === '' ? fallback : trimmed;
}

function cfg() {
  const feedbackEnv = getSpEnv() as 'dev' | 'prod';
  const isProd = feedbackEnv === 'prod';
  // S3 bucket/prefix vars are split by env so both can coexist in .env.local.
  // Falls back to the legacy FEEDBACK_S3_BUCKET/PREFIX, then a hard default, when
  // the split vars are absent OR set to an empty string.
  const s3Bucket = isProd
    ? envOr(process.env.S3_FEEDBACK_BUCKET_PROD, envOr(process.env.FEEDBACK_S3_BUCKET, 'airo-builder-feedback-prod'))
    : envOr(process.env.S3_FEEDBACK_BUCKET_DEV, envOr(process.env.FEEDBACK_S3_BUCKET, 'airo-builder-feedback-dev'));
  const s3Prefix = isProd
    ? envOr(process.env.S3_FEEDBACK_TABLE_PROD, envOr(process.env.FEEDBACK_S3_PREFIX, 'airo_builder_feedback_cln/'))
    : envOr(process.env.S3_FEEDBACK_TABLE_DEV, envOr(process.env.FEEDBACK_S3_PREFIX, 'airo_builder_feedback_cln_laketest/'));
  return {
    env: feedbackEnv,
    startDate: process.env.FEEDBACK_START_DATE ?? '2026-04-01',
    awsRegion: process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-west-2',
    awsProfile: process.env.AWS_PROFILE ?? '',
    athenaProfile: process.env.ATHENA_AWS_PROFILE ?? '',
    athenaKeyId: process.env.ATHENA_AWS_ACCESS_KEY_ID ?? '',
    athenaSecret: process.env.ATHENA_AWS_SECRET_ACCESS_KEY ?? '',
    athenaToken: process.env.ATHENA_AWS_SESSION_TOKEN ?? '',
    awsKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    awsSecret: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    awsToken: process.env.AWS_SESSION_TOKEN ?? '',
    s3FeedbackBucket: s3Bucket,
    s3FeedbackPrefix: s3Prefix,
    athenaDb: process.env.ATHENA_DATABASE ?? 'airo_builder_cln',
    athenaTable: process.env.ATHENA_TABLE ?? 'airo_builder_feedback_cln',
    athenaOutput: process.env.ATHENA_OUTPUT_BUCKET ?? '',
    historyDays: parseInt(process.env.ATHENA_HISTORY_DAYS ?? '30', 10),
  };
}

function bucket(c = cfg()) {
  return c.s3FeedbackBucket;
}

function tablePrefix(c = cfg()) {
  return c.s3FeedbackPrefix;
}

// ── Progress reporting ────────────────────────────────────────────

export interface IngestProgress {
  phase: 'scanning' | 'ingesting' | 'aggregating' | 'done' | 'error';
  currentSource: 'athena' | 's3' | undefined;
  totalFiles: number;
  processed: number;
  skipped: number;
  newRows: number;
  errors: number;
  currentFile: string | undefined;
  message: string | undefined;
}

export type ProgressCallback = (p: IngestProgress) => void;

// ── AWS clients ───────────────────────────────────────────────────

function buildCredentials(c: ReturnType<typeof cfg>) {
  if (c.awsKeyId && c.awsSecret) {
    return {
      accessKeyId: c.awsKeyId,
      secretAccessKey: c.awsSecret,
      ...(c.awsToken ? { sessionToken: c.awsToken } : {}),
    };
  }
  if (c.awsProfile) return fromIni({ profile: c.awsProfile });
  return undefined;
}

function buildS3(c: ReturnType<typeof cfg>): S3Client {
  const creds = buildCredentials(c);
  return new S3Client({ region: c.awsRegion, ...(creds ? { credentials: creds } : {}) });
}

function buildAthena(c: ReturnType<typeof cfg>): AthenaClient {
  let creds: ReturnType<typeof buildCredentials>;
  if (c.athenaKeyId && c.athenaSecret) {
    creds = {
      accessKeyId: c.athenaKeyId,
      secretAccessKey: c.athenaSecret,
      ...(c.athenaToken ? { sessionToken: c.athenaToken } : {}),
    };
  } else if (c.athenaProfile) {
    creds = fromIni({ profile: c.athenaProfile });
  } else {
    creds = buildCredentials(c);
  }
  return new AthenaClient({ region: c.awsRegion, ...(creds ? { credentials: creds } : {}) });
}

// ── AWS error classification ──────────────────────────────────────

function classifyAwsError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ExpiredToken|expir.*token|sso.*session|InvalidClientTokenId|AuthFailure/i.test(msg)) {
    const profile = process.env.AWS_PROFILE ?? '<your-profile>';
    return new Error(
      `AWS credentials expired.\nRun: aws sso login --profile ${profile}\n\nOriginal: ${msg}`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

// ── Date helpers ──────────────────────────────────────────────────

// Returns all months from startIso through the current month (inclusive).
function allMonthRange(startIso: string): string[] {
  const result: string[] = [];
  const start = new Date(startIso);
  const now = new Date();
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (
    cur.getFullYear() < now.getFullYear() ||
    (cur.getFullYear() === now.getFullYear() && cur.getMonth() <= now.getMonth())
  ) {
    result.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return result;
}

function dateRange(from: Date, to: Date): { year: string; month: string; day: string }[] {
  const result: { year: string; month: string; day: string }[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  while (cur <= to) {
    result.push({
      year: String(cur.getFullYear()),
      month: String(cur.getMonth() + 1).padStart(2, '0'),
      day: String(cur.getDate()).padStart(2, '0'),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ── S3 utilities ──────────────────────────────────────────────────

async function downloadParquet(s3: S3Client, s3Url: string): Promise<ArrayBuffer> {
  const match = s3Url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid S3 URL: ${s3Url}`);
  const [, b, key] = match;

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: b, Key: key }));
    if (!res.Body) throw new Error('S3 response had no body');
    const bytes = await res.Body.transformToByteArray();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch (err) {
    throw classifyAwsError(err);
  }
}

async function listPartitions(
  s3: S3Client,
  env: 'dev' | 'prod',
  year: string,
  month: string,
  day: string,
  continuationToken?: string
): Promise<{ partitions: { s3Url: string }[]; nextToken: string | undefined }> {
  const c = cfg();
  const b = bucket(c);
  const tp = tablePrefix(c);
  const prefix = `${tp}year=${year}/month=${month}/day=${day}/`;

  try {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: b,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      })
    );
    const partitions = (res.Contents ?? [])
      .filter((o) => o.Key?.endsWith('.parquet'))
      .map((o) => ({ s3Url: `s3://${b}/${o.Key!}` }));
    return { partitions, nextToken: res.NextContinuationToken };
  } catch (err) {
    throw classifyAwsError(err);
  }
}

// ── Athena utilities ──────────────────────────────────────────────

async function runAthenaQuery(
  athena: AthenaClient,
  sql: string,
  db: string,
  outputBucket: string
): Promise<Record<string, unknown>[]> {
  // If already has s3:// scheme, use as-is; if has a prefix (bucket/key), just add scheme;
  // if bare bucket name, append /athena-results/ so Athena can write results.
  const outputLocation = outputBucket.startsWith('s3://')
    ? outputBucket
    : outputBucket.includes('/')
      ? `s3://${outputBucket}/`
      : `s3://${outputBucket}/athena-results/`;

  const start = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: db },
      ResultConfiguration: { OutputLocation: outputLocation },
    })
  );
  const id = start.QueryExecutionId;
  if (!id) throw new Error('Athena returned no execution ID');

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const status = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const state = status.QueryExecution?.Status?.State;
    if (state === QueryExecutionState.SUCCEEDED) break;
    if (state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
      throw new Error(`Athena query ${state}: ${status.QueryExecution?.Status?.StateChangeReason}`);
    }
    await new Promise<void>((r) => setTimeout(r, 2000));
  }

  const rows: Record<string, unknown>[] = [];
  let nextToken: string | undefined;
  let headers: string[] | null = null;

  do {
    const res = await athena.send(
      new GetQueryResultsCommand({ QueryExecutionId: id, NextToken: nextToken })
    );
    const resultRows = res.ResultSet?.Rows ?? [];
    if (!headers) {
      headers = (resultRows[0]?.Data ?? []).map((c) => c.VarCharValue ?? '');
      for (let i = 1; i < resultRows.length; i++) {
        const obj: Record<string, unknown> = {};
        (resultRows[i]?.Data ?? []).forEach((c, idx) => {
          obj[headers![idx] ?? idx] = c.VarCharValue ?? null;
        });
        rows.push(obj);
      }
    } else {
      for (const r of resultRows) {
        const obj: Record<string, unknown> = {};
        (r.Data ?? []).forEach((c, idx) => {
          obj[headers![idx] ?? idx] = c.VarCharValue ?? null;
        });
        rows.push(obj);
      }
    }
    nextToken = res.NextToken;
  } while (nextToken);

  return rows;
}

// ── Row mapping ───────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function flag(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return 1;
  if (s === 'false' || s === '0') return 0;
  return null;
}

// Converts Arrow timestamps (BigInt microseconds, Date objects, epoch numbers) → ISO string.
// Parquet TIMESTAMP cols come through as BigInt (μs), Date, or occasionally number (ms/μs).
function tsStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'bigint') {
    const ms = Number(v) / 1000; // μs → ms
    return isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (typeof v === 'number') {
    const ms = v > 1e13 ? v / 1000 : v; // μs → ms if very large
    return isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const s = String(v).trim();
  if (!s || s === 'null') return null;
  // Numeric string that looks like epoch μs (16 digits) or ms (13 digits)
  const n = Number(s);
  if (!isNaN(n) && n > 1e12) {
    const ms = n > 1e13 ? n / 1000 : n;
    return new Date(ms).toISOString();
  }
  return s;
}

function feedbackId(row: Record<string, unknown>, sourceKey: string): string {
  return (
    str(row['feedback_id']) ??
    `${sourceKey}:${tsStr(row['feedback_utc_ts'])}:${str(row['customer_id'])}`
  );
}

function topicList(row: Record<string, unknown>): string | null {
  return typeof row['feedback_topic_list'] === 'string'
    ? row['feedback_topic_list']
    : JSON.stringify(row['feedback_topic_list'] ?? null);
}

// 18 params for feedback_athena (core Athena CLN columns only).
function rowParamsAthena(row: Record<string, unknown>, env: string, sourceKey: string): unknown[] {
  return [
    feedbackId(row, sourceKey),
    env,
    str(row['app_id']),
    str(row['customer_id']),
    tsStr(row['feedback_utc_ts']),
    num(row['rating']),
    str(row['feedback_text']),
    flag(row['consent_flag']),
    str(row['plan_type_name']),
    str(row['subscription_id']),
    str(row['subscription_status']),
    num(row['total_credit_cnt']),
    num(row['available_credit_cnt']),
    topicList(row),
    str(row['feedback_origin_name']),
    flag(row['app_publish_flag']),
    str(row['publish_url']),
    tsStr(row['cln_create_utc_ts']),
  ];
}

// 29 params for feedback_s3 (all columns including enrichment fields from parquet).
function rowParamsS3(row: Record<string, unknown>, env: string, sourceUrl: string): unknown[] {
  return [
    feedbackId(row, sourceUrl),
    env,
    str(row['app_id']),
    str(row['customer_id']),
    tsStr(row['feedback_utc_ts']),
    num(row['rating']),
    str(row['feedback_text']),
    flag(row['consent_flag']),
    str(row['plan_type_name']),
    str(row['subscription_id']),
    str(row['subscription_status']),
    num(row['total_credit_cnt']),
    num(row['available_credit_cnt']),
    topicList(row),
    str(row['feedback_origin_name']),
    str(row['feedback_category']),
    flag(row['app_publish_flag']),
    str(row['full_story_url']),
    str(row['shopper_id']),
    str(row['experiments_line']),
    str(row['publish_url']),
    tsStr(row['cln_create_utc_ts']),
    str(row['s3_url']) ?? sourceUrl,
    str(row['device_type']),
    str(row['browser_type']),
    str(row['page_url']),
    str(row['session_id']),
    str(row['app_name']),
    str(row['app_version']),
  ];
}

// ── Main ingestion entry point ────────────────────────────────────

export async function runFeedbackIngestion(
  onProgress?: ProgressCallback,
  opts: { force?: boolean; sources?: 'athena' | 's3' | 'both' } = {}
): Promise<IngestProgress> {
  const c = cfg();
  const env = c.env;
  const s3 = buildS3(c);

  const progress: IngestProgress = {
    phase: 'scanning',
    currentSource: undefined,
    totalFiles: 0,
    processed: 0,
    skipped: 0,
    newRows: 0,
    errors: 0,
    currentFile: undefined,
    message: undefined,
  };

  const emit = (update: Partial<IngestProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  logger.info('feedback-ingest.start', { env, startDate: c.startDate, force: opts.force ?? false });

  // No explicit credentials configured — deployed environments use IAM instance roles,
  // which the SDK picks up automatically. Only warn; let the SDK try and fail meaningfully.
  if (!c.awsKeyId && !c.awsProfile) {
    logger.info('feedback-ingest.no-explicit-credentials', { note: 'will attempt SDK default chain (instance role)' });
  }

  // Force resync: wipe all source data and ingestion history so everything is re-fetched.
  if (opts.force) {
    emit({ phase: 'scanning', message: 'Force resync: clearing local data…' });
    try {
      await clearFeedbackData(env);
      emit({ phase: 'scanning', message: 'Force resync: data cleared ✓ — starting fresh…' });
      logger.info('feedback-ingest.force-clear', { env });
    } catch (clearErr) {
      const clearMsg = clearErr instanceof Error ? clearErr.message : String(clearErr);
      logger.error('feedback-ingest.force-clear.failed', { env, error: clearMsg });
      throw new Error(`clearFeedbackData failed: ${clearMsg}`);
    }
  }

  const alreadyDone = await getAlreadyIngestedKeys();
  const affectedDates = new Set<string>();

  // ── Phase 1: Athena — all months from startDate through current month ──
  // Uses table name only in SQL (database set via QueryExecutionContext).
  // Covers the full range including the current month so nothing is missed.
  const athenaEnabled = !!c.athenaOutput;
  const months = allMonthRange(c.startDate);

  if (athenaEnabled && months.length > 0) {
    const athena = buildAthena(c);
    const toFetch = months.filter(
      (ym) => !alreadyDone.has(`athena:${c.athenaDb}.${c.athenaTable}:${ym}`)
    );
    progress.skipped += months.length - toFetch.length;

    emit({
      phase: 'ingesting',
      currentSource: 'athena',
      skipped: progress.skipped,
      message: `Athena: ${toFetch.length} months to fetch (${progress.skipped} already done)`,
    });

    for (const ym of toFetch) {
      const [y, m] = ym.split('-');
      const nextM = new Date(Number(y), Number(m) - 1 + 1, 1);
      const nextYM = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}`;
      const key = `athena:${c.athenaDb}.${c.athenaTable}:${ym}`;

      emit({ currentFile: key, message: `Athena: querying ${ym}` });

      try {
        // Use table name only — database is passed via QueryExecutionContext.
        // This matches the canonical query: SELECT * FROM airo_builder_feedback_cln ...
        const rows = await runAthenaQuery(
          athena,
          `SELECT * FROM ${c.athenaTable} WHERE feedback_utc_ts >= '${ym}-01' AND feedback_utc_ts < '${nextYM}-01' ORDER BY feedback_utc_ts`,
          c.athenaDb,
          c.athenaOutput
        );

        let written = 0;
        for (const row of rows) {
          const ts = str(row['feedback_utc_ts']);
          if (ts) affectedDates.add(ts.slice(0, 10));
          written += await insertFeedbackAthenaRow(rowParamsAthena(row, env, key));
        }
        await logIngestionSuccess(key, 'athena', written);
        progress.processed++;
        progress.newRows += written;
        emit({ message: `Athena ${ym}: ${written} rows written` });
      } catch (err) {
        const msg = (err as Error).message;
        await logIngestionError(key, 'athena', msg);
        progress.errors++;
        logger.warn('feedback-ingest.athena.error', { ym, db: c.athenaDb, table: c.athenaTable, output: c.athenaOutput, error: msg });
        emit({ message: `Athena ${ym} error: ${msg.slice(0, 120)}` });
      }
    }
  }

  // ── Phase 2: S3 parquet — always scan from startDate ─────────
  // S3 is the source of truth for raw data; Athena supplements with CLN enrichment.
  // Never restrict the S3 scan range based on Athena status — Athena may fail or be
  // unavailable, and S3 must cover the full history regardless.
  const today = new Date();
  const s3From = new Date(c.startDate);
  const s3Days = dateRange(s3From, today);

  emit({ phase: 'scanning', currentSource: 's3', message: `S3: scanning ${s3Days.length} days…` });

  const allS3Files: { s3Url: string }[] = [];

  for (const { year, month, day } of s3Days) {
    try {
      let token: string | undefined;
      do {
        const result = await listPartitions(s3, env, year, month, day, token);
        allS3Files.push(...result.partitions);
        token = result.nextToken;
      } while (token);
    } catch (err) {
      const msg = (err as Error).message;
      if (/expir|sso login|ExpiredToken|InvalidClientTokenId|AuthFailure/i.test(msg)) throw err;
      progress.errors++;
      logger.warn('feedback-ingest.s3.scan.error', { year, month, day, error: msg });
    }
  }

  const s3ToProcess = allS3Files.filter((f) => !alreadyDone.has(f.s3Url));
  progress.skipped += allS3Files.length - s3ToProcess.length;

  emit({
    // totalFiles = Athena (processed + skipped) + S3 new to process; S3 already-done is in progress.skipped
    totalFiles: progress.processed + progress.skipped + s3ToProcess.length,
    skipped: progress.skipped,
    phase: 'ingesting',
    message: `S3: ${s3ToProcess.length} new files`,
  });

  for (const file of s3ToProcess) {
    emit({ currentFile: file.s3Url, message: `S3: ingesting ${file.s3Url.split('/').at(-1)}` });

    try {
      const ab = await downloadParquet(s3, file.s3Url);
      const asyncBuffer = {
        byteLength: ab.byteLength,
        slice: (start: number, end?: number) => Promise.resolve(ab.slice(start, end)),
      };

      const rows = (await parquetReadObjects({ file: asyncBuffer, compressors })) as Record<
        string,
        unknown
      >[];
      let written = 0;
      for (const row of rows) {
        const ts = str(row['feedback_utc_ts']);
        if (ts) affectedDates.add(ts.slice(0, 10));
        written += await insertFeedbackS3Row(rowParamsS3(row, env, file.s3Url));
      }
      await logIngestionSuccess(file.s3Url, 's3', written);
      progress.processed++;
      progress.newRows += written;
    } catch (err) {
      const msg = (err as Error).message;
      await logIngestionError(file.s3Url, 's3', msg);
      progress.errors++;
      logger.warn('feedback-ingest.s3.file.error', { url: file.s3Url, error: msg });
    }
    emit({});
  }

  // ── Phase 3: rebuild composite (feedback_athena + feedback_s3 → feedback_raw) ──
  emit({ phase: 'aggregating', message: 'Rebuilding composite (Athena + S3 merge)…' });
  const compositeRows = await rebuildFeedbackComposite(env);
  emit({ message: `Composite rebuilt — ${compositeRows.toLocaleString()} total rows` });

  // ── Phase 4: recompute daily aggregates ──────────────────────
  emit({ message: `Recomputing stats for ${affectedDates.size} dates…` });
  if (affectedDates.size > 0) await recomputeDailyStats(env, [...affectedDates]);

  emit({
    phase: 'done',
    currentSource: undefined,
    currentFile: undefined,
    message: `Done — ${progress.newRows} new rows from ${progress.processed} sources`,
  });

  logger.info('feedback-ingest.complete', {
    processed: progress.processed,
    skipped: progress.skipped,
    newRows: progress.newRows,
    errors: progress.errors,
  });

  return progress;
}

// ── Standalone rebuild helper (called by rebuild route) ───────────

export async function runRebuildComposite(): Promise<{ rows: number }> {
  const c = cfg();
  const env = c.env;
  const rows = await rebuildFeedbackComposite(env);
  await recomputeDailyStats(env);
  return { rows };
}
