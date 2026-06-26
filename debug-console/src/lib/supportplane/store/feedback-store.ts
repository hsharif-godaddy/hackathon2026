import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { buildDynamoClient, getConfig } from '@/lib/supportplane/store/config';
import { logger } from '@/lib/logger';
import { SP_MASK, spLog } from '@/lib/supportplane/sp-logger';

// A single DynamoDB BatchWriteItem request — either a Put or a Delete. Matches
// the shape DynamoDB echoes back in UnprocessedItems so leftovers can be re-sent.
type BatchWriteRequest =
  | { PutRequest: { Item: Record<string, unknown> } }
  | { DeleteRequest: { Key: Record<string, unknown> } };

let client: DynamoDBDocumentClient | null = null;

function getClient(): DynamoDBDocumentClient {
  if (client) return client;
  client = buildDynamoClient();
  return client;
}

// 5-minute module-level cache for the full feedback table scan.
// All analytics queries share this single scan result — eliminates N redundant
// full-table reads per page load. 15 min matches the L1 transcript fullScanCache.
const FEEDBACK_SCAN_CACHE_TTL_MS = 900_000;
// Hard wall-clock cap on a single scan attempt. On bad VPN the SDK can stall
// indefinitely — this breaks the inFlight promise so background retries don't queue.
const FEEDBACK_SCAN_TIMEOUT_MS = 90_000;
interface FeedbackScanCache {
  rows: Record<string, unknown>[];
  expiresAt: number;
  // true once at least one scan has succeeded — used to distinguish stale vs cold cache
  hasData: boolean;
  inFlight: Promise<Record<string, unknown>[]> | null;
}
const feedbackScanCache: FeedbackScanCache = { rows: [], expiresAt: 0, hasData: false, inFlight: null };
// Separate cache for the enriched table (rebuilt after each upload).
const enrichedScanCache: FeedbackScanCache = { rows: [], expiresAt: 0, hasData: false, inFlight: null };

function invalidateFeedbackScanCache(): void {
  feedbackScanCache.expiresAt = 0;
  enrichedScanCache.expiresAt = 0;
  enrichedScanCache.hasData = false;
}

async function getTableKeyNames(tableName: string): Promise<string[]> {
  const res = await getClient().send(new DescribeTableCommand({ TableName: tableName }));
  return (res.Table?.KeySchema ?? []).map((k) => k.AttributeName!);
}

async function scanSegment(tableName: string, segment: number, totalSegments: number): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await getClient().send(
      new ScanCommand({ TableName: tableName, Segment: segment, TotalSegments: totalSegments, ExclusiveStartKey: start })
    );
    for (const item of page.Items ?? []) rows.push(item as Record<string, unknown>);
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);
  return rows;
}

async function scanAll(tableName: string, parallelSegments = 1): Promise<Record<string, unknown>[]> {
  if (parallelSegments <= 1) return scanSegment(tableName, 0, 1);
  const results = await Promise.all(
    Array.from({ length: parallelSegments }, (_, i) => scanSegment(tableName, i, parallelSegments))
  );
  return results.flat();
}

async function countEnvInRange(tableName: string, env: string, startDate: string): Promise<number> {
  let total = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await getClient().send(new ScanCommand({
      TableName: tableName,
      Select: 'COUNT',
      FilterExpression: '#e = :e AND feedback_utc_ts >= :sd',
      ExpressionAttributeNames: { '#e': 'env' },
      ExpressionAttributeValues: { ':e': env, ':sd': startDate },
      ExclusiveStartKey: cursor,
    }));
    total += page.Count ?? 0;
    cursor = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);
  return total;
}

// ── Positional param index maps ───────────────────────────────────
// Must match rowParamsAthena() and rowParamsS3() in feedback-ingest.ts.

const ATHENA_FIELDS = [
  'feedback_id', 'env', 'app_id', 'customer_id', 'feedback_utc_ts', 'rating',
  'feedback_text', 'consent_flag', 'plan_type_name', 'subscription_id',
  'subscription_status', 'total_credit_cnt', 'available_credit_cnt',
  'feedback_topic_list', 'feedback_origin_name', 'app_publish_flag',
  'publish_url', 'cln_create_utc_ts',
] as const;

const S3_FIELDS = [
  'feedback_id', 'env', 'app_id', 'customer_id', 'feedback_utc_ts', 'rating',
  'feedback_text', 'consent_flag', 'plan_type_name', 'subscription_id',
  'subscription_status', 'total_credit_cnt', 'available_credit_cnt',
  'feedback_topic_list', 'feedback_origin_name', 'feedback_category',
  'app_publish_flag', 'full_story_url', 'shopper_id', 'experiments_line',
  'publish_url', 'cln_create_utc_ts', 's3_url', 'device_type', 'browser_type',
  'page_url', 'session_id', 'app_name', 'app_version',
] as const;

function paramsToItem(
  params: unknown[],
  fields: readonly string[],
  dataSource: string
): Record<string, unknown> {
  const item: Record<string, unknown> = { data_source: dataSource };
  for (let i = 0; i < fields.length; i++) {
    const val = params[i];
    if (val !== null && val !== undefined && val !== '') {
      item[fields[i]] = val;
    }
  }
  // `created_at` is the DynamoDB sort key — required on every write.
  const ts = item['feedback_utc_ts'];
  item['created_at'] = (typeof ts === 'string' && ts.length > 0) ? ts : new Date().toISOString();
  return item;
}

// Guarantees the DynamoDB sort key `created_at` is present on every row written
// to the raw-s3 / raw-athena / enriched tables (all keyed by <partition> +
// created_at). Direct ingest writes already set it via paramsToItem; legacy
// feedback rows migrated into the raw tables may lack it, so derive it from
// feedback_utc_ts when available, else stamp the current time.
function ensureCreatedAt(item: Record<string, unknown>): Record<string, unknown> {
  const existing: unknown = item['created_at'];
  if (typeof existing === 'string' && existing.length > 0) return item;
  const ts: unknown = item['feedback_utc_ts'];
  return {
    ...item,
    created_at: typeof ts === 'string' && ts.length > 0 ? ts : new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Accepts ISO "YYYY-MM-DDT..." and Athena " YYYY-MM-DD ..." but rejects phone numbers, free text, etc.
const DATE_PREFIX_RE = /^20\d{2}[-\s]/;

function dateSlice(ts: unknown): string | null {
  const s = str(ts);
  if (!s || !DATE_PREFIX_RE.test(s)) return null;
  return s.slice(0, 10);
}

function monthSlice(ts: unknown): string | null {
  const s = str(ts);
  if (!s || !DATE_PREFIX_RE.test(s)) return null;
  return s.slice(0, 7);
}

function isoWeek(ts: unknown): string | null {
  const s = str(ts);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const jan1 = new Date(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function parseTopics(val: unknown): string[] {
  if (!val) return [];
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
  } catch { /* skip */ }
  return [];
}

// ── FeedbackStore ─────────────────────────────────────────────────

export class FeedbackStore {
  private feedbackTable(): string { return getConfig().feedbackTable; }
  private rawS3Table(): string { return getConfig().feedbackRawS3Table; }
  private rawAthenaTable(): string { return getConfig().feedbackRawAthenaTable; }
  private enrichedTable(): string { return getConfig().feedbackEnrichedTable; }
  private statsTable(): string { return getConfig().feedbackStatsTable; }
  private ingestTable(): string { return getConfig().feedbackIngestTable; }

  // ── Batch write/delete helpers ────────────────────────────────────

  // A single DynamoDB BatchWriteItem write request (Put or Delete).
  // Shared shape for both _batchWrite (PutRequest) and _batchDeleteByKey (DeleteRequest).

  // Sends WriteRequests in chunks of 25 (the BatchWriteItem cap) and retries any
  // UnprocessedItems with exponential backoff. DynamoDB returns UnprocessedItems
  // (rather than failing) when a batch is throttled or exceeds capacity; dropping
  // them silently loses writes/deletes, so we re-submit only the leftovers and
  // throw if any remain after MAX_BATCH_ATTEMPTS so the caller surfaces the failure.
  private async _sendBatch(tableName: string, requests: BatchWriteRequest[]): Promise<void> {
    const MAX_BATCH_ATTEMPTS = 5;
    for (let i = 0; i < requests.length; i += 25) {
      let pending: BatchWriteRequest[] = requests.slice(i, i + 25);
      for (let attempt = 0; pending.length > 0 && attempt < MAX_BATCH_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          const backoffMs: number = 50 * 2 ** (attempt - 1);
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
        const res = await getClient().send(
          new BatchWriteCommand({ RequestItems: { [tableName]: pending } })
        );
        pending = (res.UnprocessedItems?.[tableName] ?? []) as BatchWriteRequest[];
      }
      if (pending.length > 0) {
        throw new Error(
          `BatchWrite to ${tableName} left ${pending.length} unprocessed items after ${MAX_BATCH_ATTEMPTS} attempts`
        );
      }
    }
  }

  // Only ever targets the raw-s3 / raw-athena / enriched tables, all of which use
  // created_at as their sort key — ensureCreatedAt() guarantees it is set so the
  // PutRequest is never rejected for a missing key attribute.
  private async _batchWrite(tableName: string, items: Record<string, unknown>[]): Promise<void> {
    const requests: BatchWriteRequest[] = items.map((item) => ({
      PutRequest: { Item: ensureCreatedAt(item) },
    }));
    await this._sendBatch(tableName, requests);
  }

  private async _batchDeleteByKey(
    tableName: string,
    keyField: string,
    items: Record<string, unknown>[]
  ): Promise<void> {
    const requests: BatchWriteRequest[] = items.map((item) => {
      // The raw-s3 / raw-athena / enriched tables use created_at as their sort
      // key, so the delete Key must carry both the partition key and created_at —
      // otherwise DynamoDB rejects it with a ValidationException. Items always
      // originate from a full-table scan, so created_at is present.
      const key: Record<string, unknown> = { [keyField]: item[keyField] };
      if (item['created_at'] !== undefined) key['created_at'] = item['created_at'];
      return { DeleteRequest: { Key: key } };
    });
    await this._sendBatch(tableName, requests);
  }

  // ── Enriched table scan (with stale-while-revalidate cache) ──────

  private _startEnrichedScan(): Promise<Record<string, unknown>[]> {
    if (enrichedScanCache.inFlight) return enrichedScanCache.inFlight;

    spLog(SP_MASK.INFO, 'feedback-store', `Enriched scan start — ${this.enrichedTable()}`);

    const scanPromise: Promise<Record<string, unknown>[]> = scanAll(this.enrichedTable(), 4)
      .then((rows) => {
        enrichedScanCache.rows = rows;
        enrichedScanCache.expiresAt = Date.now() + FEEDBACK_SCAN_CACHE_TTL_MS;
        enrichedScanCache.hasData = true;
        enrichedScanCache.inFlight = null;
        spLog(SP_MASK.INFO, 'feedback-store', `Enriched scan complete — ${rows.length} rows`);
        return rows;
      })
      .catch((err: unknown) => {
        enrichedScanCache.inFlight = null;
        spLog(SP_MASK.ERROR, 'feedback-store', `Enriched scan error: ${(err as Error).message}`);
        throw err;
      });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        enrichedScanCache.inFlight = null;
        reject(new Error(`Enriched scan timed out after ${FEEDBACK_SCAN_TIMEOUT_MS / 1000}s`));
      }, FEEDBACK_SCAN_TIMEOUT_MS)
    );

    enrichedScanCache.inFlight = Promise.race([scanPromise, timeoutPromise]);
    return enrichedScanCache.inFlight;
  }

  async scanEnriched(env?: string): Promise<Record<string, unknown>[]> {
    let all: Record<string, unknown>[];

    if (Date.now() < enrichedScanCache.expiresAt) {
      all = enrichedScanCache.rows;
    } else if (enrichedScanCache.hasData) {
      void this._startEnrichedScan();
      all = enrichedScanCache.rows;
    } else if (enrichedScanCache.inFlight) {
      all = await enrichedScanCache.inFlight;
    } else {
      // Enriched table is the single source of truth — never fall back to the legacy
      // table for counts or statistics. If the enriched table hasn't been built yet
      // (tables just provisioned), return empty so the UI shows "Rebuild needed"
      // rather than serving stale/mixed counts from the legacy table.
      try {
        all = await this._startEnrichedScan();
      } catch {
        spLog(SP_MASK.WARN, 'feedback-store', 'Enriched table unavailable — returning empty (rebuild needed)');
        all = [];
      }
    }

    return env ? all.filter((i) => i['env'] === env) : all;
  }

  // ── Enriched table rebuild ────────────────────────────────────────
  // Dedup key: {env}#{customer_id}#{date} — one enriched record per customer per day.
  // S3 wins: existing S3 field values are never overwritten by Athena values.
  // Auto-migration: on first call, if raw tables are empty, migrates existing
  // legacy feedback table rows into the appropriate raw tables first.

  async rebuildEnrichedTable(env: string): Promise<number> {
    spLog(SP_MASK.INFO, 'feedback-store', `rebuildEnrichedTable start — env=${env}`);

    // The rebuild is destructive: it deletes every enriched row for this env and
    // rewrites them from the raw scans below. Swallowing a scan failure into an
    // empty array (the old `.catch(() => [])`) would rebuild from a partial set —
    // silently dropping the unread source's rows, or emptying the enriched table
    // outright if both scans failed. Use allSettled so a rejection of one scan does
    // not leave the other's promise unhandled, then abort BEFORE any delete if
    // either raw scan failed, so the caller surfaces the failure instead of losing data.
    const [s3Settled, athenaSettled] = await Promise.allSettled([
      scanAll(this.rawS3Table()),
      scanAll(this.rawAthenaTable()),
    ]);
    const scanFailures: string[] = [];
    if (s3Settled.status === 'rejected') {
      scanFailures.push(`${this.rawS3Table()}: ${(s3Settled.reason as Error).message}`);
    }
    if (athenaSettled.status === 'rejected') {
      scanFailures.push(`${this.rawAthenaTable()}: ${(athenaSettled.reason as Error).message}`);
    }
    if (scanFailures.length > 0) {
      const msg = `rebuildEnrichedTable aborted (env=${env}): raw-table scan failed — ${scanFailures.join('; ')}. Refusing to rebuild from a partial set, which would delete existing enriched rows.`;
      spLog(SP_MASK.ERROR, 'feedback-store', msg);
      throw new Error(msg);
    }
    // Both are fulfilled here — the throw above covers every rejected case; the
    // empty fallbacks are unreachable and exist only to narrow the settled union.
    const rawS3All: Record<string, unknown>[] = s3Settled.status === 'fulfilled' ? s3Settled.value : [];
    const rawAthenaAll: Record<string, unknown>[] = athenaSettled.status === 'fulfilled' ? athenaSettled.value : [];

    let s3Items = rawS3All.filter((i) => str(i['env']) === env);
    let athenaItems = rawAthenaAll.filter((i) => str(i['env']) === env);

    // Auto-migrate each raw table independently from the legacy feedback table.
    // raw-s3 may be empty even when raw-athena already has rows from a prior upload,
    // so the two sources are checked separately.
    if (s3Items.length === 0 || athenaItems.length === 0) {
      const legacy = await this.scanFeedback(env);

      if (s3Items.length === 0) {
        const legacyS3 = legacy.filter((i) => {
          const src = str(i['data_source']);
          return src === 's3' || src === 'both';
        });
        if (legacyS3.length > 0) {
          spLog(SP_MASK.INFO, 'feedback-store', `Migrating ${legacyS3.length} S3 rows from legacy → raw-s3`);
          await this._batchWrite(this.rawS3Table(), legacyS3.map((i) => ({ ...i, data_source: 's3' })));
          s3Items = legacyS3;
        }
      }

      if (athenaItems.length === 0) {
        const legacyAthena = legacy.filter((i) => {
          const src = str(i['data_source']);
          return src === 'athena' || src === 'both';
        });
        if (legacyAthena.length > 0) {
          spLog(SP_MASK.INFO, 'feedback-store', `Migrating ${legacyAthena.length} Athena rows from legacy → raw-athena`);
          await this._batchWrite(this.rawAthenaTable(), legacyAthena.map((i) => ({ ...i, data_source: 'athena' })));
          athenaItems = legacyAthena;
        }
      }
    }

    // Drop rows before the configured enriched-data start date (default 2026-04-01).
    // These rows stay in the raw tables but are never promoted to the enriched table.
    const { feedbackStartDate } = getConfig();
    const inWindow = (item: Record<string, unknown>): boolean => {
      const d = dateSlice(item['feedback_utc_ts']) ?? dateSlice(item['created_at']);
      return d !== null && d >= feedbackStartDate;
    };
    const s3Eligible = s3Items.filter(inWindow);
    const athenaEligible = athenaItems.filter(inWindow);
    spLog(SP_MASK.INFO, 'feedback-store',
      `rebuildEnrichedTable window=${feedbackStartDate}→today — s3=${s3Items.length}→${s3Eligible.length} athena=${athenaItems.length}→${athenaEligible.length}`);

    // Build dedup map: key = env#customer_id#date
    const enrichedMap = new Map<string, Record<string, unknown>>();

    for (const item of s3Eligible) {
      const custId = str(item['customer_id']) ?? 'unknown';
      const date = dateSlice(item['feedback_utc_ts']) ?? dateSlice(item['created_at']) ?? 'unknown';
      const key = `${env}#${custId}#${date}`;
      enrichedMap.set(key, { ...item, enrich_key: key, data_source: 's3' });
    }

    for (const item of athenaEligible) {
      const custId = str(item['customer_id']) ?? 'unknown';
      const date = dateSlice(item['feedback_utc_ts']) ?? dateSlice(item['created_at']) ?? 'unknown';
      const key = `${env}#${custId}#${date}`;
      const existing = enrichedMap.get(key);
      if (existing) {
        // S3 wins: start from Athena, then overwrite with all non-null S3 fields
        const merged: Record<string, unknown> = { ...item };
        for (const [k, v] of Object.entries(existing)) {
          if (v !== null && v !== undefined && v !== '') merged[k] = v;
        }
        merged['enrich_key'] = key;
        merged['data_source'] = 'both';
        enrichedMap.set(key, merged);
      } else {
        enrichedMap.set(key, { ...item, enrich_key: key, data_source: 'athena' });
      }
    }

    // Delete existing enriched rows for this env, then write new ones. A transient
    // failure scanning the enriched table must abort too: swallowing it into an empty
    // array would skip the cleanup delete and leave stale rows mixed with the rewrite.
    // Abort here (before the delete) so the table is left untouched on failure.
    let existingEnriched: Record<string, unknown>[];
    try {
      existingEnriched = await scanAll(this.enrichedTable());
    } catch (err) {
      const msg = `rebuildEnrichedTable aborted (env=${env}): scan of enriched table ${this.enrichedTable()} failed — ${(err as Error).message}. Not deleting or rewriting enriched rows.`;
      spLog(SP_MASK.ERROR, 'feedback-store', msg);
      throw new Error(msg);
    }
    const toDelete = existingEnriched.filter((i) => str(i['env']) === env);
    if (toDelete.length > 0) {
      await this._batchDeleteByKey(this.enrichedTable(), 'enrich_key', toDelete);
    }

    const newItems = [...enrichedMap.values()];
    if (newItems.length > 0) {
      await this._batchWrite(this.enrichedTable(), newItems);
    }

    enrichedScanCache.expiresAt = 0;
    enrichedScanCache.hasData = false;
    spLog(SP_MASK.INFO, 'feedback-store', `rebuildEnrichedTable done — ${newItems.length} enriched rows`);
    return newItems.length;
  }

  // Starts a full-table scan and stores it in feedbackScanCache.inFlight.
  // Returns the inFlight promise so callers can optionally await it.
  // Safe to call multiple times — no-ops if a scan is already running.
  private _startScan(): Promise<Record<string, unknown>[]> {
    if (feedbackScanCache.inFlight) return feedbackScanCache.inFlight;

    spLog(SP_MASK.INFO, 'feedback-store', `Full table scan start — ${this.feedbackTable()}`);

    const scanPromise: Promise<Record<string, unknown>[]> = scanAll(this.feedbackTable(), 4)
      .then((rows) => {
        feedbackScanCache.rows = rows;
        feedbackScanCache.expiresAt = Date.now() + FEEDBACK_SCAN_CACHE_TTL_MS;
        feedbackScanCache.hasData = true;
        feedbackScanCache.inFlight = null;
        spLog(SP_MASK.INFO, 'feedback-store', `Scan complete — ${rows.length} rows cached for ${FEEDBACK_SCAN_CACHE_TTL_MS / 60_000}m`);
        return rows;
      })
      .catch((err: unknown) => {
        feedbackScanCache.inFlight = null;
        spLog(SP_MASK.ERROR, 'feedback-store', `Scan error: ${(err as Error).message}`);
        throw err;
      });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        feedbackScanCache.inFlight = null;
        const msg = `Feedback scan timed out after ${FEEDBACK_SCAN_TIMEOUT_MS / 1000}s — DynamoDB slow over VPN`;
        spLog(SP_MASK.WARN, 'feedback-store', msg);
        reject(new Error(msg));
      }, FEEDBACK_SCAN_TIMEOUT_MS)
    );

    feedbackScanCache.inFlight = Promise.race([scanPromise, timeoutPromise]);
    return feedbackScanCache.inFlight;
  }

  async scanFeedback(env?: string): Promise<Record<string, unknown>[]> {
    let all: Record<string, unknown>[];

    if (Date.now() < feedbackScanCache.expiresAt) {
      // Fresh cache hit — instant
      spLog(SP_MASK.DEBUG, 'feedback-store', `Cache hit — ${feedbackScanCache.rows.length} rows`);
      all = feedbackScanCache.rows;
    } else if (feedbackScanCache.hasData) {
      // Stale-while-revalidate: return old rows immediately, refresh in background.
      // Prevents the timeout retry-storm: a timed-out background scan doesn't block
      // the next caller — they get stale data and another background scan is queued.
      spLog(SP_MASK.DEBUG, 'feedback-store', `Stale cache (${feedbackScanCache.rows.length} rows) — serving stale, refreshing in background`);
      void this._startScan(); // fire-and-forget; updates cache when complete
      all = feedbackScanCache.rows;
    } else if (feedbackScanCache.inFlight) {
      // Cold cache (first load) — another request already started the scan, join it
      spLog(SP_MASK.DEBUG, 'feedback-store', 'Cold cache — joining in-flight scan');
      all = await feedbackScanCache.inFlight;
    } else {
      // Cold cache, no scan running — start one and wait (first request after restart)
      all = await this._startScan();
    }

    return env ? all.filter((i) => i['env'] === env) : all;
  }

  // Fast GSI query: uses env-ts-index (PK=env, SK=feedback_utc_ts) to avoid a
  // full scan for date-bounded browse requests. Returns null if the GSI doesn't
  // exist yet (caller falls back to scanFeedback).
  private async queryByGsi(
    env: string,
    fromDate?: string
  ): Promise<Record<string, unknown>[] | null> {
    try {
      const rows: Record<string, unknown>[] = [];
      let lastKey: Record<string, unknown> | undefined;
      const keyCondition: string = fromDate
        ? '#env = :env AND #ts >= :cutoff'
        : '#env = :env';
      const values: Record<string, unknown> = { ':env': env };
      if (fromDate) values[':cutoff'] = fromDate;
      do {
        const page = await getClient().send(
          new QueryCommand({
            TableName: this.feedbackTable(),
            IndexName: 'env-ts-index',
            KeyConditionExpression: keyCondition,
            ExpressionAttributeNames: { '#env': 'env', '#ts': 'feedback_utc_ts' },
            ExpressionAttributeValues: values,
            ExclusiveStartKey: lastKey,
          })
        );
        for (const item of page.Items ?? []) rows.push(item as Record<string, unknown>);
        lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      return rows;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // GSI not yet provisioned — fall through to scan
      if (msg.includes('index') || msg.includes('ValidationException')) return null;
      throw err;
    }
  }

  // ── Ingest writes ────────────────────────────────────────────────

  // Athena CSV rows go to the raw-athena table. The enriched table is rebuilt
  // separately by rebuildEnrichedTable() after the full upload completes.
  // merge param is kept for API compat but no longer affects anything here.
  async insertFeedbackAthenaRow(params: unknown[], _merge = false): Promise<number> {
    const item = paramsToItem(params, ATHENA_FIELDS, 'athena');
    if (!item['feedback_id']) return 0;
    await getClient().send(
      new PutCommand({ TableName: this.rawAthenaTable(), Item: item })
    );
    return 1;
  }

  // S3 rows go to the raw-s3 table.
  async insertFeedbackS3Row(params: unknown[]): Promise<number> {
    const item = paramsToItem(params, S3_FIELDS, 's3');
    if (!item['feedback_id']) return 0;
    await getClient().send(
      new PutCommand({ TableName: this.rawS3Table(), Item: item })
    );
    return 1;
  }

  async getAlreadyIngestedKeys(): Promise<Set<string>> {
    const items = await scanAll(this.ingestTable());
    return new Set(
      items
        .filter((i) => i['success'] === true)
        .map((i) => String(i['ingest_key'] ?? ''))
        .filter(Boolean)
    );
  }

  async logIngestionSuccess(key: string, source: string, rowsWritten: number): Promise<void> {
    const now = new Date().toISOString();
    await getClient().send(
      new PutCommand({
        TableName: this.ingestTable(),
        Item: {
          ingest_key: key,
          created_at: now,
          source,
          success: true,
          rows_written: rowsWritten,
          ts: now,
        },
      })
    );
  }

  async logIngestionError(key: string, source: string, errorMsg: string): Promise<void> {
    const now = new Date().toISOString();
    await getClient().send(
      new PutCommand({
        TableName: this.ingestTable(),
        Item: {
          ingest_key: key,
          created_at: now,
          source,
          success: false,
          error_msg: errorMsg,
          ts: now,
        },
      })
    );
  }

  async clearFeedbackData(env: string): Promise<void> {
    logger.info('feedback-store.clear.start', { env });

    // Clear raw-s3, raw-athena, and enriched tables for this env
    const [s3Items, athenaItems, enrichedItems, ingestKeys] = await Promise.all([
      scanAll(this.rawS3Table()).catch(() => [] as Record<string, unknown>[]),
      scanAll(this.rawAthenaTable()).catch(() => [] as Record<string, unknown>[]),
      scanAll(this.enrichedTable()).catch(() => [] as Record<string, unknown>[]),
      getTableKeyNames(this.ingestTable()),
    ]);

    const s3ForEnv = s3Items.filter((i) => str(i['env']) === env);
    const athenaForEnv = athenaItems.filter((i) => str(i['env']) === env);
    const enrichedForEnv = enrichedItems.filter((i) => str(i['env']) === env);

    await Promise.all([
      this._batchDeleteByKey(this.rawS3Table(), 'feedback_id', s3ForEnv),
      this._batchDeleteByKey(this.rawAthenaTable(), 'feedback_id', athenaForEnv),
      this._batchDeleteByKey(this.enrichedTable(), 'enrich_key', enrichedForEnv),
    ]);

    // Clear ingest log (no env filter)
    const ingestItems = await scanAll(this.ingestTable());
    for (let i = 0; i < ingestItems.length; i += 25) {
      await getClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [this.ingestTable()]: ingestItems.slice(i, i + 25).map((item) => ({
              DeleteRequest: { Key: Object.fromEntries(ingestKeys.map((k) => [k, item[k]])) },
            })),
          },
        })
      );
    }

    invalidateFeedbackScanCache();
    logger.info('feedback-store.clear.done', {
      env,
      s3: s3ForEnv.length, athena: athenaForEnv.length, enriched: enrichedForEnv.length,
    });
  }

  // ── One-time migration: legacy → raw tables → enriched ───────────────────
  // Copies S3 and Athena rows from the legacy feedback table into their
  // respective raw tables (skips rows already present — PutCommand overwrites
  // with identical data so it is idempotent), then rebuilds the enriched table.
  // Returns row counts for each table written.

  async migrateLegacyToRawTables(env: string): Promise<{
    legacyTotal: number;
    s3Written: number;
    athenaWritten: number;
    enrichedTotal: number;
    alreadyPopulated: boolean;
  }> {
    spLog(SP_MASK.INFO, 'feedback-store', `migrateLegacyToRawTables start — env=${env}`);

    // Check if raw tables already have data — still run to pick up any gaps,
    // but flag it so the UI can show "already populated" context.
    const [existingS3, existingAthena] = await Promise.all([
      scanAll(this.rawS3Table()).catch(() => [] as Record<string, unknown>[]),
      scanAll(this.rawAthenaTable()).catch(() => [] as Record<string, unknown>[]),
    ]);
    const alreadyPopulated: boolean =
      existingS3.filter((i) => str(i['env']) === env).length > 0 ||
      existingAthena.filter((i) => str(i['env']) === env).length > 0;

    const legacy = await this.scanFeedback(env);
    spLog(SP_MASK.INFO, 'feedback-store', `Legacy scan: ${legacy.length} rows for env=${env}`);

    const s3Rows = legacy.filter((i) => {
      const src = str(i['data_source']);
      return src === 's3' || src === 'both';
    }).map((i) => ({ ...i, data_source: 's3' }));

    const athenaRows = legacy.filter((i) => {
      const src = str(i['data_source']);
      return src === 'athena' || src === 'both';
    }).map((i) => ({ ...i, data_source: 'athena' }));

    await Promise.all([
      s3Rows.length > 0
        ? this._batchWrite(this.rawS3Table(), s3Rows)
        : Promise.resolve(),
      athenaRows.length > 0
        ? this._batchWrite(this.rawAthenaTable(), athenaRows)
        : Promise.resolve(),
    ]);

    const enrichedTotal = await this.rebuildEnrichedTable(env);
    invalidateFeedbackScanCache();

    spLog(SP_MASK.INFO, 'feedback-store', `migrateLegacyToRawTables done — s3=${s3Rows.length} athena=${athenaRows.length} enriched=${enrichedTotal}`);
    return {
      legacyTotal: legacy.length,
      s3Written: s3Rows.length,
      athenaWritten: athenaRows.length,
      enrichedTotal,
      alreadyPopulated,
    };
  }

  // Rebuilds the enriched table from raw S3 + Athena tables.
  async rebuildFeedbackComposite(env: string): Promise<number> {
    return this.rebuildEnrichedTable(env);
  }

  async recomputeDailyStats(env: string, dates?: string[]): Promise<void> {
    const items = await this.scanEnriched(env);
    const filtered = dates?.length
      ? items.filter((i) => dates.includes(dateSlice(i['feedback_utc_ts']) ?? ''))
      : items;

    // Group by date + app_id
    type StatBucket = {
      total: number; ratingSum: number; ratingCount: number;
      issues: number; support: number; feedback: number; consent: number;
    };
    const buckets = new Map<string, StatBucket>();

    for (const item of filtered) {
      const d = dateSlice(item['feedback_utc_ts']);
      if (!d) continue;
      const appId = str(item['app_id']) ?? '__unknown__';
      const key = `${d}#${appId}`;
      const b = buckets.get(key) ?? {
        total: 0, ratingSum: 0, ratingCount: 0,
        issues: 0, support: 0, feedback: 0, consent: 0,
      };
      b.total++;
      const r = num(item['rating']);
      if (r !== null) { b.ratingSum += r; b.ratingCount++; }
      const cat = str(item['feedback_category']);
      if (cat === 'issue') b.issues++;
      else if (cat === 'support') b.support++;
      else if (cat === 'feedback') b.feedback++;
      if (item['consent_flag'] === 1 || item['consent_flag'] === true) b.consent++;
      buckets.set(key, b);
    }

    // Write stats items in batches
    const statsItems = [...buckets.entries()].map(([key, b]) => {
      const [d, appId] = key.split('#');
      return {
        date_env: `${d}#${env}`,
        app_id: appId,
        date: d,
        env,
        total_count: b.total,
        avg_rating: b.ratingCount ? b.ratingSum / b.ratingCount : null,
        issue_count: b.issues,
        support_count: b.support,
        feedback_count: b.feedback,
        consent_count: b.consent,
      };
    });

    const chunks = [];
    for (let i = 0; i < statsItems.length; i += 25) chunks.push(statsItems.slice(i, i + 25));
    for (const chunk of chunks) {
      await getClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [this.statsTable()]: chunk.map((item) => ({ PutRequest: { Item: item } })),
          },
        })
      );
    }
  }

  // ── Analytics queries (scan + client-side aggregation) ────────────

  async getFeedbackSummary(
    env: string,
    days?: number
  ): Promise<{
    totalFeedback: number; avgRating: number | null; issueCount: number;
    supportCount: number; feedbackCount: number; uniqueApps: number;
    positiveCount: number; negativeCount: number; neutralCount: number;
    dateRange: { from: string | null; to: string | null };
  }> {
    let items = await this.scanEnriched(env);
    if (days) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      items = items.filter((i) => (dateSlice(i['feedback_utc_ts']) ?? '') >= cutoff);
    }
    let ratingSum = 0, ratingCount = 0;
    let issues = 0, support = 0, feedback = 0;
    let positive = 0, negative = 0, neutral = 0;
    let dateFrom: string | null = null, dateTo: string | null = null;
    const appIds = new Set<string>();
    for (const item of items) {
      const appId = str(item['app_id']);
      if (appId) appIds.add(appId);
      const ts = str(item['feedback_utc_ts']);
      if (ts) {
        if (!dateFrom || ts < dateFrom) dateFrom = ts;
        if (!dateTo || ts > dateTo) dateTo = ts;
      }
      const r = num(item['rating']);
      if (r !== null) {
        ratingSum += r; ratingCount++;
        if (r >= 5) positive++;
        else if (r <= 2) negative++;
        else neutral++;
      }
      const cat = str(item['feedback_category']);
      if (cat === 'issue') issues++;
      else if (cat === 'support') support++;
      else if (cat === 'feedback') feedback++;
    }
    return {
      totalFeedback: items.length,
      avgRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
      issueCount: issues, supportCount: support, feedbackCount: feedback,
      uniqueApps: appIds.size,
      positiveCount: positive, negativeCount: negative, neutralCount: neutral,
      dateRange: { from: dateFrom, to: dateTo },
    };
  }

  async getFeedbackTrends(
    env: string,
    granularity: 'day' | 'week' | 'month' = 'day',
    days = 30
  ): Promise<Array<{
    date: string; count: number; avgRating: number | null;
    issueCount: number; supportCount: number; feedbackCount: number;
  }>> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const items = (await this.scanEnriched(env)).filter(
      (i) => (dateSlice(i['feedback_utc_ts']) ?? '') >= cutoff
    );

    const buckets = new Map<string, { count: number; ratingSum: number; ratingCount: number; issues: number; support: number; feedback: number }>();
    for (const item of items) {
      const ts = str(item['feedback_utc_ts']);
      if (!ts) continue;
      const key = granularity === 'month' ? monthSlice(ts)!
        : granularity === 'week' ? isoWeek(ts)!
        : dateSlice(ts)!;
      if (!key) continue;
      const b = buckets.get(key) ?? { count: 0, ratingSum: 0, ratingCount: 0, issues: 0, support: 0, feedback: 0 };
      b.count++;
      const r = num(item['rating']);
      if (r !== null) { b.ratingSum += r; b.ratingCount++; }
      const cat = str(item['feedback_category']);
      if (cat === 'issue') b.issues++;
      else if (cat === 'support') b.support++;
      else if (cat === 'feedback') b.feedback++;
      buckets.set(key, b);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date, count: b.count,
        avgRating: b.ratingCount ? Math.round((b.ratingSum / b.ratingCount) * 10) / 10 : null,
        issueCount: b.issues, supportCount: b.support, feedbackCount: b.feedback,
      }));
  }

  async getRatingDistribution(
    env: string,
    appId?: string
  ): Promise<Array<{ rating: number; count: number; pct: number }>> {
    let items = await this.scanEnriched(env);
    if (appId) items = items.filter((i) => i['app_id'] === appId);
    const counts = new Map<number, number>();
    for (const item of items) {
      const r = num(item['rating']);
      if (r !== null) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const count = counts.get(i + 1) ?? 0;
      return { rating: i + 1, count, pct: pct(count, total) };
    });
  }

  async getCategoryBreakdown(
    env: string
  ): Promise<Array<{ category: string; count: number; pct: number }>> {
    const items = await this.scanEnriched(env);
    const counts = new Map<string, number>();
    for (const item of items) {
      const cat = str(item['feedback_category']) ?? 'unknown';
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    return [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([category, count]) => ({ category, count, pct: pct(count, total) }));
  }

  async getTopicFrequency(
    env: string,
    topN = 20
  ): Promise<Array<{ topic: string; count: number; pct: number }>> {
    const items = await this.scanEnriched(env);
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const topic of parseTopics(item['feedback_topic_list'])) {
        const t = topic.trim();
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a).slice(0, topN);
    const total = sorted.reduce((s, [, c]) => s + c, 0);
    return sorted.map(([topic, count]) => ({ topic, count, pct: pct(count, total) }));
  }

  async getAppLeaderboard(
    env: string,
    limit = 20
  ): Promise<Array<{
    appId: string; count: number; avgRating: number | null;
    issueCount: number; issueRate: number | null;
    negativeCount: number; passiveCount: number; positiveCount: number;
  }>> {
    const items = await this.scanEnriched(env);
    const buckets = new Map<string, {
      count: number; ratingSum: number; ratingCount: number; issues: number;
      negative: number; passive: number; positive: number;
    }>();
    for (const item of items) {
      const appId = str(item['app_id']) ?? '__unknown__';
      const b = buckets.get(appId) ?? { count: 0, ratingSum: 0, ratingCount: 0, issues: 0, negative: 0, passive: 0, positive: 0 };
      b.count++;
      const r = num(item['rating']);
      if (r !== null) {
        b.ratingSum += r; b.ratingCount++;
        if (r <= 3) b.negative++;
        else if (r <= 5) b.passive++;
        else b.positive++;
      }
      if (str(item['feedback_category']) === 'issue') b.issues++;
      buckets.set(appId, b);
    }
    return [...buckets.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, limit)
      .map(([appId, b]) => ({
        appId, count: b.count,
        avgRating: b.ratingCount ? Math.round((b.ratingSum / b.ratingCount) * 10) / 10 : null,
        issueCount: b.issues,
        issueRate: pct(b.issues, b.count) || null,
        negativeCount: b.negative, passiveCount: b.passive, positiveCount: b.positive,
      }));
  }

  async getFeedbackHeatmap(
    env: string,
    type: 'hour-of-day' | 'day-of-week' = 'hour-of-day'
  ): Promise<Array<{ x: string; y: number; value: number }>> {
    const items = (await this.scanEnriched(env)).filter((i) => i['feedback_utc_ts']);
    if (type === 'hour-of-day') {
      const counts = new Map<number, number>();
      for (const item of items) {
        const h = new Date(str(item['feedback_utc_ts'])!).getUTCHours();
        if (!isNaN(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
      }
      return Array.from({ length: 24 }, (_, h) => ({
        x: `${String(h).padStart(2, '0')}:00`, y: h, value: counts.get(h) ?? 0,
      }));
    }
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = new Map<number, number>();
    for (const item of items) {
      const d = new Date(str(item['feedback_utc_ts'])!).getUTCDay();
      if (!isNaN(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return Array.from({ length: 7 }, (_, d) => ({
      x: DOW[d] ?? String(d), y: d, value: counts.get(d) ?? 0,
    }));
  }

  private async periodStats(
    env: string, from: string, to: string, label: string
  ): Promise<{ label: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null }> {
    const items = (await this.scanEnriched(env)).filter((i) => {
      const d = dateSlice(i['feedback_utc_ts']) ?? '';
      return d >= from && d <= to;
    });
    let ratingSum = 0, ratingCount = 0, issues = 0;
    for (const item of items) {
      const r = num(item['rating']);
      if (r !== null) { ratingSum += r; ratingCount++; }
      if (str(item['feedback_category']) === 'issue') issues++;
    }
    return {
      label, count: items.length,
      avgRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
      issueCount: issues,
      issueRate: pct(issues, items.length) || null,
    };
  }

  async getWoWComparison(env: string): Promise<{
    current: { label: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null };
    previous: { label: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null };
    delta: { count: number; countPct: number | null; rating: number | null; issueRate: number | null };
  }> {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const dow = today.getDay();
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - ((dow + 6) % 7));
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);

    const [current, previous] = await Promise.all([
      this.periodStats(env, fmt(thisMonday), fmt(today), `This week (${fmt(thisMonday)})`),
      this.periodStats(env, fmt(lastMonday), fmt(lastSunday), `Last week (${fmt(lastMonday)})`),
    ]);
    return {
      current, previous,
      delta: {
        count: current.count - previous.count,
        countPct: deltaPct(current.count, previous.count),
        rating: current.avgRating !== null && previous.avgRating !== null
          ? Math.round((current.avgRating - previous.avgRating) * 10) / 10 : null,
        issueRate: current.issueRate !== null && previous.issueRate !== null
          ? current.issueRate - previous.issueRate : null,
      },
    };
  }

  async getMoMComparison(env: string): Promise<{
    current: { label: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null };
    previous: { label: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null };
    delta: { count: number; countPct: number | null; rating: number | null; issueRate: number | null };
  }> {
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const fmt = (ym: string) => ({ from: `${ym}-01`, to: `${ym}-31` });
    const [current, previous] = await Promise.all([
      this.periodStats(env, fmt(curYM).from, fmt(curYM).to, `This month (${curYM})`),
      this.periodStats(env, fmt(prevYM).from, fmt(prevYM).to, `Last month (${prevYM})`),
    ]);
    return {
      current, previous,
      delta: {
        count: current.count - previous.count,
        countPct: deltaPct(current.count, previous.count),
        rating: current.avgRating !== null && previous.avgRating !== null
          ? Math.round((current.avgRating - previous.avgRating) * 10) / 10 : null,
        issueRate: current.issueRate !== null && previous.issueRate !== null
          ? current.issueRate - previous.issueRate : null,
      },
    };
  }

  async getRecentFeedback(
    env: string,
    limit = 50,
    offset = 0,
    filters?: { category?: string; rating?: number; appId?: string; days?: number },
    sort?: { col: string; dir: 'asc' | 'desc' }
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const cutoff: string | undefined = filters?.days
      ? new Date(Date.now() - filters.days * 86400000).toISOString().slice(0, 10)
      : undefined;
    let items = await this.scanEnriched(env);
    if (cutoff) {
      items = items.filter((i) => (dateSlice(i['feedback_utc_ts']) ?? '') >= cutoff);
    }
    if (filters?.category) items = items.filter((i) => i['feedback_category'] === filters.category);
    if (filters?.rating !== undefined) items = items.filter((i) => num(i['rating']) === filters.rating);
    if (filters?.appId) items = items.filter((i) => i['app_id'] === filters.appId);

    const SORTABLE = new Set([
      'feedback_utc_ts', 'rating', 'app_id', 'plan_type_name',
      'feedback_category', 'feedback_origin_name', 'device_type',
      'subscription_status', 'cln_create_utc_ts',
    ]);
    const col = sort?.col && SORTABLE.has(sort.col) ? sort.col : 'feedback_utc_ts';
    const dir = sort?.dir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const av = str(a[col]) ?? '';
      const bv = str(b[col]) ?? '';
      return av.localeCompare(bv) * dir;
    });

    return { rows: items.slice(offset, offset + limit), total: items.length };
  }

  async getFeedbackIngestionStatus(): Promise<{
    totalFiles: number; successFiles: number; errorFiles: number;
    lastSync: string | null; totalRows: number; dbPath: string;
  }> {
    const items = await scanAll(this.ingestTable());
    let success = 0, errors = 0, totalRows = 0;
    let lastSync: string | null = null;
    for (const item of items) {
      if (item['success'] === true) {
        success++;
        totalRows += num(item['rows_written']) ?? 0;
      } else {
        errors++;
      }
      const ts = str(item['ts']);
      if (ts && (!lastSync || ts > lastSync)) lastSync = ts;
    }
    return {
      totalFiles: items.length, successFiles: success, errorFiles: errors,
      lastSync, totalRows, dbPath: `dynamodb://${this.ingestTable()}`,
    };
  }

  async getDataCoverage(env: string): Promise<{
    earliest: string | null; latest: string | null; totalRows: number;
    monthsCovered: string[]; athenaRows: number; s3OnlyRows: number; bothRows: number;
    rawS3Total: number; rawAthenaTotal: number;
  }> {
    const { feedbackStartDate } = getConfig();
    const [items, rawS3Total, rawAthenaTotal] = await Promise.all([
      this.scanEnriched(env),
      countEnvInRange(this.rawS3Table(), env, feedbackStartDate).catch(() => 0),
      countEnvInRange(this.rawAthenaTable(), env, feedbackStartDate).catch(() => 0),
    ]);
    // Only report a window start when the env actually has enriched rows —
    // otherwise the UI would render a non-empty "from → to" range for an empty
    // dataset (latest is already null in that case).
    const earliest: string | null = items.length > 0 ? feedbackStartDate : null;
    let latest: string | null = null;
    let athena = 0, s3Only = 0, both = 0;
    const months = new Set<string>();
    for (const item of items) {
      const ts = str(item['feedback_utc_ts']);
      if (ts && DATE_PREFIX_RE.test(ts)) {
        if (!latest || ts > latest) latest = ts;
        const m = monthSlice(ts);
        if (m) months.add(m);
      }
      const src = str(item['data_source']);
      if (src === 'athena') athena++;
      else if (src === 's3') s3Only++;
      else if (src === 'both') both++;
    }
    return {
      earliest, latest, totalRows: items.length,
      monthsCovered: [...months].sort(),
      athenaRows: athena, s3OnlyRows: s3Only, bothRows: both,
      rawS3Total, rawAthenaTotal,
    };
  }

  async getIngestionLog(limit = 100): Promise<Array<{
    id: number; s3_url: string; source: string; status: string;
    rows_written: number; error_msg: string | null; ingested_at: string;
  }>> {
    const items = await scanAll(this.ingestTable());
    return items
      .sort((a, b) => String(b['ts'] ?? '').localeCompare(String(a['ts'] ?? '')))
      .slice(0, limit)
      .map((item, i) => ({
        id: i + 1,
        s3_url: String(item['ingest_key'] ?? ''),
        source: String(item['source'] ?? ''),
        status: item['success'] === true ? 'success' : 'error',
        rows_written: num(item['rows_written']) ?? 0,
        error_msg: str(item['error_msg']),
        ingested_at: String(item['ts'] ?? ''),
      }));
  }
}

let store: FeedbackStore | null = null;

export function getFeedbackStore(): FeedbackStore {
  if (!store) store = new FeedbackStore();
  return store;
}
