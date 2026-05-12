import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import {
  buildAvgSession,
  buildC1Bundle,
  buildDau,
  buildFunnel,
  buildSessions,
  buildTasksPerSession,
  buildWau,
  isC1Period,
  type C1Period,
} from '@/lib/c1-analytics-server';
import { getClickHouseC1Config } from '@/lib/clickhouse-c1-client';
import { routeCached } from '@/lib/route-cache';

function parsePeriod(sp: URLSearchParams, fallback: C1Period): C1Period | NextResponse {
  const raw = sp.get('period');
  if (!raw) return fallback;
  if (!isC1Period(raw)) {
    return NextResponse.json({ error: 'Invalid period. Use: day, week, 14days, 15days, month' }, { status: 400 });
  }
  return raw;
}

export const GET = withAuth(async (request, _auth) => {
  try {
    if (!getClickHouseC1Config()) {
      return NextResponse.json({ error: 'ClickHouse host not configured' }, { status: 500 });
    }

    const sp = request.nextUrl.searchParams;
    const action = sp.get('action') || 'bundle';

    if (action === 'dau') {
      const data = await routeCached('c1_dau', 300_000, () => buildDau());
      return NextResponse.json(data);
    }

    if (action === 'wau') {
      const data = await routeCached('c1_wau', 300_000, () => buildWau());
      return NextResponse.json(data);
    }

    if (action === 'funnel') {
      const period = parsePeriod(sp, 'week');
      if (period instanceof NextResponse) return period;
      const data = await routeCached(`c1_funnel_${period}`, 300_000, () => buildFunnel(period));
      return NextResponse.json(data);
    }

    if (action === 'sessions') {
      const period = parsePeriod(sp, 'day');
      if (period instanceof NextResponse) return period;
      const data = await routeCached(`c1_sessions_${period}`, 300_000, () => buildSessions(period));
      return NextResponse.json(data);
    }

    if (action === 'avg-session') {
      const period = parsePeriod(sp, 'day');
      if (period instanceof NextResponse) return period;
      const data = await routeCached(`c1_avg_session_${period}`, 300_000, () => buildAvgSession(period));
      return NextResponse.json(data);
    }

    if (action === 'tasks-per-session') {
      const period = parsePeriod(sp, 'week');
      if (period instanceof NextResponse) return period;
      const data = await routeCached(`c1_tasks_${period}`, 300_000, () => buildTasksPerSession(period));
      return NextResponse.json(data);
    }

    if (action === 'bundle') {
      const period = parsePeriod(sp, 'week');
      if (period instanceof NextResponse) return period;
      const data = await routeCached(`c1_bundle_${period}`, 300_000, () => buildC1Bundle(period));
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
