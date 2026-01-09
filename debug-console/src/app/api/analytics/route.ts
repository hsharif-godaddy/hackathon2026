import { NextResponse } from 'next/server';

import { getSummary, getAllApps, getToolStats, getHealthMetrics, init } from '@/lib/analytics/es-db';
import { getSchedulerStatus, startScheduler } from '@/lib/analytics/scheduler';
import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

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
