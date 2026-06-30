import {
  type FeedbackItem,
  type FeedbackWindow,
  feedbackWindowCacheKey,
  filterFeedbackItemsForWindow,
  getFeedbackItemsCached,
  getFeedbackS3Bucket,
  parseFeedbackRequest,
} from '@/lib/supportplane/ingest/feedback-s3';
import { scorecardCached, scorecardCachePeek, scorecardCacheSet } from './cache';
import { logger } from '@/lib/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function fetchFeedbackParallel(
  feedWindow: FeedbackWindow,
): Promise<{ items: FeedbackItem[]; merged_truncated: boolean; partition_errors: number }> {
  if (feedWindow.kind === 'all') {
    return getFeedbackItemsCached(feedWindow);
  }

  const dayWindows: Array<{ kind: 'absolute'; startYmd: string; endYmd: string }> = [];
  if (feedWindow.kind === 'rolling') {
    const now = Date.now();
    for (let i = 0; i <= feedWindow.days; i++) {
      const ymd = new Date(now - i * MS_PER_DAY).toISOString().split('T')[0] as string;
      dayWindows.push({ kind: 'absolute', startYmd: ymd, endYmd: ymd });
    }
  } else {
    const startMs = new Date(`${feedWindow.startYmd}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${feedWindow.endYmd}T00:00:00.000Z`).getTime();
    for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
      const ymd = new Date(ms).toISOString().split('T')[0] as string;
      dayWindows.push({ kind: 'absolute', startYmd: ymd, endYmd: ymd });
    }
  }

  const results = await Promise.allSettled(dayWindows.map((w) => getFeedbackItemsCached(w)));

  let partition_errors = 0;
  let merged_truncated = false;
  const allItems: FeedbackItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allItems.push(...r.value.items);
      if (r.value.merged_truncated) merged_truncated = true;
      partition_errors += r.value.partition_errors;
    } else {
      partition_errors += 1;
    }
  }
  allItems.sort((a, b) => String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')));
  return { items: allItems, merged_truncated, partition_errors };
}

type AbsoluteWindow = { kind: 'absolute'; startYmd: string; endYmd: string };

function buildPartitionWindows(feedWindow: FeedbackWindow): FeedbackWindow[] {
  if (feedWindow.kind === 'all') return [feedWindow];
  const windows: AbsoluteWindow[] = [];
  if (feedWindow.kind === 'rolling') {
    const now = Date.now();
    for (let i = 0; i <= feedWindow.days; i++) {
      const ymd = new Date(now - i * MS_PER_DAY).toISOString().split('T')[0] as string;
      windows.push({ kind: 'absolute', startYmd: ymd, endYmd: ymd });
    }
  } else {
    const startMs = new Date(`${feedWindow.startYmd}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${feedWindow.endYmd}T00:00:00.000Z`).getTime();
    for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
      const ymd = new Date(ms).toISOString().split('T')[0] as string;
      windows.push({ kind: 'absolute', startYmd: ymd, endYmd: ymd });
    }
  }
  return windows;
}

interface S3AggResult {
  avgRating: number | null;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  distribution: Record<string, number>;
  mergedTruncated: boolean;
  itemsLoaded: number;
  itemsInWindow: number;
  partitionErrors: number;
  topComments: ScorecardS3CommentRow[];
  perAppRatings: Array<{ appId: string; avg: number; count: number }>;
  categoryCounts: Record<string, number>;
}

function aggregateItems(
  items: FeedbackItem[],
  inWindow: FeedbackItem[],
  merged_truncated: boolean,
  partition_errors: number,
): S3AggResult {
  let ratingSum: number = 0;
  let ratingCount: number = 0;
  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 };
  let fbPositive: number = 0;
  let fbNeutral: number = 0;
  let fbNegative: number = 0;
  const topComments: ScorecardS3CommentRow[] = [];
  const appRatings = new Map<string, { sum: number; count: number }>();
  const categoryCounts: Record<string, number> = {};

  for (const item of inWindow) {
    const r: number = Number(item.rating);
    const rValid: boolean = Number.isFinite(r) && r >= 1 && r <= 7;
    if (rValid) {
      const ri: number = Math.round(r);
      dist[String(ri)] = (dist[String(ri)] ?? 0) + 1;
      ratingSum += r;
      ratingCount += 1;
      if (r >= 6) fbPositive += 1;
      else if (r >= 4) fbNeutral += 1;
      else fbNegative += 1;
    }
    const cat: string = (item['feedback_category'] as string | undefined)?.toLowerCase().trim() || 'feedback';
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    const appId: string | undefined = ((item['app_id'] ?? item['appId']) as string | undefined)?.trim();
    if (appId && rValid) {
      const slot: { sum: number; count: number } = appRatings.get(appId) ?? { sum: 0, count: 0 };
      slot.sum += Number(item.rating);
      slot.count += 1;
      appRatings.set(appId, slot);
    }
    if (topComments.length < 20) {
      const textRaw: unknown = item['feedback_text'] ?? item['comment'] ?? item['message'];
      const text: string = typeof textRaw === 'string' ? textRaw.trim() : '';
      if (text) {
        topComments.push({
          text: text.slice(0, 500),
          rating: rValid ? r : null,
          ts: typeof item.feedback_utc_ts === 'string' ? item.feedback_utc_ts : null,
          appId: appId ?? null,
        });
      }
    }
  }

  const perAppRatings: Array<{ appId: string; avg: number; count: number }> = Array.from(appRatings.entries())
    .map(([appId, { sum, count }]): { appId: string; avg: number; count: number } => ({ appId, avg: Math.round((sum / count) * 10) / 10, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    total: ratingCount,
    positive: fbPositive,
    neutral: fbNeutral,
    negative: fbNegative,
    distribution: dist,
    mergedTruncated: merged_truncated,
    itemsLoaded: items.length,
    itemsInWindow: inWindow.length,
    partitionErrors: partition_errors,
    topComments,
    perAppRatings,
    categoryCounts,
  };
}

const S3_CACHE_TTL_MS = 3_600_000;
const S3_CACHE_BG_REFRESH_MS = 900_000;

export async function streamScorecardS3Feed(
  sp: URLSearchParams,
  emit: (obj: Record<string, unknown>) => void,
): Promise<void> {
  if (!getFeedbackS3Bucket()) {
    emit({ type: 'result', configMissing: true });
    return;
  }

  const feedWindow = parseFeedbackRequest(sp);
  if ('error' in feedWindow) {
    emit({ type: 'error', message: feedWindow.error });
    return;
  }

  const cacheKey = `scorecard_feedback_${feedbackWindowCacheKey(feedWindow)}`;
  const cached = scorecardCachePeek<S3AggResult>(cacheKey);
  if (cached) {
    emit({ type: 'result', configMissing: false, ...(cached as unknown as Record<string, unknown>) });
    return;
  }

  const partitions = buildPartitionWindows(feedWindow);
  const total: number = partitions.length;
  emit({ type: 'progress', done: 0, total });

  let done: number = 0;
  const partitionResults = await Promise.allSettled(
    partitions.map((w) =>
      getFeedbackItemsCached(w).then(
        (r) => { done++; emit({ type: 'progress', done, total }); return r; },
        () => { done++; emit({ type: 'progress', done, total }); throw new Error('partition failed'); },
      ),
    ),
  );

  let partitionErrors: number = 0;
  let mergedTruncated: boolean = false;
  const allItems: FeedbackItem[] = [];
  for (const r of partitionResults) {
    if (r.status === 'fulfilled') {
      allItems.push(...r.value.items);
      if (r.value.merged_truncated) mergedTruncated = true;
      partitionErrors += r.value.partition_errors;
    } else {
      partitionErrors += 1;
    }
  }
  allItems.sort((a, b) => String(b.feedback_utc_ts ?? '').localeCompare(String(a.feedback_utc_ts ?? '')));

  const inWindow = filterFeedbackItemsForWindow(allItems, feedWindow);
  const agg = aggregateItems(allItems, inWindow, mergedTruncated, partitionErrors);
  scorecardCacheSet(cacheKey, S3_CACHE_TTL_MS, agg);
  logger.info('scorecard.s3Feedback.stream.complete', { cacheKey, total: agg.total, itemsLoaded: allItems.length });
  emit({ type: 'result', configMissing: false, ...(agg as unknown as Record<string, unknown>) });
}

export interface ScorecardS3CommentRow {
  text: string;
  rating: number | null;
  ts: string | null;
  appId: string | null;
}

export interface ScorecardS3Data {
  configMissing: false;
  avgRating: number | null;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  distribution: Record<string, number>;
  mergedTruncated: boolean;
  itemsLoaded: number;
  itemsInWindow: number;
  partitionErrors: number;
  topComments: ScorecardS3CommentRow[];
  perAppRatings: Array<{ appId: string; avg: number; count: number }>;
  categoryCounts: Record<string, number>;
}

export type ScorecardS3Result =
  | { configMissing: true }
  | { error: string; status: 400 }
  | ScorecardS3Data;

export async function getScorecardS3Data(sp: URLSearchParams): Promise<ScorecardS3Result> {
  if (!getFeedbackS3Bucket()) return { configMissing: true };

  const feedWindow = parseFeedbackRequest(sp);
  if ('error' in feedWindow) return { error: feedWindow.error, status: 400 };

  const cacheKey = `scorecard_feedback_${feedbackWindowCacheKey(feedWindow)}`;
  const data = await scorecardCached(cacheKey, S3_CACHE_TTL_MS, async () => {
    const fetchStart = Date.now();
    logger.info('scorecard.s3Feedback.fetch.start', { cacheKey });
    try {
      const { items, merged_truncated, partition_errors } = await fetchFeedbackParallel(feedWindow);
      const inWindow = filterFeedbackItemsForWindow(items, feedWindow);
      const result = aggregateItems(items, inWindow, merged_truncated, partition_errors);
      logger.info('scorecard.s3Feedback.fetch.complete', { cacheKey, total: result.total, itemsLoaded: items.length, durationMs: Date.now() - fetchStart });
      return result;
    } catch (err: unknown) {
      logger.error('scorecard.s3Feedback.fetch.error', { cacheKey, durationMs: Date.now() - fetchStart, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }, S3_CACHE_BG_REFRESH_MS);

  return { configMissing: false, ...data };
}

export interface ScorecardFeedbackCommentsResult {
  configMissing?: true;
  error?: string;
  errorStatus?: 400;
  comments?: Array<{ text: string; rating: number; ts: string | null; appId: string | null }>;
  total?: number;
  page?: number;
  pageSize?: number;
}

const COMMENTS_PAGE_SIZE = 10;

export async function getScorecardFeedbackComments(sp: URLSearchParams): Promise<ScorecardFeedbackCommentsResult> {
  if (!getFeedbackS3Bucket()) return { configMissing: true };

  const feedWindow = parseFeedbackRequest(sp);
  if ('error' in feedWindow) return { error: feedWindow.error, errorStatus: 400 };

  const rawRating: string | null = sp.get('rating');
  if (rawRating === null) return { error: 'rating is required', errorStatus: 400 };
  const ratingParam: number = Number(rawRating);
  if (!Number.isFinite(ratingParam) || ratingParam < 1 || ratingParam > 7) {
    return { error: 'rating must be an integer 1–7', errorStatus: 400 };
  }

  const targetRating: number = Math.round(ratingParam);
  const page: number = Math.max(0, Number(sp.get('page')) || 0);

  type CommentsPage = {
    comments: Array<{ text: string; rating: number; ts: string | null; appId: string | null }>;
    total: number;
    page: number;
    pageSize: number;
  };

  const cacheKey = `scorecard_comments_${feedbackWindowCacheKey(feedWindow)}_r${targetRating}_p${page}`;
  return scorecardCached<CommentsPage>(cacheKey, S3_CACHE_TTL_MS, async () => {
    const { items } = await fetchFeedbackParallel(feedWindow);
    const inWindow = filterFeedbackItemsForWindow(items, feedWindow);

    const matches: Array<{ text: string; rating: number; ts: string | null; appId: string | null }> = [];
    for (const item of inWindow) {
      const r: number = Number(item.rating);
      if (!Number.isFinite(r) || Math.round(r) !== targetRating) continue;
      const textRaw: unknown = item['feedback_text'] ?? item['comment'] ?? item['message'];
      const text: string = typeof textRaw === 'string' ? textRaw.trim() : '';
      if (!text) continue;
      const appId: string | null = ((item['app_id'] ?? item['appId']) as string | undefined)?.trim() ?? null;
      matches.push({ text: text.slice(0, 500), rating: r, ts: typeof item.feedback_utc_ts === 'string' ? item.feedback_utc_ts : null, appId });
    }

    return {
      comments: matches.slice(page * COMMENTS_PAGE_SIZE, (page + 1) * COMMENTS_PAGE_SIZE),
      total: matches.length,
      page,
      pageSize: COMMENTS_PAGE_SIZE,
    };
  }, S3_CACHE_BG_REFRESH_MS);
}
