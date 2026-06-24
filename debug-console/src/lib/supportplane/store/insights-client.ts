/**
 * DynamoDB client for insights table
 * Handles CRUD operations for bug/feature/pattern insights
 */

import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'node:https';

import { logger } from '@/lib/logger';
import { buildDynamoClient, getSpEnv } from '@/lib/supportplane/store/config';

export interface InsightRow {
  insight_key: string; // PK: "BUG#logo_auth_001" | "FEATURE#commerce_001" | "PATTERN#billing_001"
  created_at: string; // SK: ISO8601 timestamp
  insight_type: 'BUG' | 'FEATURE' | 'PATTERN'; // GSI1 PK
  insight_title: string;
  insight_description: string;

  // Aggregated metrics
  occurrence_count: number;
  first_seen: string;
  last_seen: string; // GSI1 SK

  // Context
  product_line: string; // GSI2 PK
  sub_intent?: string;

  // Impact metrics
  avg_sentiment: number;
  resolution_rate: number;
  preventable_rate: number;

  // Business intelligence
  business_impact_score: number; // GSI3 SK
  recommended_action: string;

  // Evidence
  related_tags: string[];
  cluster_keywords: string[];
  sample_transcript_ids: string[];

  // Metadata
  updated_at: string;

  // Feature-specific
  sales_consultation_rate?: number;
  conversion_signal_rate?: number;
  sample_customer_quotes?: string[];
  business_case?: string;

  // Pattern-specific
  pattern_category?: string;
  trend?: 'increasing' | 'stable' | 'decreasing';
  weekly_counts?: Record<string, number>;
  common_friction_points?: string[];
  top_preventative_actions?: string[];
  top_improvement_opportunities?: string[];
}

export interface QueryInsightOptions {
  sortBy?: 'last_updated' | 'occurrence_count' | 'business_impact_score';
  limit?: number;
  productLine?: string;
  createdAfter?: string; // ISO8601 timestamp - filter out insights created before this date
}

let client: DynamoDBDocumentClient | null = null;

// Simple cache (30s TTL)
interface CacheEntry {
  data: InsightRow[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000;

// Safety cap on rows drained per type partition before in-memory sort. Insights
// are clustered aggregates (tens–hundreds per type), so this bounds a runaway
// scan without truncating realistic result sets.
const MAX_INSIGHT_SCAN = 2000;

function getClient(): DynamoDBDocumentClient {
  if (client) {
    return client;
  }

  client = buildDynamoClient(
    {
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({
          keepAlive: true,
          maxSockets: 50,
        }),
      }),
    },
    {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
    }
  );

  return client;
}

function getInsightsTableName(): string {
  return `airo-builde-supportplane-insights-${getSpEnv()}`;
}

function getCacheKey(key: string): string {
  return key;
}

function getFromCache(key: string): InsightRow[] | null {
  const entry: CacheEntry | undefined = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: InsightRow[]): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export class InsightsClient {
  /**
   * Collapse the append-per-run history to the latest aggregate per cluster.
   *
   * The insights table is keyed (insight_key, created_at): each generation run
   * appends a fresh row (created_at = run time) rather than overwriting, so a
   * single cluster accumulates one row per run. Reads keep only the most-recent
   * created_at per insight_key to present one current aggregate per cluster.
   */
  private dedupeLatestByKey(rows: InsightRow[]): InsightRow[] {
    const latestByKey: Map<string, InsightRow> = new Map<string, InsightRow>();
    for (const row of rows) {
      const existing: InsightRow | undefined = latestByKey.get(row.insight_key);
      if (!existing || row.created_at > existing.created_at) {
        latestByKey.set(row.insight_key, row);
      }
    }
    return Array.from(latestByKey.values());
  }

  /**
   * Write an insight to DynamoDB
   */
  async putInsight(insight: InsightRow): Promise<void> {
    const tableName: string = getInsightsTableName();
    const client: DynamoDBDocumentClient = getClient();

    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: insight,
        })
      );

      logger.info('insights.put.success', {
        insight_key: insight.insight_key,
        insight_type: insight.insight_type,
      });
    } catch (error) {
      logger.error('insights.put.failed', {
        error: error instanceof Error ? error.message : String(error),
        insight_key: insight.insight_key,
      });
      throw error;
    }
  }

  /**
   * Query insights by type (uses GSI1: insightTypeIndex)
   */
  async queryInsightsByType(
    insightType: 'BUG' | 'FEATURE' | 'PATTERN',
    options?: QueryInsightOptions
  ): Promise<InsightRow[]> {
    const cacheKey: string = getCacheKey(`type:${insightType}:${JSON.stringify(options || {})}`);
    const cached: InsightRow[] | null = getFromCache(cacheKey);
    if (cached) return cached;

    const tableName: string = getInsightsTableName();
    const client: DynamoDBDocumentClient = getClient();
    const limit: number = options?.limit ?? 50;

    try {
      // Drain the full type partition (insights are low-cardinality clustered
      // aggregates) so the in-memory sort below ranks across every row, not
      // just the most-recent `limit` page. Without this, "top N by impact"
      // would be "N most-recent rows, re-sorted".
      const insights: InsightRow[] = [];
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const queryInput: QueryCommandInput = {
          TableName: tableName,
          IndexName: 'insightTypeIndex',
          KeyConditionExpression: 'insight_type = :type',
          ExpressionAttributeValues: {
            ':type': insightType,
          },
          ScanIndexForward: false, // DESC by last_seen
          ExclusiveStartKey: lastEvaluatedKey,
        };

        const result = await client.send(new QueryCommand(queryInput));
        insights.push(...((result.Items as InsightRow[]) ?? []));
        lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey && insights.length < MAX_INSIGHT_SCAN);

      // Collapse the per-run history to one current row per cluster before
      // filtering/ranking, otherwise duplicate rows inflate counts and cards.
      const deduped: InsightRow[] = this.dedupeLatestByKey(insights);

      // Filter by product line if requested
      let filtered: InsightRow[] = options?.productLine
        ? deduped.filter(i => i.product_line === options.productLine)
        : deduped;

      // Filter by creation date if requested (used to hide old duplicate insights)
      if (options?.createdAfter) {
        filtered = filtered.filter(i => i.created_at >= options.createdAfter!);
      }

      // Sort the full set, then slice to the requested limit. 'last_updated'
      // (and the default) keep the GSI's recency ordering.
      if (options?.sortBy === 'occurrence_count') {
        filtered.sort((a, b) => b.occurrence_count - a.occurrence_count);
      } else if (options?.sortBy === 'business_impact_score') {
        filtered.sort((a, b) => b.business_impact_score - a.business_impact_score);
      }

      const limited: InsightRow[] = filtered.slice(0, limit);

      setCache(cacheKey, limited);
      return limited;
    } catch (error) {
      logger.error('insights.query.type.failed', {
        error: error instanceof Error ? error.message : String(error),
        insight_type: insightType,
      });
      return [];
    }
  }

  /**
   * Query insights by product line (uses GSI2: productLineIndex)
   */
  async queryInsightsByProductLine(
    productLine: string,
    options?: { limit?: number }
  ): Promise<InsightRow[]> {
    const cacheKey: string = getCacheKey(`product:${productLine}:${options?.limit ?? 50}`);
    const cached: InsightRow[] | null = getFromCache(cacheKey);
    if (cached) return cached;

    const tableName: string = getInsightsTableName();
    const client: DynamoDBDocumentClient = getClient();
    const limit: number = options?.limit ?? 50;

    try {
      // Drain the partition before dedup so per-run duplicate rows don't
      // consume the limit ahead of distinct clusters.
      const rows: InsightRow[] = [];
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const queryInput: QueryCommandInput = {
          TableName: tableName,
          IndexName: 'productLineIndex',
          KeyConditionExpression: 'product_line = :product',
          ExpressionAttributeValues: {
            ':product': productLine,
          },
          ScanIndexForward: false, // DESC by occurrence_count
          ExclusiveStartKey: lastEvaluatedKey,
        };

        const result = await client.send(new QueryCommand(queryInput));
        rows.push(...((result.Items as InsightRow[]) ?? []));
        lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey && rows.length < MAX_INSIGHT_SCAN);

      const deduped: InsightRow[] = this.dedupeLatestByKey(rows);
      deduped.sort((a, b) => b.occurrence_count - a.occurrence_count);
      const limited: InsightRow[] = deduped.slice(0, limit);

      setCache(cacheKey, limited);
      return limited;
    } catch (error) {
      logger.error('insights.query.productLine.failed', {
        error: error instanceof Error ? error.message : String(error),
        product_line: productLine,
      });
      return [];
    }
  }

  /**
   * Query top impact insights (uses GSI3: impactScoreIndex)
   */
  async queryTopImpactInsights(
    insightType: 'BUG' | 'FEATURE' | 'PATTERN',
    limit: number
  ): Promise<InsightRow[]> {
    const cacheKey: string = getCacheKey(`impact:${insightType}:${limit}`);
    const cached: InsightRow[] | null = getFromCache(cacheKey);
    if (cached) return cached;

    const tableName: string = getInsightsTableName();
    const client: DynamoDBDocumentClient = getClient();

    try {
      // Drain then dedup so duplicate per-run rows for the same cluster don't
      // crowd out distinct clusters within the requested limit.
      const rows: InsightRow[] = [];
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const queryInput: QueryCommandInput = {
          TableName: tableName,
          IndexName: 'impactScoreIndex',
          KeyConditionExpression: 'insight_type = :type',
          ExpressionAttributeValues: {
            ':type': insightType,
          },
          ScanIndexForward: false, // DESC by business_impact_score
          ExclusiveStartKey: lastEvaluatedKey,
        };

        const result = await client.send(new QueryCommand(queryInput));
        rows.push(...((result.Items as InsightRow[]) ?? []));
        lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey && rows.length < MAX_INSIGHT_SCAN);

      const deduped: InsightRow[] = this.dedupeLatestByKey(rows);
      deduped.sort((a, b) => b.business_impact_score - a.business_impact_score);
      const limited: InsightRow[] = deduped.slice(0, limit);

      setCache(cacheKey, limited);
      return limited;
    } catch (error) {
      logger.error('insights.query.impact.failed', {
        error: error instanceof Error ? error.message : String(error),
        insight_type: insightType,
      });
      return [];
    }
  }
}
