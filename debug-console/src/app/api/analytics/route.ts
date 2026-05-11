import { NextResponse } from 'next/server';

import { getPdnaHourlyStats, getPdnaSnapshot, type PdnaHourlyMetric, type PdnaTlaFilter } from '@/lib/analytics/pdna-db';

function parseTla(value: string | null): PdnaTlaFilter {
  if (value === 'tla' || value === 'all') return value;
  return 'non-tla';
}
import { getDateRangeError } from '@/lib/analytics/date-range';
import { getDirectBudgetErrorStats, getDirectClientErrorStats, getDirectHourlyBudgetErrorStats, getDirectHourlyClientErrorStats, getDirectHourlyUiAuthEventStats, getDirectLast1HourBudgetErrors, getDirectLast1HourClientErrors, getDirectLast1HourUiAuthEvents, getDirectRollingHourlyBudgetErrors, getDirectRollingHourlyClientErrors, getDirectRollingHourlyUiAuthEvents, getDirectUiAuthEventStats } from '@/lib/analytics/katana-client-errors';
import { getDirectHourlyPublishStats, getDirectHourlySummarizationStats, getDirectHourlyWebsocketErrorStats, getDirectLast1HourPublish, getDirectLast1HourSummarizations, getDirectLast1HourWebsocketErrors, getDirectPublishStats, getDirectRollingHourlyPublish, getDirectRollingHourlySummarizations, getDirectRollingHourlyWebsocketErrors, getDirectSummarizationStats, getDirectWebsocketErrorStats } from '@/lib/analytics/loki-events';
import { withAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, _auth) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'errors';
  const start = searchParams.get('start') || undefined;
  const end = searchParams.get('end') || undefined;

  const dateError = start && end ? getDateRangeError(start, end) : null;
  if (dateError) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  try {
    switch (action) {
      case 'errors': {
        const [websocket, budget] = await Promise.all([
          getDirectWebsocketErrorStats(start, end),
          getDirectBudgetErrorStats(start, end),
        ]);
        return NextResponse.json({ websocket, budget });
      }

      case 'budget-errors':
        return NextResponse.json(await getDirectBudgetErrorStats(start, end));

      case 'hourly-errors': {
        const date = searchParams.get('date');
        const errorType = searchParams.get('errorType') as 'websocket' | 'budget' | null;
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        if (!errorType || !['websocket', 'budget'].includes(errorType)) {
          return NextResponse.json({ error: 'errorType parameter required (websocket or budget)' }, { status: 400 });
        }
        if (errorType === 'budget') {
          return NextResponse.json(await getDirectHourlyBudgetErrorStats(date));
        }
        return NextResponse.json(await getDirectHourlyWebsocketErrorStats(date));
      }

      case 'last-24h-errors': {
        const errorType = searchParams.get('errorType') as 'websocket' | 'budget' | null;
        if (!errorType || !['websocket', 'budget'].includes(errorType)) {
          return NextResponse.json({ error: 'errorType parameter required (websocket or budget)' }, { status: 400 });
        }
        if (errorType === 'budget') {
          return NextResponse.json(await getDirectRollingHourlyBudgetErrors());
        }
        return NextResponse.json(await getDirectRollingHourlyWebsocketErrors());
      }

      case 'last-1h-errors': {
        const errorType = searchParams.get('errorType') as 'websocket' | 'budget' | null;
        if (!errorType || !['websocket', 'budget'].includes(errorType)) {
          return NextResponse.json({ error: 'errorType parameter required (websocket or budget)' }, { status: 400 });
        }
        if (errorType === 'budget') {
          return NextResponse.json(await getDirectLast1HourBudgetErrors());
        }
        return NextResponse.json(await getDirectLast1HourWebsocketErrors());
      }

      case 'summarizations':
        return NextResponse.json(await getDirectSummarizationStats(start, end));

      case 'hourly-summarizations': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getDirectHourlySummarizationStats(date));
      }

      case 'last-24h-summarizations':
        return NextResponse.json(await getDirectRollingHourlySummarizations());

      case 'last-1h-summarizations':
        return NextResponse.json(await getDirectLast1HourSummarizations());

      case 'publish':
        return NextResponse.json(await getDirectPublishStats(start, end));

      case 'hourly-publish': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getDirectHourlyPublishStats(date));
      }

      case 'last-24h-publish':
        return NextResponse.json(await getDirectRollingHourlyPublish());

      case 'last-1h-publish':
        return NextResponse.json(await getDirectLast1HourPublish());

      case 'client-errors':
        return NextResponse.json(await getDirectClientErrorStats(start, end));

      case 'hourly-client-errors': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getDirectHourlyClientErrorStats(date));
      }

      case 'last-24h-client-errors':
        return NextResponse.json(await getDirectRollingHourlyClientErrors());

      case 'last-1h-client-errors':
        return NextResponse.json(await getDirectLast1HourClientErrors());

      case 'ui-auth-events':
        return NextResponse.json(await getDirectUiAuthEventStats(start, end));

      case 'hourly-ui-auth-events': {
        const date = searchParams.get('date');
        if (!date) {
          return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        }
        return NextResponse.json(await getDirectHourlyUiAuthEventStats(date));
      }

      case 'last-24h-ui-auth-events':
        return NextResponse.json(await getDirectRollingHourlyUiAuthEvents());

      case 'last-1h-ui-auth-events':
        return NextResponse.json(await getDirectLast1HourUiAuthEvents());

      case 'pdna-snapshot': {
        const tla = parseTla(searchParams.get('tla'));
        const snapshot = await getPdnaSnapshot(tla);
        if (!snapshot) return NextResponse.json({ error: 'PDNA not configured or no data available' }, { status: 503 });
        return NextResponse.json(snapshot);
      }

      case 'hourly-pdna': {
        const date = searchParams.get('date');
        const metric = searchParams.get('metric') as PdnaHourlyMetric | null;
        const tla = parseTla(searchParams.get('tla'));
        if (!date) return NextResponse.json({ error: 'date parameter required' }, { status: 400 });
        if (!metric || !['created', 'deleted', 'unique_customers'].includes(metric)) {
          return NextResponse.json({ error: 'metric parameter required (created|deleted|unique_customers)' }, { status: 400 });
        }
        const hourly = await getPdnaHourlyStats(date, metric, tla);
        if (!hourly) return NextResponse.json({ error: 'PDNA not configured or no data available' }, { status: 503 });
        return NextResponse.json(hourly);
      }

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
