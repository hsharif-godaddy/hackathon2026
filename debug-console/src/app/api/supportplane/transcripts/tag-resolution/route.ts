/**
 * GET /api/supportplane/transcripts/tag-resolution
 *
 * Returns tag vs issue_resolution cross-tab for visualization
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

interface TagResolutionData {
  tag: string;
  total: number;
  resolved: number;
  unresolved: number;
  unknown: number;
  resolution_rate: number;
}

async function handler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const daysBack = parseInt(searchParams.get('days_back') || '30', 10);
    const minCount = parseInt(searchParams.get('min_count') || '3', 10);

    const db = getL1TranscriptsDb();

    // Get tag vs resolution data
    const data = db.prepare(`
      WITH tag_expanded AS (
        SELECT
          json_each.value as tag,
          CASE
            WHEN LOWER(interaction_status) IN ('resolved', 'yes') THEN 'resolved'
            WHEN LOWER(interaction_status) IN ('unresolved', 'no') THEN 'unresolved'
            ELSE 'unknown'
          END as resolution_status
        FROM l1_transcripts, json_each(l1_transcripts.tags)
        WHERE created_at >= datetime('now', '-${daysBack} days')
          AND tags IS NOT NULL
          AND json_each.value IS NOT NULL
      )
      SELECT
        tag,
        COUNT(*) as total,
        SUM(CASE WHEN resolution_status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN resolution_status = 'unresolved' THEN 1 ELSE 0 END) as unresolved,
        SUM(CASE WHEN resolution_status = 'unknown' THEN 1 ELSE 0 END) as unknown,
        ROUND(CAST(SUM(CASE WHEN resolution_status = 'resolved' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as resolution_rate
      FROM tag_expanded
      GROUP BY tag
      HAVING COUNT(*) >= ${minCount}
      ORDER BY total DESC
      LIMIT 20
    `).all() as TagResolutionData[];

    logger.info('supportplane.tag_resolution.success', {
      tags_count: data.length,
      days_back: daysBack,
    });

    return NextResponse.json({
      success: true,
      data,
      daysBack,
    });
  } catch (error) {
    logger.error('supportplane.tag_resolution.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to fetch tag resolution data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
