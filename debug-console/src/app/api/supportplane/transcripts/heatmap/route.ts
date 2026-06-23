/**
 * /api/supportplane/transcripts/heatmap
 * Dynamic heatmap for any two dimensions
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { queryTranscripts } from '@/lib/supportplane/db/l1-transcript-db';

const VALID_DIMENSIONS = [
  'category',
  'sub_intent',
  'friction_point',
  'airo_product_line',
  'issue_resolution',
  'inbound_volume_driver',
  'customer_sentiment',
  'agent_department',
  'call_type',
] as const;

async function handler(request: NextRequest) {
  try {
    if (request.method !== 'GET') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const rowDimension = searchParams.get('row_dimension');
    const colDimension = searchParams.get('col_dimension');
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    if (!rowDimension || !colDimension) {
      return NextResponse.json({ error: 'Missing row_dimension or col_dimension' }, { status: 400 });
    }

    if (!VALID_DIMENSIONS.includes(rowDimension as any) || !VALID_DIMENSIONS.includes(colDimension as any)) {
      return NextResponse.json({ error: 'Invalid dimension' }, { status: 400 });
    }

    const allRows = (await queryTranscripts({
      end_date: endDate,
      start_date: startDate,
    })).filter((row) => row.raw_data !== null && row.raw_data !== undefined);

    // Build heatmap matrix
    const matrix: Record<string, Record<string, number>> = {};

    allRows.forEach(row => {
      try {
        const data =
          typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;

        // Get row value
        const rowValue = rowDimension === 'category' ? row.category : data[rowDimension];

        // Get column value
        const colValue = colDimension === 'category' ? row.category : data[colDimension];

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

    // Convert to array format
    const heatmapData = Object.entries(matrix)
      .map(([row, cols]) => ({
        row_label: row,
        by_column: cols,
      }))
      .sort((a, b) => {
        // Sort by total count descending
        const aTotal = Object.values(a.by_column).reduce((sum, n) => sum + n, 0);
        const bTotal = Object.values(b.by_column).reduce((sum, n) => sum + n, 0);
        return bTotal - aTotal;
      });

    return NextResponse.json({
      success: true,
      heatmap: heatmapData,
      row_dimension: rowDimension,
      col_dimension: colDimension,
    });
  } catch (error) {
    logger.error('supportplane.transcripts.heatmap.error', { error: String(error) });
    return NextResponse.json(
      {
        error: 'Failed to generate heatmap',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
