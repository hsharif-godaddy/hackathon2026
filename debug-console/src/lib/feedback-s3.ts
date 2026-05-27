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

export const FEEDBACK_RANGE_DAYS_LIST = [1, 7, 14, 30, 90] as const;
export type FeedbackRangeDays = (typeof FEEDBACK_RANGE_DAYS_LIST)[number];

export type FeedbackWindow =
  | { kind: 'rolling'; days: FeedbackRangeDays }
  | { kind: 'absolute'; startYmd: string; endYmd: string }
  | { kind: 'all' };

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
  const allParam = sp.get('all')?.trim().toLowerCase();
  if (allParam === '1' || allParam === 'true' || allParam === 'yes') {
    return { kind: 'all' };
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
  if (window.kind === 'all') {
    return 'all';
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
  if (window.kind === 'all') {
    return 30;
  }
  return inclusiveUtcDayCount(window.startYmd, window.endYmd);
}

function itemTimestampInWindow(ts: Date | null, window: FeedbackWindow): boolean {
  if (!ts) return false;
  if (window.kind === 'all') {
    return true;
  }
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

function appIdKeyFilter(appId: string | undefined): (key: string) => boolean {
  if (!appId) return () => true;
  // Hive-partition layout puts appId below date: `…/day=DD/hour=HH/appId={appId}/{ts}.parquet`.
  // Substring match is sufficient — the segment is unambiguous within the bucket prefix.
  const needle = `/appId=${appId}/`;
  return (key: string) => key.includes(needle);
}

async function fetchFeedbackFromS3Rolling(
  dayCount: FeedbackRangeDays,
  appId?: string,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const bucket = getFeedbackS3Bucket();
  if (!bucket) return { items: [], merged_truncated: false, partition_errors: 0 };

  const now = Date.now();
  const feedbackItems: FeedbackItem[] = [];
  let partition_errors = 0;
  const partitionDays = dayCount + 1;
  const matchesAppId = appIdKeyFilter(appId);

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
      if (!matchesAppId(key)) continue;
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
  appId?: string,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const bucket = getFeedbackS3Bucket();
  if (!bucket) return { items: [], merged_truncated: false, partition_errors: 0 };

  const feedbackItems: FeedbackItem[] = [];
  let partition_errors = 0;
  const matchesAppId = appIdKeyFilter(appId);
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
      if (!matchesAppId(key)) continue;
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

async function fetchFeedbackFromS3All(
  appId?: string,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const bucket = getFeedbackS3Bucket();
  if (!bucket) return { items: [], merged_truncated: false, partition_errors: 0 };

  const base = (process.env.FEEDBACK_S3_PREFIX?.trim() || DEFAULT_PREFIX).replace(/\/?$/, '/');
  let keys: string[] = [];
  let partition_errors = 0;
  try {
    keys = await listAllKeys(bucket, base);
  } catch (err) {
    partition_errors += 1;
    console.error('feedback-s3: listAllKeys failed (all)', { bucket, base }, err);
    return { items: [], merged_truncated: false, partition_errors };
  }

  const matchesAppId = appIdKeyFilter(appId);
  keys = keys.filter(matchesAppId);
  keys.sort((a, b) => b.localeCompare(a));

  const feedbackItems: FeedbackItem[] = [];
  let keysFullyConsumed = true;
  for (const key of keys) {
    if (feedbackItems.length >= MAX_MERGED_ITEMS) {
      keysFullyConsumed = false;
      break;
    }
    const { items: fromKey, malformedLineCount } = await getObjectItems(bucket, key);
    if (malformedLineCount > 0) {
      console.warn('feedback-s3: skipped malformed lines', { bucket, key, count: malformedLineCount });
    }
    for (const item of fromKey) {
      feedbackItems.push(item);
      if (feedbackItems.length >= MAX_MERGED_ITEMS) {
        keysFullyConsumed = false;
        break;
      }
    }
    if (feedbackItems.length >= MAX_MERGED_ITEMS) {
      break;
    }
  }

  feedbackItems.sort((a, b) => String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')));
  const merged_truncated = !keysFullyConsumed;
  return {
    items: feedbackItems.slice(0, MAX_MERGED_ITEMS),
    merged_truncated,
    partition_errors,
  };
}

export async function getFeedbackItemsCached(
  window: FeedbackWindow,
  appId?: string,
  force: boolean = false,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  const key = `${feedbackWindowCacheKey(window)}:app=${appId ?? ''}`;
  const now = Date.now();
  if (!force && itemsCache && itemsCache.key === key && now - itemsCache.at < ITEMS_CACHE_TTL_MS) {
    return {
      items: itemsCache.items,
      merged_truncated: itemsCache.merged_truncated,
      partition_errors: itemsCache.partition_errors,
    };
  }
  const merged =
    window.kind === 'all'
      ? await fetchFeedbackFromS3All(appId)
      : window.kind === 'rolling'
        ? await fetchFeedbackFromS3Rolling(window.days, appId)
        : await fetchFeedbackFromS3Absolute(window.startYmd, window.endYmd, appId);
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

export interface FeedbackDailyRow {
  ymd: string;
  label: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

function utcYmdFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function chartDayLabels(window: FeedbackWindow, inWindow: FeedbackItem[]): string[] {
  if (window.kind === 'rolling') {
    const now = new Date();
    const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const out: string[] = [];
    for (let i = window.days - 1; i >= 0; i -= 1) {
      out.push(utcYmdFromDate(new Date(utcMid.getTime() - i * MS_PER_DAY)));
    }
    return out;
  }
  if (window.kind === 'all') {
    if (!inWindow.length) return [];
    let minYmd = '9999-12-31';
    let maxYmd = '0000-01-01';
    for (const item of inWindow) {
      const ts = parseFeedbackUtc(String(item.feedback_utc_ts ?? ''));
      if (!ts) continue;
      const ymd = utcYmdFromDate(ts);
      if (ymd < minYmd) minYmd = ymd;
      if (ymd > maxYmd) maxYmd = ymd;
    }
    if (minYmd === '9999-12-31' || maxYmd === '0000-01-01') return [];
    const days = enumerateUtcDaysInclusive(minYmd, maxYmd).map((d) => utcYmdFromDate(d));
    if (days.length <= 14) return days;
    return days.slice(-14);
  }
  const days = enumerateUtcDaysInclusive(window.startYmd, window.endYmd).map((d) => utcYmdFromDate(d));
  if (days.length <= 14) return days;
  return days.slice(-14);
}

function mdyLabel(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[1]}/${parts[2]}`;
}

function buildDaily(inWindow: FeedbackItem[], window: FeedbackWindow): FeedbackDailyRow[] {
  const labels = chartDayLabels(window, inWindow);
  const map = new Map<string, { total: number; positive: number; neutral: number; negative: number }>();
  for (const ymd of labels) {
    map.set(ymd, { total: 0, positive: 0, neutral: 0, negative: 0 });
  }
  for (const item of inWindow) {
    const ts = parseFeedbackUtc(String(item.feedback_utc_ts ?? ''));
    if (!ts) continue;
    const ymd = utcYmdFromDate(ts);
    const bucket = map.get(ymd);
    if (!bucket) continue;
    const r = Number(item.rating) || 0;
    const s = classifySentiment(r);
    bucket.total += 1;
    if (s === 'positive') bucket.positive += 1;
    else if (s === 'neutral') bucket.neutral += 1;
    else bucket.negative += 1;
  }
  return labels.map(function mapDay(ymd) {
    const b = map.get(ymd)!;
    return { ymd, label: mdyLabel(ymd), ...b };
  });
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
      daily: [] as FeedbackDailyRow[],
      merged_truncated: mergedTruncated,
      rangeDays: window.kind === 'rolling' ? window.days : undefined,
      absoluteRange: window.kind === 'absolute' ? { start: window.startYmd, end: window.endYmd } : undefined,
      allTime: window.kind === 'all' ? true : undefined,
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
    daily: buildDaily(inWindow, window),
    merged_truncated: mergedTruncated,
    rangeDays: window.kind === 'rolling' ? window.days : undefined,
    absoluteRange: window.kind === 'absolute' ? { start: window.startYmd, end: window.endYmd } : undefined,
    allTime: window.kind === 'all' ? true : undefined,
  };
}

export interface FeedbackRecentRow {
  time: string;
  /** UTC calendar date YYYY-MM-DD when `feedback_utc_ts` parsed. */
  dateUtc?: string;
  /** UTC time HH:MM:SS (24h) when `feedback_utc_ts` parsed. */
  clockUtc?: string;
  shortTime?: string;
  userKey?: string;
  appId?: string;
  channel: string;
  sentiment: string;
  summary: string;
  fullMessage?: string;
  message?: string;
  comment?: string;
  rating: number;
  plan?: string;
  status?: string;
  subscriptionStatus?: string;
  instanceId?: string;
  customerId?: string;
  creditsUsed?: number;
  creditsLimit?: number;
  availableCredits?: number;
  totalCredits?: number;
}

export interface BuildFeedbackRecentOptions {
  limit?: number;
  /** Omit or positive: cap length. `<= 0` keeps full feedback text. */
  summaryMaxLen?: number;
}

function strField(item: FeedbackItem, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
}

function numField(item: FeedbackItem, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
}

export function buildFeedbackRecent(
  items: FeedbackItem[],
  window: FeedbackWindow,
  mergedTruncated: boolean,
  options?: BuildFeedbackRecentOptions,
): { error?: string; items: FeedbackRecentRow[]; merged_truncated?: boolean } {
  if (!items.length) {
    return { error: 'No feedback data available', items: [], merged_truncated: mergedTruncated };
  }

  const spanDays = feedbackWindowSpanDays(window);
  const defaultLimit = spanDays >= 7 ? 12 : 8;
  const cap = options?.limit ?? defaultLimit;
  const recentLimit = Math.min(Math.max(1, cap), 500);
  const summaryMaxLen = options?.summaryMaxLen ?? 80;
  const truncateSummary = summaryMaxLen > 0;
  const sorted = filterFeedbackItemsForWindow(items, window).sort((a, b) =>
    String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')),
  );
  const recentItems: FeedbackRecentRow[] = [];
  for (const item of sorted.slice(0, recentLimit)) {
    const tsStr = String(item.feedback_utc_ts ?? '');
    let formattedTime = '??:??';
    let shortTime = '??:??';
    let dateUtc: string | undefined;
    let clockUtc: string | undefined;
    if (tsStr) {
      const ts = parseFeedbackUtc(tsStr);
      if (ts) {
        dateUtc = ts.toISOString().slice(0, 10);
        const h = String(ts.getUTCHours()).padStart(2, '0');
        const m = String(ts.getUTCMinutes()).padStart(2, '0');
        const s = String(ts.getUTCSeconds()).padStart(2, '0');
        shortTime = `${h}:${m}`;
        clockUtc = `${h}:${m}:${s}`;
        formattedTime = `${dateUtc} ${clockUtc} UTC`;
      }
    }

    const rating = Number(item.rating) || 0;
    const sentiment = classifySentiment(rating);
    const rawMessage =
      strField(item, ['comment', 'message', 'full_message', 'fullMessage']) || String(item.feedback_text ?? '').trim();
    let feedbackText = rawMessage;
    if (truncateSummary && feedbackText.length > summaryMaxLen) {
      feedbackText = `${feedbackText.slice(0, summaryMaxLen - 3)}...`;
    }

    const appId = strField(item, ['app_id', 'appId']);
    const visitor = strField(item, ['visitor_id', 'visitorId', 'global_app_id', 'globalAppId']);
    const displayApp =
      appId && appId.length > 0
        ? appId
        : visitor && visitor.length > 0
          ? visitor.length > 12
            ? `${visitor.slice(0, 12)}…`
            : visitor
          : '—';
    const shortUser = displayApp;

    const totalCr = numField(item, ['total_credit_cnt', 'totalCredits']);
    const availCr = numField(item, ['available_credit_cnt', 'availableCredits']);
    const legacyUsed = numField(item, ['credits_used', 'creditsUsed']);
    const legacyLimit = numField(item, ['credits_limit', 'credit_limit', 'creditsLimit']);
    const hasRemainTotal =
      totalCr !== undefined &&
      totalCr > 0 &&
      availCr !== undefined &&
      Number.isFinite(availCr);

    recentItems.push({
      time: formattedTime,
      dateUtc,
      clockUtc,
      shortTime,
      userKey: shortUser,
      appId: appId ?? undefined,
      channel: '#feedback',
      sentiment,
      summary: feedbackText,
      fullMessage: rawMessage,
      message: strField(item, ['message']),
      comment: strField(item, ['comment']),
      rating,
      plan: strField(item, ['plan_type_name', 'plan_type', 'planTypeName', 'plan', 'plan_tier', 'planTier'])?.toUpperCase(),
      status: strField(item, ['status', 'subscription_status', 'subscriptionStatus'])?.toLowerCase(),
      subscriptionStatus: strField(item, ['subscription_status', 'subscriptionStatus'])?.toLowerCase(),
      instanceId: strField(item, ['feedback_id', 'id', 'instance_id', 'instanceId']),
      customerId: strField(item, ['customer_id', 'customerId']),
      creditsUsed: hasRemainTotal ? undefined : legacyUsed,
      creditsLimit: hasRemainTotal ? undefined : legacyLimit,
      availableCredits: hasRemainTotal ? availCr : undefined,
      totalCredits: hasRemainTotal ? totalCr : undefined,
    });
  }

  return { items: recentItems, merged_truncated: mergedTruncated };
}

/**
 * Per-app feedback rows for the debug-console Feedback tab. Returns the
 * full parquet record (rather than the projected `FeedbackRecentRow`) so
 * the panel can render every field that was dropped from the compact Slack
 * digest — Origin, Topics, Experiments, Subscription info, Customer
 * profile, links, etc.
 *
 * Topics arrive as a JSON-stringified array; parsed eagerly here so the
 * client doesn't need to second-guess the wire shape.
 */
export interface FeedbackByAppRow {
  feedbackId: string;
  feedbackUtcTs?: string;
  appId?: string;
  customerId?: string;
  shopperId?: string;
  rating?: number;
  comment?: string;
  consent?: boolean;
  origin?: string;
  category?: string;
  topics: string[];
  experimentsLine?: string;
  planTypeName?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
  subscriptionInfo?: string;
  totalCredits?: number;
  availableCredits?: number;
  appPublishFlag?: boolean;
  publishUrl?: string;
  previewUrl?: string;
  publishedUrlFull?: string;
  fullStoryUrl?: string;
}

function boolField(item: FeedbackItem, keys: readonly string[]): boolean | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

function parseTopicsField(item: FeedbackItem): string[] {
  const raw = item['feedback_topic_list'];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Malformed topic JSON — drop, don't poison the UI.
  }
  return [];
}

export function buildFeedbackByApp(
  items: FeedbackItem[],
  window: FeedbackWindow,
  mergedTruncated: boolean,
): { items: FeedbackByAppRow[]; merged_truncated: boolean; total: number; avgRating: number | null } {
  const inWindow = filterFeedbackItemsForWindow(items, window).sort((a, b) =>
    String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')),
  );

  const rows: FeedbackByAppRow[] = [];
  let ratingSum = 0;
  let ratingCount = 0;

  for (const item of inWindow) {
    const feedbackId = strField(item, ['feedback_id']);
    if (!feedbackId) continue;

    const rating = numField(item, ['rating']);
    if (rating !== undefined && Number.isFinite(rating)) {
      ratingSum += rating;
      ratingCount += 1;
    }

    rows.push({
      feedbackId,
      feedbackUtcTs: strField(item, ['feedback_utc_ts']),
      appId: strField(item, ['app_id', 'appId']),
      customerId: strField(item, ['customer_id', 'customerId']),
      shopperId: strField(item, ['shopper_id', 'shopperId']),
      rating,
      comment: strField(item, ['feedback_text', 'comment']),
      consent: boolField(item, ['consent_flag']),
      origin: strField(item, ['feedback_origin_name', 'origin']),
      category: strField(item, ['feedback_category']),
      topics: parseTopicsField(item),
      experimentsLine: strField(item, ['experiments_line']),
      planTypeName: strField(item, ['plan_type_name']),
      subscriptionId: strField(item, ['subscription_id']),
      subscriptionStatus: strField(item, ['subscription_status']),
      subscriptionInfo: strField(item, ['subscription_info']),
      totalCredits: numField(item, ['total_credit_cnt']),
      availableCredits: numField(item, ['available_credit_cnt']),
      appPublishFlag: boolField(item, ['app_publish_flag']),
      publishUrl: strField(item, ['publish_url']),
      previewUrl: strField(item, ['preview_url']),
      publishedUrlFull: strField(item, ['published_url_full']),
      fullStoryUrl: strField(item, ['full_story_url']),
    });
  }

  return {
    items: rows,
    merged_truncated: mergedTruncated,
    total: rows.length,
    avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
  };
}
