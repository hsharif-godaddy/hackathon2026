import { NextResponse } from 'next/server';

import { getSummary, getAllApps, getToolStats, getHealthMetrics, getHourlyStats, getErrorStats, getHourlyErrorStats, getLast24HoursStats, getLast24HoursErrorStats, getSummarizationStats, getHourlySummarizationStats, getRollingHourlySummarizations, getPublishStats, getHourlyPublishStats, getRollingHourlyPublish, getClientErrorStats, getHourlyClientErrorStats, getRollingHourlyClientErrors, getDiagnostics, init } from '@/lib/analytics/es-db';
import { getSchedulerStatus, runBackfill, startScheduler, type BackfillIndexFilter } from '@/lib/analytics/scheduler';
import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const MAX_DATE_RANGE_DAYS = 31;

function validateDateRange(start?: string, end?: string): string | null {
  if (!start || !end) {return null;}
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return 'Invalid date format';
  }
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {return 'End date must be after start date';}
  if (diffDays > MAX_DATE_RANGE_DAYS) {return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`;}
  return null;
}

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    console.log('[analytics] Initializing ES indices and scheduler...');
    try {
      await init();
      startScheduler(30);
      initialized = true;
      console.log('[analytics] Initialization complete');
    } catch (error) {
      console.error('[analytics] Initialization failed:', error instanceof Error ? error.message : error);
      throw error;
    }
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

      case 'backfill': {
        const days = parseInt(searchParams.get('days') || '7', 10);
        if (days < 1 || days > 30) {
          return NextResponse.json({ error: 'days must be 1-30' }, { status: 400 });
        }
        const validIndices = ['all', 'errors', 'agent_runs', 'compressions', 'conversations', 'summarizations', 'tool_failures', 'publish_events', 'client_errors'];
        const indexParam = searchParams.get('index') || 'all';
        if (!validIndices.includes(indexParam)) {
          return NextResponse.json({ error: `index must be one of: ${validIndices.join(', ')}` }, { status: 400 });
        }
        return NextResponse.json(await runBackfill(days, indexParam as BackfillIndexFilter));
      }

      case 'hourly': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getHourlyStats(date));
      }

      case 'errors':
        return NextResponse.json(await getErrorStats(start, end));

      case 'hourly-errors': {
        const date = searchParams.get('date');
        const errorType = searchParams.get('errorType') as 'websocket' | 'budget' | null;
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        if (!errorType || !['websocket', 'budget'].includes(errorType)) {
          return NextResponse.json({ error: 'errorType parameter required (websocket or budget)' }, { status: 400 });
        }
        return NextResponse.json(await getHourlyErrorStats(date, errorType));
      }

      case 'last-24h':
        return NextResponse.json(await getLast24HoursStats());

      case 'last-24h-errors': {
        const errorType = searchParams.get('errorType') as 'websocket' | 'budget' | null;
        if (!errorType || !['websocket', 'budget'].includes(errorType)) {
          return NextResponse.json({ error: 'errorType parameter required (websocket or budget)' }, { status: 400 });
        }
        return NextResponse.json(await getLast24HoursErrorStats(errorType));
      }

      case 'summarizations':
        return NextResponse.json(await getSummarizationStats(start, end));

      case 'hourly-summarizations': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getHourlySummarizationStats(date));
      }

      case 'last-24h-summarizations':
        return NextResponse.json(await getRollingHourlySummarizations());

      case 'publish':
        return NextResponse.json(await getPublishStats(start || '', end || ''));

      case 'hourly-publish': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getHourlyPublishStats(date));
      }

      case 'last-24h-publish':
        return NextResponse.json(await getRollingHourlyPublish());

      case 'client-errors':
        return NextResponse.json(await getClientErrorStats(start, end));

      case 'hourly-client-errors': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getHourlyClientErrorStats(date));
      }

      case 'last-24h-client-errors':
        return NextResponse.json(await getRollingHourlyClientErrors());

      case 'diagnostics':
        return NextResponse.json(await getDiagnostics());

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[analytics] API error:', {
      action,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Failed to fetch analytics data', details: String(error) },
      { status: 500 }
    );
  }
});
