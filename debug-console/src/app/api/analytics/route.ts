import { NextResponse } from 'next/server';

import { getSummary, getAllApps, getToolStats, getHealthMetrics, getHourlyStats, init } from '@/lib/analytics/es-db';
import { getSchedulerStatus, startScheduler } from '@/lib/analytics/scheduler';
import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const MAX_DATE_RANGE_DAYS = 31;

function validateDateRange(start?: string, end?: string): string | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return 'Invalid date format';
  }
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'End date must be after start date';
  if (diffDays > MAX_DATE_RANGE_DAYS) return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`;
  return null;
}

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await init();
    startScheduler(30);
    initialized = true;
  }
}

export const GET = withAuth(async (request) => {
  await ensureInitialized();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'summary';
  const start = searchParams.get('start') || undefined;
  const end = searchParams.get('end') || undefined;

  const dateError = validateDateRange(start, end);
  if (dateError) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  try {
    switch (action) {
      case 'summary':
        return NextResponse.json(await getSummary(start, end));

      case 'apps':
        return NextResponse.json(await getAllApps(start, end));

      case 'tools':
        return NextResponse.json(await getToolStats(start, end));

      case 'health':
        return NextResponse.json(await getHealthMetrics());

      case 'scheduler-status':
        return NextResponse.json(getSchedulerStatus());

      case 'hourly': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getHourlyStats(date));
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics data', details: String(error) },
      { status: 500 }
    );
  }
});
