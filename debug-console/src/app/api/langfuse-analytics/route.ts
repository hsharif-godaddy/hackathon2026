import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseAnalyticsConfig } from '@/lib/langfuse-analytics-client';
import {
  buildActionIntents,
  buildModel,
  buildOverview,
  buildPerformance,
  buildRecentErrors,
  buildSentiment,
  buildToolErrors,
  buildToolErrorsDaily,
  buildVerticals,
  emptyLangfuseActionIntents,
  emptyLangfuseModel,
  emptyLangfuseOverview,
  emptyLangfusePerformance,
  emptyLangfuseRecentErrors,
  emptyLangfuseSentiment,
  emptyLangfuseToolErrors,
  emptyLangfuseToolErrorsDaily,
  emptyLangfuseVerticals,
} from '@/lib/langfuse-analytics-server';
import { logger } from '@/lib/logger';
import { routeCached } from '@/lib/route-cache';

const LANGFUSE_BUNDLE_LABELS = [
  'overview',
  'sentiment',
  'actionIntents',
  'verticals',
  'performance',
  'toolErrors',
  'recentErrors',
  'model',
  'toolErrors24h',
  'toolErrorsDaily',
] as const;

export const GET = withAuth(async (request, _auth) => {
  try {
    if (!getLangfuseAnalyticsConfig()) {
      return NextResponse.json(
        { error: 'Langfuse analytics credentials not configured' },
        { status: 500 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const action = sp.get('action') || 'bundle';
    const fromTs = sp.get('fromTimestamp');
    const toTs = sp.get('toTimestamp');

    if (action !== 'model' && action !== 'recent-errors' && (!fromTs || !toTs)) {
      return NextResponse.json(
        { error: 'Missing fromTimestamp or toTimestamp' },
        { status: 400 },
      );
    }

    if (action === 'model') {
      const data = await routeCached('langfuse_analytics_model', 300_000, () => buildModel());
      return NextResponse.json(data);
    }

    if (action === 'recent-errors') {
      const fromIso = fromTs ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const toIso = toTs ?? new Date().toISOString();
      const data = await routeCached(
        `langfuse_analytics_recent_errors:${fromIso}:${toIso}`,
        60_000,
        () => buildRecentErrors(fromIso, toIso),
      );
      return NextResponse.json(data);
    }

    if (action === 'overview') {
      const data = await routeCached(`langfuse_overview:${fromTs}:${toTs}`, 120_000, () =>
        buildOverview(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'sentiment') {
      const data = await routeCached(`langfuse_sentiment:${fromTs}:${toTs}`, 120_000, () =>
        buildSentiment(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'action-intents') {
      const data = await routeCached(`langfuse_action_intents:${fromTs}:${toTs}`, 120_000, () =>
        buildActionIntents(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'verticals') {
      const data = await routeCached(`langfuse_verticals:${fromTs}:${toTs}`, 120_000, () =>
        buildVerticals(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'performance') {
      const data = await routeCached(`langfuse_perf:${fromTs}:${toTs}`, 120_000, () =>
        buildPerformance(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'tool-errors') {
      const data = await routeCached(`langfuse_tool_errors:${fromTs}:${toTs}`, 120_000, () =>
        buildToolErrors(fromTs!, toTs!),
      );
      return NextResponse.json(data);
    }

    if (action === 'bundle') {
      const data = await routeCached(`langfuse_bundle:${fromTs}:${toTs}`, 90_000, async () => {
        const from = fromTs!;
        const to = toTs!;
        const toMs = new Date(to).getTime();
        const from24h = new Date(toMs - 24 * 60 * 60 * 1000).toISOString();
        const settled = await Promise.allSettled([
          buildOverview(from, to),
          buildSentiment(from, to),
          buildActionIntents(from, to),
          buildVerticals(from, to),
          buildPerformance(from, to),
          buildToolErrors(from, to),
          buildRecentErrors(from, to),
          buildModel(),
          buildToolErrors(from24h, to),
          buildToolErrorsDaily(from, to),
        ]);

        const panelErrors: Partial<Record<(typeof LANGFUSE_BUNDLE_LABELS)[number], string>> = {};
        function take<T>(
          index: number,
          fallback: T,
          label: (typeof LANGFUSE_BUNDLE_LABELS)[number],
        ): T {
          const r = settled[index];
          if (r.status === 'fulfilled') return r.value as T;
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          panelErrors[label] = msg;
          logger.warn('langfuse.bundle.builder.failed', { panel: label, message: msg });
          return fallback;
        }

        const overview = take(0, emptyLangfuseOverview(from, to), 'overview');
        const sentiment = take(1, emptyLangfuseSentiment(from, to), 'sentiment');
        const actionIntents = take(2, emptyLangfuseActionIntents(from, to), 'actionIntents');
        const verticals = take(3, emptyLangfuseVerticals(from, to), 'verticals');
        const performance = take(4, emptyLangfusePerformance(from, to), 'performance');
        const toolErrors = take(5, emptyLangfuseToolErrors(from, to), 'toolErrors');
        const recentErrors = take(6, emptyLangfuseRecentErrors(from, to), 'recentErrors');
        const model = take(7, emptyLangfuseModel(), 'model');
        const toolErrors24h = take(8, emptyLangfuseToolErrors(from24h, to), 'toolErrors24h');
        const toolErrorsDaily = take(9, emptyLangfuseToolErrorsDaily(from, to), 'toolErrorsDaily');

        return {
          meta: {
            uiBaseUrl: getLangfuseAnalyticsConfig()?.uiBaseUrl ?? null,
            panelErrors: Object.keys(panelErrors).length > 0 ? panelErrors : undefined,
          },
          overview,
          sentiment,
          actionIntents,
          verticals,
          performance,
          toolErrors,
          recentErrors,
          model,
          toolErrors24h,
          toolErrorsDaily,
        };
      });
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
