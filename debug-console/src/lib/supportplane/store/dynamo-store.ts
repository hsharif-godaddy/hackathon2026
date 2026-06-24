import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'node:https';

import { logger } from '@/lib/logger';
import { SP_MASK, spLog } from '@/lib/supportplane/sp-logger';
import type {
  QueryGroupResult,
  SupportplaneStore,
  TranscriptStatsResult,
  UploadUpdate,
} from '@/lib/supportplane/store/types';
import { buildDynamoClient, getConfig } from '@/lib/supportplane/store/config';
import type { TranscriptFilter, TranscriptRow, UploadRecord } from '@/lib/supportplane/db/l1-transcript-db';

const GROUP_FIELDS = {
  agent_name: 'agent_name',
  category: 'category',
  interaction_status: 'interaction_status',
  sentiment: 'sentiment_score',
} as const;

const CANDIDATE_CACHE_TTL_MS = 900000;
const FULL_SCAN_CACHE_TTL_MS = 900000;

let client: DynamoDBDocumentClient | null = null;
let fullScanCache: { expiresAt: number; rows: TranscriptRow[] } | null = null;
let fullScanInFlight: Promise<TranscriptRow[]> | null = null;
const candidateCache = new Map<string, { expiresAt: number; rows: TranscriptRow[] }>();
const candidateInFlight = new Map<string, Promise<TranscriptRow[]>>();

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function getClient(): DynamoDBDocumentClient {
  if (client) {
    return client;
  }

  client = buildDynamoClient({
    requestHandler: new NodeHttpHandler({
      // Reuse TCP+TLS connections across paginated Scan pages.
      // Without this, every page request opens a fresh TLS handshake (~100–200ms overhead each).
      httpsAgent: new https.Agent({ keepAlive: true }),
      requestTimeout: 10000,
    }),
  });

  return client;
}

function transcriptsTable(): string {
  return getConfig().transcriptsTable;
}

function uploadsTable(): string {
  return getConfig().uploadsTable;
}

function createdAfter(days_back: number): string {
  return new Date(Date.now() - days_back * 24 * 60 * 60 * 1000).toISOString();
}

function parseTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string');
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function includesText(item: Record<string, unknown>, text: string): boolean {
  const haystack = [
    item.conversation_summary,
    item.full_transcript,
    item.tags,
    item.category,
    item.subcategory,
    item.agent_name,
    item.interaction_type,
    item.interaction_status,
    item.raw_data,
  ]
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.stringify(value);
      }
      return '';
    })
    .join(' ')
    .toLowerCase();

  return haystack.includes(text.toLowerCase());
}

function matches(item: Record<string, unknown>, filter: TranscriptFilter): boolean {
  if (filter.interaction_id && item.interaction_id !== filter.interaction_id) {
    return false;
  }
  if (filter.app_id && item.app_id !== filter.app_id) {
    return false;
  }
  if (filter.shopper_id && item.shopper_id !== filter.shopper_id) {
    return false;
  }
  if (filter.customer_id && item.customer_id !== filter.customer_id) {
    return false;
  }
  if (filter.domain && item.domain !== filter.domain) {
    return false;
  }
  if (filter.category && item.category !== filter.category) {
    return false;
  }
  if (filter.interaction_status && item.interaction_status !== filter.interaction_status) {
    return false;
  }

  if (filter.sub_intent || filter.friction_point) {
    const raw =
      typeof item.raw_data === 'string' ? item.raw_data : JSON.stringify(item.raw_data || {});
    if (filter.sub_intent && !raw.includes(`"sub_intent":"${filter.sub_intent}"`)) {
      return false;
    }
    if (filter.friction_point && !raw.includes(`"friction_point":"${filter.friction_point}"`)) {
      return false;
    }
  }

  if (filter.tags?.length) {
    const tags = parseTags(item.tags);
    if (!tags || !filter.tags.some((tag) => tags.includes(tag))) {
      return false;
    }
  }

  if (filter.text_search && !includesText(item, filter.text_search)) {
    return false;
  }

  if (filter.start_date) {
    const created = typeof item.created_at === 'string' ? item.created_at : '';
    if (created < filter.start_date) {
      return false;
    }
  }

  if (filter.end_date) {
    const created = typeof item.created_at === 'string' ? item.created_at : '';
    if (created > filter.end_date) {
      return false;
    }
  }

  return true;
}

interface ScanOptions {
  filter?: TranscriptFilter;
  excludedFilterKeys?: Set<string>;
  projection?: string[];
  maxItems?: number;
  bypassCache?: boolean;
}

interface QueryPlan {
  indexName?: string;
  partitionKey: 'interaction_id' | 'app_id' | 'shopper_id' | 'customer_id' | 'domain';
  partitionValue: string;
  usesSortKey: boolean;
}

function normalizeFilter(filter: TranscriptFilter): TranscriptFilter {
  return {
    app_id: filter.app_id,
    shopper_id: filter.shopper_id,
    customer_id: filter.customer_id,
    domain: filter.domain,
    interaction_id: filter.interaction_id,
    category: filter.category,
    interaction_status: filter.interaction_status,
    sub_intent: filter.sub_intent,
    friction_point: filter.friction_point,
    tags: filter.tags,
    text_search: filter.text_search,
    start_date: filter.start_date,
    end_date: filter.end_date,
  };
}

function cacheKey(filter: TranscriptFilter): string {
  return JSON.stringify(normalizeFilter(filter));
}

function hasFilter(filter: TranscriptFilter): boolean {
  return Object.values(normalizeFilter(filter)).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== undefined && value !== null && value !== '';
  });
}

function buildFilterPushdown(
  filter: TranscriptFilter,
  excludedKeys: Set<string>
): {
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  const addEq = (field: string, value: unknown): void => {
    if (value === undefined || value === null || excludedKeys.has(field)) {
      return;
    }
    const key = field.replace(/[^a-zA-Z0-9]/g, '');
    const nameToken = `#${key}`;
    const valueToken = `:${key}`;
    names[nameToken] = field;
    values[valueToken] = value;
    clauses.push(`${nameToken} = ${valueToken}`);
  };

  addEq('interaction_id', filter.interaction_id);
  addEq('app_id', filter.app_id);
  addEq('shopper_id', filter.shopper_id);
  addEq('customer_id', filter.customer_id);
  addEq('domain', filter.domain);
  addEq('category', filter.category);
  addEq('interaction_status', filter.interaction_status);

  if (!excludedKeys.has('created_at')) {
    if (filter.start_date) {
      names['#created_at'] = 'created_at';
      values[':start_date'] = filter.start_date;
      clauses.push('#created_at >= :start_date');
    }
    if (filter.end_date) {
      names['#created_at'] = 'created_at';
      values[':end_date'] = filter.end_date;
      clauses.push('#created_at <= :end_date');
    }
  }

  if (!clauses.length) {
    return {};
  }

  return {
    FilterExpression: clauses.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

function parseProjection(projection?: string[]): {
  ProjectionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
} {
  if (!projection?.length) {
    return {};
  }

  const names: Record<string, string> = {};
  const tokens = projection.map((field, index) => {
    const token = `#p${index}`;
    names[token] = field;
    return token;
  });

  return {
    ProjectionExpression: tokens.join(', '),
    ExpressionAttributeNames: names,
  };
}

function scanCanUseCache(options: ScanOptions): boolean {
  const activeFilter = options.filter && hasFilter(options.filter);
  return Boolean(
    !activeFilter &&
    !options.projection &&
    !options.maxItems &&
    !options.bypassCache
  );
}

function planQuery(filter: TranscriptFilter): QueryPlan[] {
  if (filter.interaction_id) {
    return [{
      partitionKey: 'interaction_id',
      partitionValue: filter.interaction_id,
      usesSortKey: true,
    }];
  }

  if (filter.app_id) {
    return [
      {
        indexName: 'appCreatedAtIndex',
        partitionKey: 'app_id',
        partitionValue: filter.app_id,
        usesSortKey: true,
      },
      {
        indexName: 'appIndex',
        partitionKey: 'app_id',
        partitionValue: filter.app_id,
        usesSortKey: false,
      },
    ];
  }

  if (filter.shopper_id) {
    return [
      {
        indexName: 'shopperCreatedAtIndex',
        partitionKey: 'shopper_id',
        partitionValue: filter.shopper_id,
        usesSortKey: true,
      },
      {
        indexName: 'shopperIndex',
        partitionKey: 'shopper_id',
        partitionValue: filter.shopper_id,
        usesSortKey: false,
      },
    ];
  }

  if (filter.customer_id) {
    return [
      {
        indexName: 'customerCreatedAtIndex',
        partitionKey: 'customer_id',
        partitionValue: filter.customer_id,
        usesSortKey: true,
      },
      {
        indexName: 'customerIndex',
        partitionKey: 'customer_id',
        partitionValue: filter.customer_id,
        usesSortKey: false,
      },
    ];
  }

  if (filter.domain) {
    return [
      {
        indexName: 'domainCreatedAtIndex',
        partitionKey: 'domain',
        partitionValue: filter.domain,
        usesSortKey: true,
      },
      {
        indexName: 'domainIndex',
        partitionKey: 'domain',
        partitionValue: filter.domain,
        usesSortKey: false,
      },
    ];
  }

  return [];
}

function isMissingIndexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'ValidationException' &&
    (
      error.message.includes('specified index') ||
      error.message.includes('does not have the specified index')
    )
  );
}

const SCAN_SEGMENTS = 8;

async function scanTranscripts(options: ScanOptions = {}): Promise<TranscriptRow[]> {
  const scanSegment = async (segment: number): Promise<TranscriptRow[]> => {
    const rows: TranscriptRow[] = [];
    const pushdown = buildFilterPushdown(options.filter || {}, options.excludedFilterKeys || new Set());
    const projection = parseProjection(options.projection);
    const expressionNames = {
      ...(projection.ExpressionAttributeNames || {}),
      ...(pushdown.ExpressionAttributeNames || {}),
    };
    const command = {
      TableName: transcriptsTable(),
      FilterExpression: pushdown.FilterExpression,
      ProjectionExpression: projection.ProjectionExpression,
      ExpressionAttributeNames:
        Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      ExpressionAttributeValues: pushdown.ExpressionAttributeValues,
      TotalSegments: SCAN_SEGMENTS,
      Segment: segment,
    };
    let start: Record<string, unknown> | undefined;
    let pageCount = 0;

    do {
      const page = await getClient().send(
        new ScanCommand({
          ...command,
          ExclusiveStartKey: start,
        })
      );

      pageCount++;
      for (const item of page.Items || []) {
        rows.push(item as TranscriptRow);
        if (options.maxItems && rows.length >= options.maxItems) {
          return rows;
        }
      }

      start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);

    return rows;
  };

  const execute = async (): Promise<TranscriptRow[]> => {
    const segments = await Promise.all(
      Array.from({ length: SCAN_SEGMENTS }, (_, i) => scanSegment(i))
    );
    return segments.flat();
  };

  if (scanCanUseCache(options)) {
    const cached = fullScanCache;
    if (cached && cached.expiresAt > Date.now()) {
      spLog(SP_MASK.DEBUG, 'dynamo-store', `Full-scan cache hit — ${cached.rows.length} transcripts`);
      return cached.rows;
    }
    if (fullScanInFlight) {
      spLog(SP_MASK.DEBUG, 'dynamo-store', 'Joining in-flight transcript scan');
      return fullScanInFlight;
    }
    spLog(SP_MASK.INFO, 'dynamo-store', `Full transcript scan start — ${transcriptsTable()}`);
    fullScanInFlight = execute();
    try {
      const rows = await fullScanInFlight;
      fullScanCache = { expiresAt: Date.now() + FULL_SCAN_CACHE_TTL_MS, rows };
      spLog(SP_MASK.INFO, 'dynamo-store', `Transcript scan complete — ${rows.length} rows cached for 15m`);
      return rows;
    } finally {
      fullScanInFlight = null;
    }
  }

  return execute();
}

async function countTableScan(options: {
  filterExpression?: string;
  expressionNames?: Record<string, string>;
  expressionValues?: Record<string, unknown>;
}): Promise<number> {
  const countSegment = async (segment: number): Promise<number> => {
    let total = 0;
    let start: Record<string, unknown> | undefined;

    do {
      const page = await getClient().send(
        new ScanCommand({
          TableName: transcriptsTable(),
          Select: 'COUNT',
          FilterExpression: options.filterExpression,
          ExpressionAttributeNames: options.expressionNames,
          ExpressionAttributeValues: options.expressionValues,
          TotalSegments: SCAN_SEGMENTS,
          Segment: segment,
          ExclusiveStartKey: start,
        })
      );
      total += page.Count ?? 0;
      start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);

    return total;
  };

  const segments = await Promise.all(
    Array.from({ length: SCAN_SEGMENTS }, (_, i) => countSegment(i))
  );
  return segments.reduce((sum, count) => sum + count, 0);
}

// Fast browse: Query browseIndex (PK=GLOBAL, SK=created_at DESC, Limit=N).
// O(limit) regardless of table size. Falls back to scanTranscripts() if the
// GSI does not exist yet (not yet deployed).
async function queryBrowseIndex(limit: number, offset: number): Promise<TranscriptRow[] | null> {
  try {
    const result = await getClient().send(
      new QueryCommand({
        TableName: transcriptsTable(),
        IndexName: 'browseIndex',
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'browse_pk' },
        ExpressionAttributeValues: { ':pk': 'GLOBAL' },
        ScanIndexForward: false,
        Limit: offset + limit,
      })
    );
    const items = (result.Items || []) as TranscriptRow[];
    return items.slice(offset, offset + limit);
  } catch (error) {
    if (isMissingIndexError(error)) {
      return null;
    }
    throw error;
  }
}

async function queryTranscriptsByPlan(
  filter: TranscriptFilter,
  plan: QueryPlan
): Promise<TranscriptRow[]> {
  const rows: TranscriptRow[] = [];
  const names: Record<string, string> = {
    '#pk': plan.partitionKey,
  };
  const values: Record<string, unknown> = {
    ':pk': plan.partitionValue,
  };
  const clauses = ['#pk = :pk'];
  const excluded = new Set<string>([plan.partitionKey]);

  if (plan.usesSortKey) {
    names['#sk'] = 'created_at';
    if (filter.start_date && filter.end_date) {
      clauses.push('#sk BETWEEN :start_date AND :end_date');
      values[':start_date'] = filter.start_date;
      values[':end_date'] = filter.end_date;
      excluded.add('created_at');
    } else if (filter.start_date) {
      clauses.push('#sk >= :start_date');
      values[':start_date'] = filter.start_date;
      excluded.add('created_at');
    } else if (filter.end_date) {
      clauses.push('#sk <= :end_date');
      values[':end_date'] = filter.end_date;
      excluded.add('created_at');
    }
  }

  const pushdown = buildFilterPushdown(filter, excluded);
  const mergedNames = {
    ...names,
    ...(pushdown.ExpressionAttributeNames || {}),
  };
  const mergedValues = {
    ...values,
    ...(pushdown.ExpressionAttributeValues || {}),
  };
  let start: Record<string, unknown> | undefined;

  do {
    const page = await getClient().send(
      new QueryCommand({
        TableName: transcriptsTable(),
        IndexName: plan.indexName,
        KeyConditionExpression: clauses.join(' AND '),
        FilterExpression: pushdown.FilterExpression,
        ExpressionAttributeNames: mergedNames,
        ExpressionAttributeValues: mergedValues,
        ExclusiveStartKey: start,
      })
    );

    for (const item of page.Items || []) {
      rows.push(item as TranscriptRow);
    }

    start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);

  return rows;
}

function groupStats(
  items: TranscriptRow[],
  field: keyof typeof GROUP_FIELDS,
  limit: number
): QueryGroupResult[] {
  const buckets = new Map<
    string,
    { count: number; sentimentTotal: number; durationTotal: number; unresolvedCount: number }
  >();
  const key = GROUP_FIELDS[field];

  for (const item of items) {
    const value = item[key];
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const bucket = buckets.get(String(value)) || {
      count: 0,
      durationTotal: 0,
      sentimentTotal: 0,
      unresolvedCount: 0,
    };

    bucket.count += 1;
    bucket.sentimentTotal += Number(item.sentiment_score || 0);
    bucket.durationTotal += Number(item.resolution_time_seconds || 0);
    if (item.interaction_status === 'unresolved') {
      bucket.unresolvedCount += 1;
    }

    buckets.set(String(value), bucket);
  }

  return [...buckets.entries()]
    .map(([field_value, bucket]) => ({
      avg_duration: bucket.count ? bucket.durationTotal / bucket.count : 0,
      avg_sentiment: bucket.count ? bucket.sentimentTotal / bucket.count : 0,
      count: bucket.count,
      field_value,
      unresolved_count: bucket.unresolvedCount,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function tagStats(items: TranscriptRow[], limit: number): QueryGroupResult[] {
  const buckets = new Map<
    string,
    { count: number; sentimentTotal: number; unresolvedCount: number }
  >();

  for (const item of items) {
    const tags = parseTags(item.tags);
    if (!tags?.length) {
      continue;
    }

    for (const tag of tags) {
      const bucket = buckets.get(tag) || { count: 0, sentimentTotal: 0, unresolvedCount: 0 };
      bucket.count += 1;
      bucket.sentimentTotal += Number(item.sentiment_score || 0);
      if (item.interaction_status === 'unresolved') {
        bucket.unresolvedCount += 1;
      }
      buckets.set(tag, bucket);
    }
  }

  return [...buckets.entries()]
    .map(([tag, bucket]) => ({
      avg_sentiment: bucket.count ? bucket.sentimentTotal / bucket.count : 0,
      count: bucket.count,
      tag,
      unresolved_count: bucket.unresolvedCount,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function frictionStats(items: TranscriptRow[], limit: number): QueryGroupResult[] {
  const buckets = new Map<
    string,
    { count: number; sentimentTotal: number; resolutionTotal: number; unresolvedCount: number }
  >();

  for (const item of items) {
    const tags = parseTags(item.tags);
    if (!tags?.length) {
      continue;
    }

    for (const tag of tags) {
      const bucket = buckets.get(tag) || {
        count: 0,
        resolutionTotal: 0,
        sentimentTotal: 0,
        unresolvedCount: 0,
      };

      bucket.count += 1;
      bucket.sentimentTotal += Number(item.sentiment_score || 0);
      bucket.resolutionTotal += Number(item.resolution_time_seconds || 0);
      if (item.interaction_status === 'unresolved') {
        bucket.unresolvedCount += 1;
      }
      buckets.set(tag, bucket);
    }
  }

  return [...buckets.entries()]
    .map(([friction_point, bucket]) => ({
      avg_resolution_time: bucket.count ? bucket.resolutionTotal / bucket.count : 0,
      avg_sentiment: bucket.count ? bucket.sentimentTotal / bucket.count : 0,
      count: bucket.count,
      friction_point,
      occurrences: bucket.count,
      unresolved_count: bucket.unresolvedCount,
      unresolved_rate: bucket.count ? (bucket.unresolvedCount * 100) / bucket.count : 0,
    }))
    .sort((left, right) => {
      const countDiff = Number(right.occurrences || 0) - Number(left.occurrences || 0);
      if (countDiff !== 0) {
        return countDiff;
      }
      return Number(right.unresolved_rate || 0) - Number(left.unresolved_rate || 0);
    })
    .slice(0, limit);
}

export class DynamoStore implements SupportplaneStore {
  private async loadCandidates(filter: TranscriptFilter): Promise<TranscriptRow[]> {
    const plans = planQuery(filter);
    if (!plans.length) {
      return scanTranscripts({ filter: normalizeFilter(filter) });
    }

    let lastError: unknown;
    for (const plan of plans) {
      try {
        return await queryTranscriptsByPlan(filter, plan);
      } catch (error) {
        if (isMissingIndexError(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  private async getCandidates(filter: TranscriptFilter): Promise<TranscriptRow[]> {
    const key = cacheKey(filter);
    const cached = candidateCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rows;
    }

    const inFlight = candidateInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = this.loadCandidates(normalizeFilter(filter));
    candidateInFlight.set(key, task);

    try {
      const rows = await task;
      candidateCache.set(key, {
        expiresAt: Date.now() + CANDIDATE_CACHE_TTL_MS,
        rows,
      });
      return rows;
    } finally {
      candidateInFlight.delete(key);
    }
  }

  async hasTranscripts(): Promise<boolean> {
    const firstItem = await scanTranscripts({
      projection: ['interaction_id'],
      maxItems: 1,
      bypassCache: true,
    });
    return firstItem.length > 0;
  }

  async insertTranscript(row: TranscriptRow): Promise<boolean> {
    const created_at = row.created_at || new Date().toISOString();
    const interaction_id = asString(row.interaction_id);

    await getClient().send(
      new PutCommand({
        ConditionExpression: 'attribute_not_exists(interaction_id)',
        Item: {
          ...row,
          browse_pk: 'GLOBAL',
          created_at,
          interaction_id,
          raw_data: row.raw_data || null,
          tags: row.tags || null,
        },
        TableName: transcriptsTable(),
      })
    );

    return true;
  }

  async bulkInsertTranscripts(
    rows: TranscriptRow[]
  ): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const wasInserted = await this.insertTranscript(row);
        if (wasInserted) {
          inserted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    // Clear candidate cache so new transcripts appear immediately in calendar and charts
    if (inserted > 0) {
      candidateCache.clear();
      fullScanInFlight = null;
      logger.info('supportplane.store.cache_cleared', { inserted, reason: 'bulk_insert' });
    }

    return { inserted, skipped };
  }

  async queryTranscripts(filter: TranscriptFilter): Promise<TranscriptRow[]> {
    const filtered = (await this.getCandidates(filter))
      .filter((item) => matches(item as unknown as Record<string, unknown>, filter))
      .sort((left, right) => (right.created_at || '').localeCompare(left.created_at || ''));

    const offset = filter.offset || 0;
    const limit = filter.limit || filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  async browsePage(limit: number, offset: number): Promise<TranscriptRow[]> {
    const rows = await queryBrowseIndex(limit, offset);
    if (rows !== null) {
      return rows;
    }
    return this.queryTranscripts({ limit, offset });
  }

  async countTranscripts(filter: TranscriptFilter): Promise<number> {
    return (await this.getCandidates(filter)).filter((item) =>
      matches(item as unknown as Record<string, unknown>, filter)
    ).length;
  }

  async countAllTranscripts(): Promise<number> {
    return countTableScan({});
  }

  async countUntaggedTranscripts(): Promise<number> {
    return countTableScan({
      filterExpression:
        '(attribute_not_exists(#tags) OR #tags = :null) AND attribute_exists(#ft) AND #ft <> :empty',
      expressionNames: {
        '#tags': 'tags',
        '#ft': 'full_transcript',
      },
      expressionValues: {
        ':null': null,
        ':empty': '',
      },
    });
  }

  async getTranscriptFilterOptions(): Promise<{
    categories: string[];
    interaction_statuses: string[];
    sub_intents: string[];
    friction_points: string[];
    tags: string[];
  }> {
    // No projection — reuses the 15-min fullScanCache so this is instant on warm cache.
    // Projecting only 4 fields bypasses the shared cache and forces a 2-min fresh scan.
    const rows = await scanTranscripts({});
    const categories = new Set<string>();
    const statuses = new Set<string>();
    const tagsSet = new Set<string>();
    const subIntentSet = new Set<string>();
    const frictionPointSet = new Set<string>();

    for (const row of rows) {
      if (row.category) {
        categories.add(row.category);
      }
      if (row.interaction_status) {
        statuses.add(row.interaction_status);
      }
      if (Array.isArray(row.tags)) {
        row.tags.forEach((tag) => tagsSet.add(tag));
      } else if (typeof row.tags === 'string') {
        try {
          const tags = JSON.parse(row.tags) as string[];
          tags.forEach((tag) => tagsSet.add(tag));
        } catch {
          // skip invalid tags JSON
        }
      }

      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        if (data?.sub_intent && data.sub_intent !== 'N/A' && data.sub_intent !== '') {
          subIntentSet.add(data.sub_intent);
        }
        if (data?.friction_point && data.friction_point !== 'N/A' && data.friction_point !== '') {
          frictionPointSet.add(data.friction_point);
        }
      } catch {
        // skip invalid raw_data JSON
      }
    }

    return {
      categories: [...categories].sort(),
      interaction_statuses: [...statuses].sort(),
      sub_intents: [...subIntentSet].sort(),
      friction_points: [...frictionPointSet].sort(),
      tags: [...tagsSet].sort(),
    };
  }

  async getTranscriptById(interaction_id: string): Promise<TranscriptRow | null> {
    const normalizedId = asString(interaction_id);
    if (!normalizedId) {
      return null;
    }

    const result = await getClient().send(
      new QueryCommand({
        ExpressionAttributeValues: {
          ':interaction_id': normalizedId,
        },
        KeyConditionExpression: 'interaction_id = :interaction_id',
        Limit: 1,
        ScanIndexForward: false,
        TableName: transcriptsTable(),
      })
    );

    return (result.Items?.[0] as TranscriptRow) || null;
  }

  async updateTranscriptTags(interaction_id: string, tags: string[]): Promise<void> {
    const normalizedId = asString(interaction_id);
    const transcript = await this.getTranscriptById(normalizedId);
    if (!transcript?.created_at) {
      return;
    }

    await getClient().send(
      new UpdateCommand({
        ExpressionAttributeValues: {
          ':tags': tags,
        },
        Key: {
          created_at: transcript.created_at,
          interaction_id: normalizedId,
        },
        TableName: transcriptsTable(),
        UpdateExpression: 'SET tags = :tags',
      })
    );
  }

  async getExistingInteractionIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const item of await scanTranscripts()) {
      if (item.interaction_id) {
        ids.add(item.interaction_id);
      }
    }
    return ids;
  }

  async createUploadRecord(record: UploadRecord): Promise<void> {
    await getClient().send(
      new PutCommand({
        ConditionExpression: 'attribute_not_exists(upload_id)',
        Item: {
          ...record,
          row_count: record.row_count || 0,
          source: record.source || 'manual',
          tagging_status: 'pending',
          status_tagging: 'pending',
          uploaded_at: new Date().toISOString(),
        },
        TableName: uploadsTable(),
      })
    );
  }

  async updateUploadRecord(upload_id: string, updates: UploadUpdate): Promise<void> {
    const upload = await this.getUploadById(upload_id);
    if (!upload || typeof upload.uploaded_at !== 'string') {
      return;
    }

    const expressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    let idx = 0;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue;
      }
      const nameToken = `#f${idx}`;
      const valueToken = `:v${idx}`;
      expressions.push(`${nameToken} = ${valueToken}`);
      names[nameToken] = key;
      values[valueToken] = value;
      idx += 1;
    }

    if (!expressions.length) {
      return;
    }

    await getClient().send(
      new UpdateCommand({
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Key: {
          upload_id,
          uploaded_at: upload.uploaded_at,
        },
        TableName: uploadsTable(),
        UpdateExpression: `SET ${expressions.join(', ')}`,
      })
    );
  }

  async getUploadById(upload_id: string): Promise<Record<string, unknown> | null> {
    const query = await getClient().send(
      new QueryCommand({
        ExpressionAttributeValues: {
          ':upload_id': upload_id,
        },
        KeyConditionExpression: 'upload_id = :upload_id',
        Limit: 1,
        ScanIndexForward: false,
        TableName: uploadsTable(),
      })
    );
    return query.Items?.[0] || null;
  }

  async getUploadByHash(file_hash: string): Promise<Record<string, unknown> | null> {
    const query = await getClient().send(
      new QueryCommand({
        ExpressionAttributeValues: {
          ':file_hash': file_hash,
        },
        IndexName: 'fileHashIndex',
        KeyConditionExpression: 'file_hash = :file_hash',
        Limit: 1,
        ScanIndexForward: false,
        TableName: uploadsTable(),
      })
    );

    return query.Items?.[0] || null;
  }

  async checkDuplicateUpload(file_hash: string): Promise<Record<string, unknown> | null> {
    return this.getUploadByHash(file_hash);
  }

  async updateUploadTaggingStatus(
    upload_id: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    await this.updateUploadRecord(upload_id, { tagging_status: status });
  }

  async isTaggingActive(): Promise<boolean> {
    const result = await getClient().send(
      new QueryCommand({
        ExpressionAttributeValues: {
          ':status_tagging': 'pending',
        },
        IndexName: 'statusTaggingIndex',
        KeyConditionExpression: 'status_tagging = :status_tagging',
        Limit: 1,
        TableName: uploadsTable(),
      })
    );

    return Boolean(result.Items?.length);
  }

  async getUntagged(
    limit: number
  ): Promise<
    Array<{ interaction_id: string; full_transcript: string; conversation_summary: string | null }>
  > {
    return (await scanTranscripts())
      .filter(
        (item) =>
          (item.tags === null || item.tags === undefined) &&
          Boolean(item.full_transcript) &&
          item.full_transcript !== ''
      )
      .slice(0, limit)
      .map((item) => ({
        conversation_summary: item.conversation_summary || null,
        full_transcript: item.full_transcript,
        interaction_id: item.interaction_id,
      }));
  }

  async queryGrouped(
    days_back: number,
    group_by: string,
    limit: number
  ): Promise<QueryGroupResult[]> {
    const cutoff = createdAfter(days_back);
    const items = (await scanTranscripts()).filter((item) => (item.created_at || '') >= cutoff);

    if (group_by === 'tags') {
      return tagStats(items, limit);
    }

    if (!(group_by in GROUP_FIELDS)) {
      return [];
    }

    return groupStats(items, group_by as keyof typeof GROUP_FIELDS, limit);
  }

  async getFriction(days_back: number, limit: number): Promise<QueryGroupResult[]> {
    const cutoff = createdAfter(days_back);
    return frictionStats(
      (await scanTranscripts()).filter((item) => (item.created_at || '') >= cutoff),
      limit
    );
  }

  async getStats(days_back: number): Promise<TranscriptStatsResult> {
    const cutoff = createdAfter(days_back);
    const items = (await scanTranscripts()).filter((item) => (item.created_at || '') >= cutoff);

    const total_transcripts = items.length;
    const tagged_transcripts = items.filter(
      (item) => item.tags !== null && item.tags !== undefined
    ).length;
    const unresolved_count = items.filter(
      (item) => item.interaction_status === 'unresolved'
    ).length;
    const sentimentTotal = items.reduce(
      (total, item) => total + Number(item.sentiment_score || 0),
      0
    );
    const resolutionTotal = items.reduce(
      (total, item) => total + Number(item.resolution_time_seconds || 0),
      0
    );

    return {
      avg_resolution_time: total_transcripts ? resolutionTotal / total_transcripts : 0,
      avg_sentiment: total_transcripts ? sentimentTotal / total_transcripts : 0,
      tagged_transcripts,
      total_transcripts,
      untagged_transcripts: total_transcripts - tagged_transcripts,
      unresolved_count,
      unresolved_rate: total_transcripts ? (unresolved_count * 100) / total_transcripts : 0,
    };
  }
}
