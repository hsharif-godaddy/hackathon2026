import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { buildDynamoClient, getConfig } from '@/lib/supportplane/store/config';
import { logger } from '@/lib/logger';

let client: DynamoDBDocumentClient | null = null;

function getClient(): DynamoDBDocumentClient {
  if (client) return client;
  client = buildDynamoClient();
  return client;
}

async function getTableKeyNames(tableName: string): Promise<string[]> {
  const res = await getClient().send(new DescribeTableCommand({ TableName: tableName }));
  return (res.Table?.KeySchema ?? []).map((k) => k.AttributeName!);
}

async function scanAll(tableName: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await getClient().send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: start })
    );
    for (const item of page.Items || []) {
      rows.push(item as Record<string, unknown>);
    }
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);
  return rows;
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

function dateSlice(ts: unknown): string | null {
  const s = str(ts);
  return s ? s.slice(0, 10) : null;
}

function monthSlice(ts: unknown): string | null {
  const s = str(ts);
  return s ? s.slice(0, 7) : null;
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
  private statsTable(): string { return getConfig().feedbackStatsTable; }
  private ingestTable(): string { return getConfig().feedbackIngestTable; }

  async scanFeedback(env?: string): Promise<Record<string, unknown>[]> {
    const items = await scanAll(this.feedbackTable());
    return env ? items.filter((i) => i['env'] === env) : items;
  }

  // ── Ingest writes ────────────────────────────────────────────────

  async insertFeedbackAthenaRow(params: unknown[]): Promise<number> {
    const item = paramsToItem(params, ATHENA_FIELDS, 'athena');
    if (!item['feedback_id']) return 0;
    try {
      await getClient().send(
        new PutCommand({
          TableName: this.feedbackTable(),
          Item: item,
          ConditionExpression: 'attribute_not_exists(feedback_id)',
        })
      );
      return 1;
    } catch (err) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') return 0;
      throw err;
    }
  }

  async insertFeedbackS3Row(params: unknown[]): Promise<number> {
    const item = paramsToItem(params, S3_FIELDS, 's3');
    if (!item['feedback_id']) return 0;
    await getClient().send(
      new PutCommand({ TableName: this.feedbackTable(), Item: item })
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
    // Discover actual key schema from DynamoDB before deleting — avoids hardcoding key names
    // that may differ between provisioned environments.
    const [feedbackKeys, ingestKeys] = await Promise.all([
      getTableKeyNames(this.feedbackTable()),
      getTableKeyNames(this.ingestTable()),
    ]);
    logger.info('feedback-store.clear.schemas', {
      env,
      feedbackTable: this.feedbackTable(),
      feedbackKeys,
      ingestTable: this.ingestTable(),
      ingestKeys,
    });

    const items = await this.scanFeedback(env);
    logger.info('feedback-store.clear.feedback', { env, count: items.length });
    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 25) chunks.push(items.slice(i, i + 25));
    for (const chunk of chunks) {
      const res = await getClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [this.feedbackTable()]: chunk.map((item) => ({
              DeleteRequest: {
                Key: Object.fromEntries(feedbackKeys.map((k) => [k, item[k]])),
              },
            })),
          },
        })
      );
      if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length > 0) {
        logger.warn('feedback-store.clear.feedback.unprocessed', { unprocessed: res.UnprocessedItems });
      }
    }

    // Clear entire ingest log (no env filter on ingest table)
    const ingestItems = await scanAll(this.ingestTable());
    logger.info('feedback-store.clear.ingest', { count: ingestItems.length });
    const iChunks: (typeof ingestItems)[] = [];
    for (let i = 0; i < ingestItems.length; i += 25) iChunks.push(ingestItems.slice(i, i + 25));
    for (const chunk of iChunks) {
      const res = await getClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [this.ingestTable()]: chunk.map((item) => ({
              DeleteRequest: {
                Key: Object.fromEntries(ingestKeys.map((k) => [k, item[k]])),
              },
            })),
          },
        })
      );
      if (res.UnprocessedItems && Object.keys(res.UnprocessedItems).length > 0) {
        logger.warn('feedback-store.clear.ingest.unprocessed', { unprocessed: res.UnprocessedItems });
      }
    }
    logger.info('feedback-store.clear.done', { env });
  }

  // DynamoDB writes composite rows directly; no separate rebuild step.
  async rebuildFeedbackComposite(env: string): Promise<number> {
    const items = await this.scanFeedback(env);
    return items.length;
  }

  async recomputeDailyStats(env: string, dates?: string[]): Promise<void> {
    const items = await this.scanFeedback(env);
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
    let items = await this.scanFeedback(env);
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
    const items = (await this.scanFeedback(env)).filter(
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
    let items = await this.scanFeedback(env);
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
    const items = await this.scanFeedback(env);
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
    const items = await this.scanFeedback(env);
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
  ): Promise<Array<{ appId: string; count: number; avgRating: number | null; issueCount: number; issueRate: number | null }>> {
    const items = await this.scanFeedback(env);
    const buckets = new Map<string, { count: number; ratingSum: number; ratingCount: number; issues: number }>();
    for (const item of items) {
      const appId = str(item['app_id']) ?? '__unknown__';
      const b = buckets.get(appId) ?? { count: 0, ratingSum: 0, ratingCount: 0, issues: 0 };
      b.count++;
      const r = num(item['rating']);
      if (r !== null) { b.ratingSum += r; b.ratingCount++; }
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
      }));
  }

  async getFeedbackHeatmap(
    env: string,
    type: 'hour-of-day' | 'day-of-week' = 'hour-of-day'
  ): Promise<Array<{ x: string; y: number; value: number }>> {
    const items = (await this.scanFeedback(env)).filter((i) => i['feedback_utc_ts']);
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
    const items = (await this.scanFeedback(env)).filter((i) => {
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
    let items = await this.scanFeedback(env);
    if (filters?.category) items = items.filter((i) => i['feedback_category'] === filters.category);
    if (filters?.rating !== undefined) items = items.filter((i) => num(i['rating']) === filters.rating);
    if (filters?.appId) items = items.filter((i) => i['app_id'] === filters.appId);
    if (filters?.days) {
      const cutoff = new Date(Date.now() - filters.days * 86400000).toISOString().slice(0, 10);
      items = items.filter((i) => (dateSlice(i['feedback_utc_ts']) ?? '') >= cutoff);
    }

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
  }> {
    const items = await this.scanFeedback(env);
    let earliest: string | null = null, latest: string | null = null;
    let athena = 0, s3Only = 0, both = 0;
    const months = new Set<string>();
    for (const item of items) {
      const ts = str(item['feedback_utc_ts']);
      if (ts) {
        if (!earliest || ts < earliest) earliest = ts;
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
      athenaRows: athena + both, s3OnlyRows: s3Only, bothRows: both,
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
