/**
 * Friction pattern analysis for derived insights
 * Groups transcripts by friction_point category and analyzes trends
 */

import { logger } from '@/lib/logger';
import { getStore } from '@/lib/supportplane/store';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { generateClusterId } from './clustering';
import { InsightsClient, type InsightRow } from '../supportplane/store/insights-client';

/**
 * Extract raw_data JSON from transcript
 */
function extractRawData(transcript: TranscriptRow): Record<string, any> {
  if (!transcript.raw_data) return {};

  // raw_data can be a Record (in-memory) or string (from DB)
  if (typeof transcript.raw_data === 'string') {
    try {
      return JSON.parse(transcript.raw_data);
    } catch {
      return {};
    }
  }

  return transcript.raw_data;
}

/**
 * Get most common value from array
 */
function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const val of values) {
    counts.set(val, (counts.get(val) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommonVal: T = values[0];
  for (const [val, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonVal = val;
    }
  }

  return mostCommonVal;
}

/**
 * Get unique tags from transcripts
 */
function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

/**
 * Get top N values by frequency
 */
function topN<T>(values: T[], n: number): T[] {
  const counts = new Map<T, number>();
  for (const val of values) {
    counts.set(val, (counts.get(val) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([val]) => val);
}

/**
 * Group transcripts by week
 */
function groupByWeek(transcripts: TranscriptRow[]): Map<string, TranscriptRow[]> {
  const weekGroups = new Map<string, TranscriptRow[]>();

  for (const t of transcripts) {
    if (!t.created_at) continue;

    const date: Date = new Date(t.created_at);
    const startOfWeek: Date = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay()); // Sunday
    const weekKey: string = startOfWeek.toISOString().split('T')[0];

    if (!weekGroups.has(weekKey)) {
      weekGroups.set(weekKey, []);
    }
    weekGroups.get(weekKey)!.push(t);
  }

  return weekGroups;
}

/**
 * Detect trend from weekly counts
 */
function detectTrend(weeklyCounts: Record<string, number>): 'increasing' | 'stable' | 'decreasing' {
  const weeks: string[] = Object.keys(weeklyCounts).sort();
  if (weeks.length < 2) return 'stable';

  const counts: number[] = weeks.map(w => weeklyCounts[w]);
  const firstHalf: number[] = counts.slice(0, Math.ceil(counts.length / 2));
  const secondHalf: number[] = counts.slice(Math.floor(counts.length / 2));

  const avgFirst: number = firstHalf.reduce((sum, c) => sum + c, 0) / firstHalf.length;
  const avgSecond: number = secondHalf.reduce((sum, c) => sum + c, 0) / secondHalf.length;

  const change: number = (avgSecond - avgFirst) / avgFirst;

  if (change > 0.2) return 'increasing';
  if (change < -0.2) return 'decreasing';
  return 'stable';
}

/**
 * Calculate date range from days back
 */
function getDateRange(daysBack: number): { startDate: string; endDate: string } {
  const endDate: Date = new Date();
  const startDate: Date = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Slugify category name for insight_key
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Generate friction pattern insights from transcripts
 */
export async function generateFrictionPatterns(dateRangeDays: number): Promise<void> {
  const startTime: number = Date.now();
  logger.info('insights.patterns.generate.start', { days_back: dateRangeDays });

  try {
    const store = getStore();
    const { startDate, endDate } = getDateRange(dateRangeDays);

    // Query all transcripts in date range
    logger.info('insights.patterns.query.start', { start_date: startDate, end_date: endDate });
    const transcripts: TranscriptRow[] = await store.queryTranscripts({
      start_date: startDate,
      end_date: endDate,
    });

    logger.info('insights.patterns.query.complete', { transcript_count: transcripts.length });

    if (transcripts.length === 0) {
      logger.info('insights.patterns.generate.complete', { pattern_count: 0, duration_ms: Date.now() - startTime });
      return;
    }

    // Group by friction_point category
    const categoryGroups = new Map<string, TranscriptRow[]>();

    for (const t of transcripts) {
      const rawData = extractRawData(t);
      const category: string = rawData.friction_point || 'Unknown';

      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, []);
      }
      categoryGroups.get(category)!.push(t);
    }

    logger.info('insights.patterns.group.complete', { category_count: categoryGroups.size });

    // Generate insights for each category
    const client = new InsightsClient();
    const insights: InsightRow[] = [];

    for (const [category, items] of categoryGroups) {
      if (items.length < 3) {
        // Skip small categories
        continue;
      }

      logger.info('insights.patterns.analyze.start', {
        category,
        item_count: items.length,
      });

      // Weekly counts
      const weekGroups = groupByWeek(items);
      const weeklyCounts: Record<string, number> = {};
      for (const [week, weekItems] of weekGroups) {
        weeklyCounts[week] = weekItems.length;
      }

      // Trend analysis
      const trend: 'increasing' | 'stable' | 'decreasing' = detectTrend(weeklyCounts);

      // Top friction point verbiage (top 10)
      const topVerbiage: string[] = topN(
        items.map(t => extractRawData(t).friction_point_verbiage).filter(Boolean),
        10
      );

      // Top preventative actions (top 3)
      const topActions: string[] = topN(
        items.map(t => extractRawData(t).potential_preventative_action).filter(Boolean),
        3
      );

      // Top improvement opportunities (top 3)
      const topOpportunities: string[] = topN(
        items.map(t => extractRawData(t).actionable_improvement_opportunity).filter(Boolean),
        3
      );

      // Calculate metrics
      const occurrenceCount: number = items.length;
      const resolvedCount: number = items.filter(
        t => extractRawData(t).issue_resolution === 'Yes'
      ).length;
      const preventableCount: number = items.filter(
        t => extractRawData(t).preventable_contact === 'Yes'
      ).length;
      const sentimentScores: number[] = items
        .map(t => t.sentiment_score)
        .filter((s): s is number => typeof s === 'number');

      const resolutionRate: number = occurrenceCount > 0 ? resolvedCount / occurrenceCount : 0;
      const preventableRate: number = occurrenceCount > 0 ? preventableCount / occurrenceCount : 0;
      const avgSentiment: number = sentimentScores.length > 0
        ? sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length
        : 0;

      // Business impact score (same formula as bugs)
      const businessImpactScore: number = occurrenceCount * (1 - resolutionRate) * preventableRate;

      // Extract context
      const productLines: string[] = items
        .map(t => extractRawData(t).airo_product_line as string)
        .filter((v): v is string => Boolean(v));
      const subIntents: string[] = items
        .map(t => extractRawData(t).sub_intent as string)
        .filter((v): v is string => Boolean(v));

      // Date range
      const createdDates: string[] = items
        .map(t => t.created_at)
        .filter((d): d is string => Boolean(d))
        .sort();
      const firstSeen: string = createdDates[0] || new Date().toISOString();
      const lastSeen: string = createdDates[createdDates.length - 1] || new Date().toISOString();

      // Build insight
      const insight: InsightRow = {
        insight_key: `PATTERN#${slugify(category)}`,
        created_at: new Date().toISOString(),
        insight_type: 'PATTERN',
        insight_title: `${category} Pattern`,
        insight_description: `Friction pattern for ${category} across ${occurrenceCount} interactions`,
        occurrence_count: occurrenceCount,
        first_seen: firstSeen,
        last_seen: lastSeen,
        product_line: productLines.length > 0 ? mostCommon(productLines) : 'unknown',
        sub_intent: subIntents.length > 0 ? mostCommon(subIntents) : undefined,
        avg_sentiment: avgSentiment,
        resolution_rate: resolutionRate,
        preventable_rate: preventableRate,
        business_impact_score: businessImpactScore,
        recommended_action: topActions.length > 0 ? topActions[0] : 'No action identified',
        related_tags: uniqueTags(items.flatMap(t => t.tags || [])),
        cluster_keywords: [category],
        sample_transcript_ids: items.slice(0, 5).map(t => t.interaction_id),
        updated_at: new Date().toISOString(),
        // Pattern-specific
        pattern_category: category,
        trend,
        weekly_counts: weeklyCounts,
        common_friction_points: topVerbiage,
        top_preventative_actions: topActions,
        top_improvement_opportunities: topOpportunities,
      };

      insights.push(insight);

      // Write to DynamoDB
      await client.putInsight(insight);

      logger.info('insights.patterns.analyze.complete', {
        insight_key: insight.insight_key,
        category,
        occurrence_count: insight.occurrence_count,
        trend,
      });
    }

    logger.info('insights.patterns.generate.complete', {
      pattern_count: insights.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('insights.patterns.generate.failed', {
      error: error instanceof Error ? error.message : String(error),
      days_back: dateRangeDays,
    });
    throw error;
  }
}
