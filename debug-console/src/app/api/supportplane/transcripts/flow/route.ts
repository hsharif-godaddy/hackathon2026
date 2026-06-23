/**
 * /api/supportplane/transcripts/flow
 * 3-way flow analysis: friction_point → sub_intent → resolution
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

    const allRows = await queryTranscripts({
      end_date: endDate,
      start_date: startDate,
    });

    const rowsWithRawData = allRows.filter((row) => row.raw_data !== null && row.raw_data !== undefined);

    logger.info('flow.query_complete', {
      total_rows: allRows.length,
      rows_with_raw_data: rowsWithRawData.length,
    });

    // Build 3-way flow matrix
    const flowCounts: Record<string, number> = {};
    let parsedCount = 0;
    let skippedCount = 0;

    rowsWithRawData.forEach(row => {
      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
        const friction = data.friction_point;
        const intent = data.sub_intent;
        const resolution = data.issue_resolution;

        // Normalize missing/empty values to "Unknown" for display
        const frictionNorm = (friction && friction !== 'N/A' && friction !== '') ? friction : 'Unknown';
        const intentNorm = (intent && intent !== 'N/A' && intent !== '') ? intent : 'Unknown';
        const resolutionNorm = (resolution && resolution !== 'N/A' && resolution !== '') ? resolution : 'Unknown';

        // Include flow if at least ONE field has meaningful data
        // (Don't show flows where ALL THREE are Unknown)
        if (frictionNorm !== 'Unknown' || intentNorm !== 'Unknown' || resolutionNorm !== 'Unknown') {
          const key = `${frictionNorm}|||${intentNorm}|||${resolutionNorm}`;
          flowCounts[key] = (flowCounts[key] || 0) + 1;
          parsedCount++;
        } else {
          skippedCount++;
        }
      } catch (error: unknown) {
        logger.warn('flow.parse_error', {
          error: error instanceof Error ? error.message : String(error),
          raw_data: row.raw_data
        });
        skippedCount++;
      }
    });

    logger.info('flow.processing_complete', {
      parsed: parsedCount,
      skipped: skippedCount,
      unique_flows: Object.keys(flowCounts).length,
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
      _debug: { parsed: parsedCount, skipped: skippedCount },
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
