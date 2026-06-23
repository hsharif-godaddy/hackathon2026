/**
 * Bug detection logic for derived insights
 * Clusters transcripts by friction points and generates bug reports
 */

import { logger } from '@/lib/logger';
import { getStore } from '@/lib/supportplane/store';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { clusterBySimilarity, generateClusterId } from './clustering';
import { synthesizeBugTitle, synthesizeBugDescription } from './llm-synthesis';
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
 * Calculate business impact score
 * Formula: occurrence_count * (1 - resolution_rate) * preventable_rate
 */
function calculateImpactScore(cluster: Array<TranscriptRow>): number {
  const occurrenceCount: number = cluster.length;
  const resolvedCount: number = cluster.filter(
    t => extractRawData(t).issue_resolution === 'Yes'
  ).length;
  const preventableCount: number = cluster.filter(
    t => extractRawData(t).preventable_contact === 'Yes'
  ).length;

  const resolutionRate: number = occurrenceCount > 0 ? resolvedCount / occurrenceCount : 0;
  const preventableRate: number = occurrenceCount > 0 ? preventableCount / occurrenceCount : 0;

  return occurrenceCount * (1 - resolutionRate) * preventableRate;
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
 * Get unique tags from cluster
 */
function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

/**
 * Extract most common action from cluster
 */
function extractMostCommonAction(
  cluster: Array<TranscriptRow>,
  field: 'potential_preventative_action' | 'actionable_improvement_opportunity'
): string {
  const actions: string[] = cluster
    .map(t => extractRawData(t)[field])
    .filter(Boolean);

  if (actions.length === 0) return 'No action identified';

  return mostCommon(actions);
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
 * Generate bug insights from transcripts
 */
export async function generateBugInsights(dateRangeDays: number): Promise<void> {
  const startTime: number = Date.now();
  logger.info('insights.bugs.generate.start', { days_back: dateRangeDays });

  try {
    const store = getStore();
    const { startDate, endDate } = getDateRange(dateRangeDays);

    // Query all transcripts in date range
    logger.info('insights.bugs.query.start', { start_date: startDate, end_date: endDate });
    const transcripts: TranscriptRow[] = await store.queryTranscripts({
      start_date: startDate,
      end_date: endDate,
    });

    logger.info('insights.bugs.query.complete', { transcript_count: transcripts.length });

    // Filter for PLATFORM bug indicators (not user site issues)
    const bugTranscripts: TranscriptRow[] = transcripts.filter(t => {
      const rawData = extractRawData(t);
      const verbiage: string = (rawData.friction_point_verbiage || '').toLowerCase();
      const tags: string[] = t.tags || [];

      // Exclude user site-specific issues
      const isUserSiteIssue: boolean =
        verbiage.includes('my site') ||
        verbiage.includes('my website') ||
        verbiage.includes('my page') ||
        verbiage.includes('customer site') ||
        verbiage.includes('their site') ||
        verbiage.includes('domain') && verbiage.includes('not working') ||
        tags.some(tag => tag.includes('domain') || tag.includes('dns') || tag.includes('ssl'));

      if (isUserSiteIssue) return false;

      // Include PLATFORM bugs
      return (
        rawData.friction_point?.includes('Product bug') ||
        rawData.friction_point?.includes('Error message') ||
        rawData.friction_point?.includes('Website not working') ||
        rawData.friction_point?.includes('Technical issue') ||
        rawData.issue_resolution === 'No' ||
        verbiage.includes('editor') ||
        verbiage.includes('publish') ||
        verbiage.includes('login') ||
        verbiage.includes('authentication') ||
        verbiage.includes('ai') ||
        verbiage.includes('save') ||
        verbiage.includes('load')
      );
    });

    logger.info('insights.bugs.filter.complete', { bug_transcript_count: bugTranscripts.length });

    if (bugTranscripts.length === 0) {
      logger.info('insights.bugs.generate.complete', { cluster_count: 0, duration_ms: Date.now() - startTime });
      return;
    }

    // Cluster by similarity
    const clusters = clusterBySimilarity(
      bugTranscripts,
      (t: TranscriptRow) => {
        const rawData = extractRawData(t);
        return `${rawData.friction_point_verbiage || ''} ${t.tags?.join(' ') || ''}`;
      },
      {
        minClusterSize: 3,
        maxClusters: 20,
        similarityThreshold: 0.7,
      }
    );

    logger.info('insights.bugs.cluster.complete', { cluster_count: clusters.length });

    // Generate insights for each cluster
    const client = new InsightsClient();
    const insights: InsightRow[] = [];

    for (const cluster of clusters) {
      logger.info('insights.bugs.synthesize.start', {
        cluster_id: cluster.id,
        item_count: cluster.items.length,
      });

      // LLM synthesis
      const title: string = await synthesizeBugTitle(cluster);
      const description: string = await synthesizeBugDescription(cluster);

      // Calculate metrics
      const occurrenceCount: number = cluster.items.length;
      const resolvedCount: number = cluster.items.filter(
        t => extractRawData(t).issue_resolution === 'Yes'
      ).length;
      const preventableCount: number = cluster.items.filter(
        t => extractRawData(t).preventable_contact === 'Yes'
      ).length;
      const sentimentScores: number[] = cluster.items
        .map(t => t.sentiment_score)
        .filter((s): s is number => typeof s === 'number');

      const resolutionRate: number = occurrenceCount > 0 ? resolvedCount / occurrenceCount : 0;
      const preventableRate: number = occurrenceCount > 0 ? preventableCount / occurrenceCount : 0;
      const avgSentiment: number = sentimentScores.length > 0
        ? sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length
        : 0;

      // Extract context
      const productLines: string[] = cluster.items
        .map(t => extractRawData(t).airo_product_line as string)
        .filter((v): v is string => Boolean(v));
      const subIntents: string[] = cluster.items
        .map(t => extractRawData(t).sub_intent as string)
        .filter((v): v is string => Boolean(v));

      // Date range
      const createdDates: string[] = cluster.items
        .map(t => t.created_at)
        .filter((d): d is string => Boolean(d))
        .sort();
      const firstSeen: string = createdDates[0] || new Date().toISOString();
      const lastSeen: string = createdDates[createdDates.length - 1] || new Date().toISOString();

      // Recommended action
      const recommendedAction: string = extractMostCommonAction(
        cluster.items,
        'potential_preventative_action'
      );

      // Build insight
      const insight: InsightRow = {
        insight_key: `BUG#${generateClusterId(cluster.keywords, 'bug')}`,
        created_at: new Date().toISOString(),
        insight_type: 'BUG',
        insight_title: title,
        insight_description: description,
        occurrence_count: occurrenceCount,
        first_seen: firstSeen,
        last_seen: lastSeen,
        product_line: productLines.length > 0 ? mostCommon(productLines) : 'unknown',
        sub_intent: subIntents.length > 0 ? mostCommon(subIntents) : undefined,
        avg_sentiment: avgSentiment,
        resolution_rate: resolutionRate,
        preventable_rate: preventableRate,
        business_impact_score: calculateImpactScore(cluster.items),
        recommended_action: recommendedAction,
        related_tags: uniqueTags(cluster.items.flatMap(t => t.tags || [])),
        cluster_keywords: cluster.keywords,
        sample_transcript_ids: cluster.items.slice(0, 5).map(t => t.interaction_id),
        updated_at: new Date().toISOString(),
      };

      insights.push(insight);

      // Write to DynamoDB
      await client.putInsight(insight);

      logger.info('insights.bugs.synthesize.complete', {
        insight_key: insight.insight_key,
        title: insight.insight_title,
        occurrence_count: insight.occurrence_count,
        business_impact_score: insight.business_impact_score,
      });
    }

    logger.info('insights.bugs.generate.complete', {
      cluster_count: clusters.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('insights.bugs.generate.failed', {
      error: error instanceof Error ? error.message : String(error),
      days_back: dateRangeDays,
    });
    throw error;
  }
}
