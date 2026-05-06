import {
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { parquetReadObjects } from 'hyparquet';

import { getDateRangeError, isDateRangeValid } from '@/lib/analytics/date-range';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || process.env.FEEDBACK_S3_REGION || 'us-west-2',
});

const DEFAULT_PREFIX = 'airo_builder_feedback_cln/';
const ITEMS_CACHE_TTL_MS = 120_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_MERGED_ITEMS = 2_000;

export const FEEDBACK_RANGE_DAYS_LIST = [1, 7, 14, 30] as const;
export type FeedbackRangeDays = (typeof FEEDBACK_RANGE_DAYS_LIST)[number];

export type FeedbackWindow =
  | { kind: 'rolling'; days: FeedbackRangeDays }
  | { kind: 'absolute'; startYmd: string; endYmd: string };

export function parseFeedbackRequest(sp: URLSearchParams): FeedbackWindow | { error: string } {
  const start = sp.get('start')?.trim();
  const end = sp.get('end')?.trim();
  if (start || end) {
    if (!start || !end) {
      return { error: 'Both start and end (YYYY-MM-DD) are required for a custom range' };
    }
    if (!isDateRangeValid(start, end)) {
      return { error: getDateRangeError(start, end) ?? 'Invalid date range' };
    }
    return { kind: 'absolute', startYmd: start, endYmd: end };
  }
  const daysRaw = sp.get('days');
  if (daysRaw !== null && daysRaw !== '') {
    const n = Number.parseInt(daysRaw, 10);
    if (!Number.isInteger(n) || !(FEEDBACK_RANGE_DAYS_LIST as readonly number[]).includes(n as FeedbackRangeDays)) {
      return { error: `Invalid days. Use one of: ${FEEDBACK_RANGE_DAYS_LIST.join(', ')}` };
    }
    return { kind: 'rolling', days: n as FeedbackRangeDays };
  }
  return { kind: 'rolling', days: 1 };
}

export function feedbackWindowCacheKey(window: FeedbackWindow): string {
  if (window.kind === 'rolling') {
    return `rolling:${window.days}`;
  }
  return `abs:${window.startYmd}:${window.endYmd}`;
}

function inclusiveUtcDayCount(startYmd: string, endYmd: string): number {
  const startMs = new Date(`${startYmd}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${endYmd}T00:00:00.000Z`).getTime();
  return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
}

function enumerateUtcDaysInclusive(startYmd: string, endYmd: string): Date[] {
  const out: Date[] = [];
  const cur = new Date(`${startYmd}T00:00:00.000Z`);
  const end = new Date(`${endYmd}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function feedbackWindowSpanDays(window: FeedbackWindow): number {
  if (window.kind === 'rolling') {
    return window.days;
  }
  return inclusiveUtcDayCount(window.startYmd, window.endYmd);
}

function itemTimestampInWindow(ts: Date | null, window: FeedbackWindow): boolean {
  if (!ts) return false;
  if (window.kind === 'rolling') {
    const cutoff = Date.now() - window.days * MS_PER_DAY;
    return ts.getTime() >= cutoff;
  }
  const startMs = new Date(`${window.startYmd}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${window.endYmd}T23:59:59.999Z`).getTime();
  return ts.getTime() >= startMs && ts.getTime() <= endMs;
}

export function filterFeedbackItemsForWindow(items: FeedbackItem[], window: FeedbackWindow): FeedbackItem[] {
  return items.filter((item) =>
    itemTimestampInWindow(parseFeedbackUtc(String(item.feedback_utc_ts ?? '')), window),
  );
}

export interface FeedbackItem {
  feedback_text?: string;
  rating?: number;
  feedback_utc_ts?: string;
  [key: string]: unknown;
}

let itemsCache: {
  at: number;
  key: string;
  items: FeedbackItem[];
  merged_truncated: boolean;
  partition_errors: number;
} | null = null;

export function getFeedbackS3Bucket(): string | null {
  const b = process.env.FEEDBACK_S3_BUCKET?.trim();
  return b || null;
}

function hivePrefixForUtcDate(d: Date): string {
  const base = (process.env.FEEDBACK_S3_PREFIX?.trim() || DEFAULT_PREFIX).replace(/\/?$/, '/');
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${base}year=${y}/month=${m}/day=${day}/`;
}

function classifySentiment(rating: number): 'positive' | 'neutral' | 'negative' {
  if (rating >= 6) return 'positive';
  if (rating >= 4) return 'neutral';
  return 'negative';
}

function normalizeTimestampField(val: unknown): string | undefined {
  if (val instanceof Date) return val.toISOString();
  // hyparquet returns TIMESTAMP(MICROS) as BigInt microseconds since epoch
  if (typeof val === 'bigint') return new Date(Number(val / 1000n)).toISOString();
  if (typeof val === 'number') return new Date(val).toISOString();
  if (typeof val === 'string') return val;
  return undefined;
}

function parseFeedbackRecord(data: unknown): FeedbackItem | null {
  if (typeof data !== 'object' || data === null) return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec['feedback_text'] !== 'string' || !('rating' in rec)) return null;
  const rating = typeof rec['rating'] === 'number' ? rec['rating'] : Number(rec['rating']);
  if (!Number.isFinite(rating)) return null;
  return {
    ...rec,
    rating,
    feedback_utc_ts: normalizeTimestampField(rec['feedback_utc_ts']),
  } as FeedbackItem;
}

function tryParseFeedbackLine(line: string): { item: FeedbackItem | null; jsonError: boolean } {
  const t = line.trim();
  if (!t) return { item: null, jsonError: false };
  try {
    const item = parseFeedbackRecord(JSON.parse(t) as unknown);
    return item ? { item, jsonError: false } : { item: null, jsonError: false };
  } catch {
    return { item: null, jsonError: true };
  }
}

function extractFeedbackItemsFromObjectText(content: string): { items: FeedbackItem[]; malformedLineCount: number } {
  const trimmed = content.trim();
  if (!trimmed) return { items: [], malformedLineCount: 0 };

  const lineItems: FeedbackItem[] = [];
  let malformedLineCount = 0;
  for (const line of trimmed.split('\n')) {
    const { item, jsonError } = tryParseFeedbackLine(line);
    if (jsonError) malformedLineCount += 1;
    if (item) lineItems.push(item);
  }
  if (lineItems.length > 0) {
    return { items: lineItems, malformedLineCount };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const items: FeedbackItem[] = [];
      for (const el of parsed) {
        const item = parseFeedbackRecord(el);
        if (item) items.push(item);
      }
      return { items, malformedLineCount: items.length === 0 ? malformedLineCount + 1 : malformedLineCount };
    }
    const single = parseFeedbackRecord(parsed);
    if (single) return { items: [single], malformedLineCount };
  } catch {
    malformedLineCount += 1;
  }
  return { items: [], malformedLineCount };
}

function isLikelyFeedbackDataObjectKey(key: string): boolean {
  if (!key || key.endsWith('/')) return false;
  const lower = key.toLowerCase();
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.jsonl') ||
    lower.endsWith('.ndjson') ||
    lower.endsWith('.parquet') ||
    key.includes('hour=')
  ) {
    return true;
  }
  return false;
}

async function listAllKeys(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const out: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const obj of out.Contents ?? []) {
      const key = obj.Key;
      if (!key) continue;
      if (isLikelyFeedbackDataObjectKey(key)) {
        keys.push(key);
      }
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function getObjectText(bucket: string, key: string): Promise<string | null> {
  try {
    const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body;
    if (!body) return null;
    return await body.transformToString();
  } catch (err) {
    console.error('feedback-s3: getObjectText failed', { bucket, key }, err);
    return null;
  }
}

async function getObjectItems(
  bucket: string,
  key: string,
): Promise<{ items: FeedbackItem[]; malformedLineCount: number }> {
  if (key.toLowerCase().endsWith('.parquet')) {
    try {
      const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) return { items: [], malformedLineCount: 0 };
      const bytes = await out.Body.transformToByteArray();
      const asyncBuf = {
        byteLength: bytes.byteLength,
        slice: (start: number, end?: number) =>
          Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset + start,
              bytes.byteOffset + (end ?? bytes.byteLength),
            ) as ArrayBuffer,
          ),
      };
      const rows = (await parquetReadObjects({ file: asyncBuf })) as unknown[];
      const items: FeedbackItem[] = [];
      for (const row of rows) {
        const item = parseFeedbackRecord(row);
        if (item) items.push(item);
      }
      return { items, malformedLineCount: 0 };
    } catch (err) {
      console.error('feedback-s3: parquet parse failed', { bucket, key }, err);
      return { items: [], malformedLineCount: 1 };
    }
  }
  const content = await getObjectText(bucket, key);
  if (!content?.trim()) return { items: [], malformedLineCount: 0 };
  return extractFeedbackItemsFromObjectText(content);
}

async function fetchFeedbackFromS3Rolling(
  dayCount: FeedbackRangeDays,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const bucket = getFeedbackS3Bucket();
  if (!bucket) return { items: [], merged_truncated: false, partition_errors: 0 };

  const now = Date.now();
  const feedbackItems: FeedbackItem[] = [];
  let partition_errors = 0;
  const partitionDays = dayCount + 1;

  for (let i = 0; i < partitionDays; i += 1) {
    const date = new Date(now - i * MS_PER_DAY);
    const prefix = hivePrefixForUtcDate(date);
    let keys: string[] = [];
    try {
      keys = await listAllKeys(bucket, prefix);
    } catch (err) {
      partition_errors += 1;
      console.error('feedback-s3: listAllKeys failed', { bucket, prefix }, err);
      continue;
    }

    let malformedLinesInPartition = 0;
    for (const key of keys) {
      const { items: fromKey, malformedLineCount } = await getObjectItems(bucket, key);
      malformedLinesInPartition += malformedLineCount;
      for (const item of fromKey) {
        feedbackItems.push(item);
      }
    }
    if (malformedLinesInPartition > 0) {
      console.warn('feedback-s3: skipped malformed lines', { bucket, prefix, count: malformedLinesInPartition });
    }
  }

  feedbackItems.sort((a, b) => String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')));
  const merged_truncated = feedbackItems.length > MAX_MERGED_ITEMS;
  return {
    items: feedbackItems.slice(0, MAX_MERGED_ITEMS),
    merged_truncated,
    partition_errors,
  };
}

async function fetchFeedbackFromS3Absolute(
  startYmd: string,
  endYmd: string,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const bucket = getFeedbackS3Bucket();
  if (!bucket) return { items: [], merged_truncated: false, partition_errors: 0 };

  const feedbackItems: FeedbackItem[] = [];
  let partition_errors = 0;
  for (const date of enumerateUtcDaysInclusive(startYmd, endYmd)) {
    const prefix = hivePrefixForUtcDate(date);
    let keys: string[] = [];
    try {
      keys = await listAllKeys(bucket, prefix);
    } catch (err) {
      partition_errors += 1;
      console.error('feedback-s3: listAllKeys failed', { bucket, prefix }, err);
      continue;
    }

    let malformedLinesInPartition = 0;
    for (const key of keys) {
      const { items: fromKey, malformedLineCount } = await getObjectItems(bucket, key);
      malformedLinesInPartition += malformedLineCount;
      for (const item of fromKey) {
        feedbackItems.push(item);
      }
    }
    if (malformedLinesInPartition > 0) {
      console.warn('feedback-s3: skipped malformed lines', { bucket, prefix, count: malformedLinesInPartition });
    }
  }

  feedbackItems.sort((a, b) => String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')));
  const merged_truncated = feedbackItems.length > MAX_MERGED_ITEMS;
  return {
    items: feedbackItems.slice(0, MAX_MERGED_ITEMS),
    merged_truncated,
    partition_errors,
  };
}

export async function getFeedbackItemsCached(
  window: FeedbackWindow,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const key = feedbackWindowCacheKey(window);
  const now = Date.now();
  if (itemsCache && itemsCache.key === key && now - itemsCache.at < ITEMS_CACHE_TTL_MS) {
    return {
      items: itemsCache.items,
      merged_truncated: itemsCache.merged_truncated,
      partition_errors: itemsCache.partition_errors,
    };
  }
  const merged =
    window.kind === 'rolling'
      ? await fetchFeedbackFromS3Rolling(window.days)
      : await fetchFeedbackFromS3Absolute(window.startYmd, window.endYmd);
  if (merged.partition_errors === 0) {
    itemsCache = {
      at: now,
      key,
      items: merged.items,
      merged_truncated: merged.merged_truncated,
      partition_errors: 0,
    };
  }
  return {
    items: merged.items,
    merged_truncated: merged.merged_truncated,
    partition_errors: merged.partition_errors,
  };
}

export function parseFeedbackUtc(tsStr: string): Date | null {
  if (!tsStr) return null;
  try {
    const normalized = tsStr.trim().replace(' ', 'T');
    const hasExplicitTz = /[Zz]|[+-]\d\d:?\d\d$/.test(normalized);
    const forParse = hasExplicitTz ? normalized : `${normalized}Z`;
    const d = new Date(forParse);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function buildFeedbackSummary(
  items: FeedbackItem[],
  window: FeedbackWindow,
  mergedTruncated: boolean,
) {
  if (!items.length) {
    return {
      error: 'No feedback data available' as const,
      positive: 0,
      neutral: 0,
      negative: 0,
      total: 0,
      merged_truncated: mergedTruncated,
      rangeDays: window.kind === 'rolling' ? window.days : undefined,
      absoluteRange: window.kind === 'absolute' ? { start: window.startYmd, end: window.endYmd } : undefined,
    };
  }

  const inWindow = filterFeedbackItemsForWindow(items, window);

  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const item of inWindow) {
    const r = Number(item.rating) || 0;
    const s = classifySentiment(r);
    if (s === 'positive') positive += 1;
    else if (s === 'neutral') neutral += 1;
    else negative += 1;
  }

  return {
    positive,
    neutral,
    negative,
    total: inWindow.length,
    merged_truncated: mergedTruncated,
    rangeDays: window.kind === 'rolling' ? window.days : undefined,
    absoluteRange: window.kind === 'absolute' ? { start: window.startYmd, end: window.endYmd } : undefined,
  };
}

export interface FeedbackRecentRow {
  time: string;
  channel: string;
  sentiment: string;
  summary: string;
  rating: number;
}

export function buildFeedbackRecent(
  items: FeedbackItem[],
  window: FeedbackWindow,
  mergedTruncated: boolean,
): { error?: string; items: FeedbackRecentRow[]; merged_truncated?: boolean } {
  if (!items.length) {
    return { error: 'No feedback data available', items: [], merged_truncated: mergedTruncated };
  }

  const spanDays = feedbackWindowSpanDays(window);
  const recentLimit = spanDays >= 7 ? 12 : 8;
  const sorted = filterFeedbackItemsForWindow(items, window).sort((a, b) =>
    String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')),
  );
  const recentItems: FeedbackRecentRow[] = [];
  for (const item of sorted.slice(0, recentLimit)) {
    const tsStr = String(item.feedback_utc_ts ?? '');
    let formattedTime = '??:??';
    if (tsStr) {
      const ts = parseFeedbackUtc(tsStr);
      if (ts) {
        formattedTime =
          spanDays <= 1
            ? `${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')} UTC`
            : ts.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'UTC',
              }) + ' UTC';
      }
    }

    const rating = Number(item.rating) || 0;
    const sentiment = classifySentiment(rating);
    let feedbackText = String(item.feedback_text ?? '').trim();
    if (feedbackText.length > 80) {
      feedbackText = `${feedbackText.slice(0, 77)}...`;
    }

    recentItems.push({
      time: formattedTime,
      channel: '#feedback',
      sentiment,
      summary: feedbackText,
      rating,
    });
  }

  return { items: recentItems, merged_truncated: mergedTruncated };
}
