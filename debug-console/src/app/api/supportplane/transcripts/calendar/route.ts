/**
 * GET /api/supportplane/transcripts/calendar
 *
 * Returns calendar data showing which dates have transcripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

interface CalendarDay {
  date: string;
  count: number;
}

async function handler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString(), 10);

    const allRows: TranscriptRow[] = await getAllTranscriptsCached();
    const targetMonth = month.toString().padStart(2, '0');
    const dayMap = new Map<string, number>();

    for (const row of allRows) {
      if (!row.created_at) {
        continue;
      }
      const date = row.created_at.slice(0, 10);
      if (date.slice(0, 4) !== year.toString() || date.slice(5, 7) !== targetMonth) {
        continue;
      }
      dayMap.set(date, (dayMap.get(date) || 0) + 1);
    }

    const data: CalendarDay[] = [...dayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));

    const dates = allRows
      .map((row) => row.created_at?.slice(0, 10))
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right));

    const dateRange = {
      max_date: dates.length ? dates[dates.length - 1] : null,
      min_date: dates.length ? dates[0] : null,
      total: allRows.length,
    };

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
