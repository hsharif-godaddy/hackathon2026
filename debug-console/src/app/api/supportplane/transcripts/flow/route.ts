/**
 * /api/supportplane/transcripts/flow
 * 3-way flow analysis: friction_point → sub_intent → resolution
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

    // Fetch all rows with raw_data
    const allRows = db.prepare(`
      SELECT raw_data FROM l1_transcripts
      WHERE raw_data IS NOT NULL${dateFilter}
    `).all(params) as Array<{ raw_data: string }>;

    // Build 3-way flow matrix
    const flowCounts: Record<string, number> = {};

    allRows.forEach(row => {
      try {
        const data = JSON.parse(row.raw_data);
        const friction = data.friction_point;
        const intent = data.sub_intent;
        const resolution = data.issue_resolution;

        if (friction && friction !== 'N/A' && friction !== '' &&
            intent && intent !== 'N/A' && intent !== '' &&
            resolution && resolution !== 'N/A' && resolution !== '') {
          const key = `${friction}|||${intent}|||${resolution}`;
          flowCounts[key] = (flowCounts[key] || 0) + 1;
        }
      } catch {
        // Skip invalid JSON
      }
    });

    // Convert to array and sort by count
    const flowData = Object.entries(flowCounts)
      .map(([key, count]) => {
        const [friction_point, sub_intent, issue_resolution] = key.split('|||');
        return { friction_point, sub_intent, issue_resolution, count };
      })
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      flow: flowData,
    });
  } catch (error) {
    logger.error('supportplane.transcripts.flow.error', { error: String(error) });
    return NextResponse.json(
      {
        error: 'Failed to generate flow analysis',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
