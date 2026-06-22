/**
 * /api/supportplane/transcripts/flow
 * 3-way flow analysis: friction_point → sub_intent → resolution
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/l1-transcript-db';

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    const allRows = (await queryTranscripts({
      end_date: endDate,
      start_date: startDate,
    })).filter((row) => row.raw_data !== null && row.raw_data !== undefined);

    // Build 3-way flow matrix
    const flowCounts: Record<string, number> = {};

    allRows.forEach(row => {
      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
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
