/**
 * /api/supportplane/transcripts/analytics
 * Get analytics and aggregated stats for L1 transcripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    const db = getL1TranscriptsDb();

    // Build WHERE clause for date filtering
    let dateFilter = '';
    const params: any = {};
    if (startDate) {
      dateFilter += ' AND created_at >= @start_date';
      params.start_date = startDate;
    }
    if (endDate) {
      dateFilter += ' AND created_at <= @end_date';
      params.end_date = endDate;
    }

    // Total transcripts
    const totalResult = db.prepare(`SELECT COUNT(*) as count FROM l1_transcripts WHERE 1=1${dateFilter}`).get(params) as { count: number };
    const total = totalResult.count;

    // By category
    const categoryStats = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM l1_transcripts
      WHERE category IS NOT NULL AND category != ''${dateFilter}
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `).all(params) as Array<{ category: string; count: number }>;

    // By sentiment
    const sentimentStats = db.prepare(`
      SELECT
        CASE
          WHEN sentiment_score >= 0.7 THEN 'Positive'
          WHEN sentiment_score >= 0.4 THEN 'Neutral'
          ELSE 'Negative'
        END as sentiment,
        COUNT(*) as count
      FROM l1_transcripts
      WHERE sentiment_score IS NOT NULL${dateFilter}
      GROUP BY sentiment
    `).all(params) as Array<{ sentiment: string; count: number }>;

    // Top tags
    const transcriptsWithTags = db.prepare(`
      SELECT tags FROM l1_transcripts WHERE tags IS NOT NULL AND tags != '[]'${dateFilter}
    `).all(params) as Array<{ tags: string }>;

    const tagCounts: Record<string, number> = {};
    transcriptsWithTags.forEach(row => {
      try {
        const tags = JSON.parse(row.tags) as string[];
        tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      } catch {
        // Skip invalid JSON
      }
    });

    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));

    // Timeline - use created_at (from filename or CSV)
    const timelineQuery = startDate || endDate
      ? `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM l1_transcripts
         WHERE created_at IS NOT NULL${dateFilter}
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      : `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM l1_transcripts
         WHERE created_at IS NOT NULL
           AND created_at >= date('now', '-30 days')
         GROUP BY DATE(created_at)
         ORDER BY date ASC`;

    const timeline = db.prepare(timelineQuery).all(params) as Array<{ date: string; count: number }>;

    // Resolution stats
    const resolutionStats = db.prepare(`
      SELECT interaction_status, COUNT(*) as count
      FROM l1_transcripts
      WHERE interaction_status IS NOT NULL AND interaction_status != ''${dateFilter}
      GROUP BY interaction_status
    `).all(params) as Array<{ interaction_status: string; count: number }>;

    // Parse raw_data for sub_intent, friction_point, airo_product_line, issue_resolution
    const rawDataRows = db.prepare(`
      SELECT raw_data FROM l1_transcripts WHERE raw_data IS NOT NULL${dateFilter}
    `).all(params) as Array<{ raw_data: string }>;

    const subIntentCounts: Record<string, number> = {};
    const frictionPointCounts: Record<string, number> = {};
    const productLineCounts: Record<string, number> = {};
    const issueResolutionCounts: Record<string, number> = {};
    const inboundDriverCounts: Record<string, number> = {};

    rawDataRows.forEach(row => {
      try {
        const data = JSON.parse(row.raw_data);

        if (data.sub_intent && data.sub_intent !== 'N/A' && data.sub_intent !== '') {
          subIntentCounts[data.sub_intent] = (subIntentCounts[data.sub_intent] || 0) + 1;
        }

        if (data.friction_point && data.friction_point !== 'N/A' && data.friction_point !== '') {
          frictionPointCounts[data.friction_point] = (frictionPointCounts[data.friction_point] || 0) + 1;
        }

        if (data.airo_product_line && data.airo_product_line !== 'N/A' && data.airo_product_line !== '') {
          productLineCounts[data.airo_product_line] = (productLineCounts[data.airo_product_line] || 0) + 1;
        }

        if (data.issue_resolution && data.issue_resolution !== 'N/A' && data.issue_resolution !== '') {
          issueResolutionCounts[data.issue_resolution] = (issueResolutionCounts[data.issue_resolution] || 0) + 1;
        }

        if (data.inbound_volume_driver && data.inbound_volume_driver !== 'N/A' && data.inbound_volume_driver !== '') {
          inboundDriverCounts[data.inbound_volume_driver] = (inboundDriverCounts[data.inbound_volume_driver] || 0) + 1;
        }
      } catch {
        // Skip invalid JSON
      }
    });

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
    const allRows = db.prepare(`
      SELECT category, raw_data FROM l1_transcripts
      WHERE category IS NOT NULL AND category != '' AND raw_data IS NOT NULL${dateFilter}
    `).all(params) as Array<{ category: string; raw_data: string }>;

    // Helper to build heatmap matrix
    const buildHeatmap = (rows: Array<{ category: string; raw_data: string }>, rowField: string, colField: string) => {
      const matrix: Record<string, Record<string, number>> = {};
      rows.forEach(row => {
        try {
          const data = JSON.parse(row.raw_data);
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
    const frictionCategoryHeatmap = buildHeatmap(allRows, 'friction_point', 'category');

    // Friction Point × Resolution
    const frictionResolutionHeatmap = buildHeatmap(allRows, 'friction_point', 'issue_resolution');

    // Friction Point × Intent
    const frictionIntentHeatmap = buildHeatmap(allRows, 'friction_point', 'sub_intent');

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
