/**
 * GET /api/supportplane/transcripts/calendar
 *
 * Returns calendar data showing which dates have transcripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

interface CalendarDay {
  date: string;
  count: number;
}

async function handler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString(), 10);

    const db = getL1TranscriptsDb();

    // Get transcript counts by date for the specified month
    const data = db.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM l1_transcripts
      WHERE strftime('%Y', created_at) = ?
        AND strftime('%m', created_at) = ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(year.toString(), month.toString().padStart(2, '0')) as CalendarDay[];

    // Get min/max dates for date range info
    const dateRange = db.prepare(`
      SELECT
        MIN(DATE(created_at)) as min_date,
        MAX(DATE(created_at)) as max_date,
        COUNT(*) as total
      FROM l1_transcripts
    `).get() as { min_date: string | null; max_date: string | null; total: number };

    logger.info('supportplane.transcripts.calendar.success', {
      year,
      month,
      days_with_data: data.length,
    });

    return NextResponse.json({
      success: true,
      year,
      month,
      days: data,
      dateRange,
    });
  } catch (error) {
    logger.error('supportplane.transcripts.calendar.error', {}, { error: error as Error });
    return NextResponse.json(
      {
        error: 'Failed to fetch calendar data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
