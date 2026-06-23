/**
 * /api/supportplane/transcripts/analytics
 * Get analytics and aggregated stats for L1 transcripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/supportplane/db/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;
    const rows = await queryTranscripts({
      end_date: endDate,
      start_date: startDate,
    });
    const total = rows.length;

    const categoryCounts: Record<string, number> = {};
    const sentimentCounts: Record<string, number> = {};
    const allRowsForHeatmaps: Array<{ category: string; raw_data: unknown }> = [];
    const issueResolutionCounts: Record<string, number> = {};
    const frictionPointCounts: Record<string, number> = {};
    const inboundDriverCounts: Record<string, number> = {};
    const productLineCounts: Record<string, number> = {};
    const subIntentCounts: Record<string, number> = {};

    const tagCounts: Record<string, number> = {};
    rows.forEach(row => {
      if (row.category) {
        categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
      }

      if (typeof row.sentiment_score === 'number') {
        const sentiment = row.sentiment_score >= 0.7 ? 'Positive' : row.sentiment_score >= 0.4 ? 'Neutral' : 'Negative';
        sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;
      }

      try {
        const tags = Array.isArray(row.tags)
          ? row.tags
          : typeof row.tags === 'string'
            ? (JSON.parse(row.tags) as string[])
            : [];
        tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      } catch {
        // Skip invalid JSON
      }

      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        if (!data || typeof data !== 'object') {
          return;
        }

        if (row.category) {
          allRowsForHeatmaps.push({ category: row.category, raw_data: data });
        }

        if ((data as any).sub_intent && (data as any).sub_intent !== 'N/A' && (data as any).sub_intent !== '') {
          subIntentCounts[(data as any).sub_intent] = (subIntentCounts[(data as any).sub_intent] || 0) + 1;
        }

        if ((data as any).friction_point && (data as any).friction_point !== 'N/A' && (data as any).friction_point !== '') {
          frictionPointCounts[(data as any).friction_point] = (frictionPointCounts[(data as any).friction_point] || 0) + 1;
        }

        if ((data as any).airo_product_line && (data as any).airo_product_line !== 'N/A' && (data as any).airo_product_line !== '') {
          productLineCounts[(data as any).airo_product_line] = (productLineCounts[(data as any).airo_product_line] || 0) + 1;
        }

        if ((data as any).issue_resolution && (data as any).issue_resolution !== 'N/A' && (data as any).issue_resolution !== '') {
          issueResolutionCounts[(data as any).issue_resolution] = (issueResolutionCounts[(data as any).issue_resolution] || 0) + 1;
        }

        if ((data as any).inbound_volume_driver && (data as any).inbound_volume_driver !== 'N/A' && (data as any).inbound_volume_driver !== '') {
          inboundDriverCounts[(data as any).inbound_volume_driver] = (inboundDriverCounts[(data as any).inbound_volume_driver] || 0) + 1;
        }
      } catch {
        // Skip invalid JSON
      }
    });

    const categoryStats = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([category, count]) => ({ category, count }));
    const sentimentStats = Object.entries(sentimentCounts).map(([sentiment, count]) => ({ sentiment, count }));
    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));

    const timelineRows = startDate || endDate
      ? rows
      : rows.filter((row) => Boolean(row.created_at) && new Date(row.created_at as string).getTime() >= Date.now() - (30 * 24 * 60 * 60 * 1000));
    const timelineMap: Record<string, number> = {};
    timelineRows.forEach((row) => {
      if (!row.created_at) return;
      const date = row.created_at.slice(0, 10);
      timelineMap[date] = (timelineMap[date] || 0) + 1;
    });
    const timeline = Object.entries(timelineMap)
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));

    const resolutionMap: Record<string, number> = {};
    rows.forEach((row) => {
      if (row.interaction_status) {
        resolutionMap[row.interaction_status] = (resolutionMap[row.interaction_status] || 0) + 1;
      }
    });
    const resolutionStats = Object.entries(resolutionMap)
      .map(([interaction_status, count]) => ({ interaction_status, count }));

    const topSubIntents = Object.entries(subIntentCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const topFrictionPoints = Object.entries(frictionPointCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const productLines = Object.entries(productLineCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    const issueResolutions = Object.entries(issueResolutionCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    const inboundDrivers = Object.entries(inboundDriverCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Cross-dimensional heatmaps
    // Helper to build heatmap matrix
    const buildHeatmap = (rows: Array<{ category: string; raw_data: unknown }>, rowField: string, colField: string) => {
      const matrix: Record<string, Record<string, number>> = {};
      rows.forEach(row => {
        try {
          const data = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
          const rowValue = rowField === 'category' ? row.category : data[rowField];
          const colValue = colField === 'category' ? row.category : data[colField];

          if (rowValue && rowValue !== 'N/A' && rowValue !== '' &&
              colValue && colValue !== 'N/A' && colValue !== '') {
            if (!matrix[rowValue]) {
              matrix[rowValue] = {};
            }
            matrix[rowValue][colValue] = (matrix[rowValue][colValue] || 0) + 1;
          }
        } catch {
          // Skip invalid JSON
        }
      });
      return Object.entries(matrix).map(([row, cols]) => ({ row_label: row, by_column: cols }));
    };

    // Friction Point × Category
    const frictionCategoryHeatmap = buildHeatmap(allRowsForHeatmaps, 'friction_point', 'category');

    // Friction Point × Resolution
    const frictionResolutionHeatmap = buildHeatmap(allRowsForHeatmaps, 'friction_point', 'issue_resolution');

    // Friction Point × Intent
    const frictionIntentHeatmap = buildHeatmap(allRowsForHeatmaps, 'friction_point', 'sub_intent');

    return NextResponse.json({
      success: true,
      analytics: {
        total,
        by_category: categoryStats,
        by_sentiment: sentimentStats,
        top_tags: topTags,
        timeline,
        by_resolution: resolutionStats,
        by_sub_intent: topSubIntents,
        by_friction_point: topFrictionPoints,
        by_product_line: productLines,
        by_issue_resolution: issueResolutions,
        by_inbound_driver: inboundDrivers,
        friction_category_heatmap: frictionCategoryHeatmap,
        friction_resolution_heatmap: frictionResolutionHeatmap,
        friction_intent_heatmap: frictionIntentHeatmap,
      },
    });
  } catch (error) {
    logger.error('supportplane.transcripts.analytics.error', { error: String(error) });
    return NextResponse.json(
      {
        error: 'Failed to fetch analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
