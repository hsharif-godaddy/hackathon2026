/**
 * Feature request detection logic for derived insights
 * Clusters transcripts by feature requests and generates business cases
 */

import { logger } from '@/lib/logger';
import { getStore } from '@/lib/supportplane/store';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { clusterBySimilarity, generateClusterId } from './clustering';
import { synthesizeFeatureTitle, synthesizeFeatureDescription, synthesizeBusinessCase, synthesizeRootCause } from './llm-synthesis';
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
 * Calculate business impact score for features
 * Formula: occurrence_count * conversion_signal_rate * (1 + sales_consultation_rate)
 */
function calculateFeatureImpactScore(cluster: Array<TranscriptRow>): number {
  const occurrenceCount: number = cluster.length;
  const conversionSignalCount: number = cluster.filter(
    t => extractRawData(t).conversion_signal === 'Yes'
  ).length;
  const salesConsultationCount: number = cluster.filter(
    t => extractRawData(t).sales_consultation === 'Yes'
  ).length;

  const conversionSignalRate: number = occurrenceCount > 0 ? conversionSignalCount / occurrenceCount : 0;
  const salesConsultationRate: number = occurrenceCount > 0 ? salesConsultationCount / occurrenceCount : 0;

  return occurrenceCount * conversionSignalRate * (1 + salesConsultationRate);
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
 * Extract sample customer quotes
 */
function extractCustomerQuotes(cluster: Array<TranscriptRow>, limit: number = 3): string[] {
  return cluster
    .slice(0, limit)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);
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
 * Check if cluster is actually a bug (post-clustering filter)
 */
function isBugCluster(keywords: string[]): boolean {
  const bugIndicators: string[] = [
    'refund',
    'broken',
    'constraint',
    'limit exceeded',
    'error',
    'failed',
    'unable',
    'not working',
  ];

  const title: string = keywords.join(' ').toLowerCase();
  return bugIndicators.some(indicator => title.includes(indicator));
}

/**
 * Generate feature request insights from transcripts
 */
export async function generateFeatureInsights(dateRangeDays: number): Promise<void> {
  const startTime: number = Date.now();
  logger.info('insights.features.generate.start', { days_back: dateRangeDays });

  try {
    const store = getStore();
    const { startDate, endDate } = getDateRange(dateRangeDays);

    // Query all transcripts in date range
    logger.info('insights.features.query.start', { start_date: startDate, end_date: endDate });
    const transcripts: TranscriptRow[] = await store.queryTranscripts({
      start_date: startDate,
      end_date: endDate,
    });

    logger.info('insights.features.query.complete', { transcript_count: transcripts.length });

    // Filter for PLATFORM feature request indicators (not user site features)
    const featureTranscripts: TranscriptRow[] = transcripts.filter(t => {
      const rawData = extractRawData(t);
      const verbiage: string = (rawData.friction_point_verbiage || '').toLowerCase();

      // Exclude user site-specific feature requests
      const isUserSiteFeature: boolean =
        verbiage.includes('my site') ||
        verbiage.includes('my website') ||
        verbiage.includes('add to my page') ||
        verbiage.includes('on my site');

      if (isUserSiteFeature) return false;

      // Include PLATFORM feature requests
      return (
        rawData.sub_intent === 'Product Fit / Missing Feature' ||
        t.tags?.some(tag => tag.includes('feature_request') || tag.includes('missing_feature')) ||
        rawData.friction_point?.includes('Missing feature') ||
        verbiage.includes('editor') ||
        verbiage.includes('builder') ||
        verbiage.includes('ai') ||
        verbiage.includes('template') ||
        verbiage.includes('publish') ||
        verbiage.includes('export')
      );
    });

    logger.info('insights.features.filter.complete', { feature_transcript_count: featureTranscripts.length });

    if (featureTranscripts.length === 0) {
      logger.info('insights.features.generate.complete', { cluster_count: 0, duration_ms: Date.now() - startTime });
      return;
    }

    // Cluster by similarity (lower minClusterSize for features)
    const clusters = clusterBySimilarity(
      featureTranscripts,
      (t: TranscriptRow) => {
        const rawData = extractRawData(t);
        return `${rawData.friction_point_verbiage || ''} ${t.tags?.join(' ') || ''}`;
      },
      {
        minClusterSize: 2,
        maxClusters: 20,
        similarityThreshold: 0.7,
      }
    );

    logger.info('insights.features.cluster.complete', { cluster_count: clusters.length });

    // Post-clustering bug filter
    const featureClusters = clusters.filter(cluster => !isBugCluster(cluster.keywords));

    logger.info('insights.features.bug_filter.complete', { feature_cluster_count: featureClusters.length });

    // Generate insights for each cluster
    const client = new InsightsClient();
    const insights: InsightRow[] = [];

    for (const cluster of featureClusters) {
      logger.info('insights.features.synthesize.start', {
        cluster_id: cluster.id,
        item_count: cluster.items.length,
      });

      // LLM synthesis
      const title: string = await synthesizeFeatureTitle(cluster);
      const description: string = await synthesizeFeatureDescription(cluster);
      const businessCase: string = await synthesizeBusinessCase(cluster);
      const rootCauseAnalysis = await synthesizeRootCause(cluster, 'FEATURE');

      // Calculate metrics
      const occurrenceCount: number = cluster.items.length;
      const resolvedCount: number = cluster.items.filter(
        t => extractRawData(t).issue_resolution === 'Yes'
      ).length;
      const preventableCount: number = cluster.items.filter(
        t => extractRawData(t).preventable_contact === 'Yes'
      ).length;
      const conversionSignalCount: number = cluster.items.filter(
        t => extractRawData(t).conversion_signal === 'Yes'
      ).length;
      const salesConsultationCount: number = cluster.items.filter(
        t => extractRawData(t).sales_consultation === 'Yes'
      ).length;
      const sentimentScores: number[] = cluster.items
        .map(t => t.sentiment_score)
        .filter((s): s is number => typeof s === 'number');

      const resolutionRate: number = occurrenceCount > 0 ? resolvedCount / occurrenceCount : 0;
      const preventableRate: number = occurrenceCount > 0 ? preventableCount / occurrenceCount : 0;
      const conversionSignalRate: number = occurrenceCount > 0 ? conversionSignalCount / occurrenceCount : 0;
      const salesConsultationRate: number = occurrenceCount > 0 ? salesConsultationCount / occurrenceCount : 0;
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

      // Sample customer quotes
      const sampleQuotes: string[] = extractCustomerQuotes(cluster.items);

      // Build insight
      const insight: InsightRow = {
        insight_key: `FEATURE#${generateClusterId(cluster.keywords, 'feature')}`,
        created_at: new Date().toISOString(),
        insight_type: 'FEATURE',
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
        business_impact_score: calculateFeatureImpactScore(cluster.items),
        recommended_action: 'Evaluate for product roadmap',
        related_tags: uniqueTags(cluster.items.flatMap(t => t.tags || [])),
        cluster_keywords: cluster.keywords,
        sample_transcript_ids: cluster.items.slice(0, 5).map(t => t.interaction_id),
        updated_at: new Date().toISOString(),
        // Feature-specific
        sales_consultation_rate: salesConsultationRate,
        conversion_signal_rate: conversionSignalRate,
        sample_customer_quotes: sampleQuotes,
        business_case: businessCase,
        root_cause_analysis: rootCauseAnalysis ? {
          causes: rootCauseAnalysis.what_airo_did_wrong.map(item => ({
            cause: item.issue,
            description: item.description,
            confidence: item.confidence,
          })),
          platform_area: rootCauseAnalysis.platform_area,
          codebase_locations: rootCauseAnalysis.codebase_locations,
          technical_details: rootCauseAnalysis.technical_details,
        } : undefined,
      };

      insights.push(insight);

      // Write to DynamoDB
      await client.putInsight(insight);

      logger.info('insights.features.synthesize.complete', {
        insight_key: insight.insight_key,
        title: insight.insight_title,
        occurrence_count: insight.occurrence_count,
        business_impact_score: insight.business_impact_score,
      });
    }

    logger.info('insights.features.generate.complete', {
      cluster_count: featureClusters.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('insights.features.generate.failed', {
      error: error instanceof Error ? error.message : String(error),
      days_back: dateRangeDays,
    });
    throw error;
  }
}
