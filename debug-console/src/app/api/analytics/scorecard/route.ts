import { NextResponse } from 'next/server';

import { c1Query, getClickHouseC1Config } from '@/lib/clickhouse-c1-client';
import { getScorecardS3Data, getScorecardFeedbackComments, streamScorecardS3Feed } from '@/lib/analytics/scorecard/s3-feedback';
import { getScorecardLokiData } from '@/lib/analytics/scorecard/loki';
import { getJourneyData, getJourneySessions, getJourneySessionEvents } from '@/lib/analytics/scorecard/fs-journey';
import { routeCached, setRouteCache } from '@/lib/route-cache';
import { scorecardCached } from '@/lib/analytics/scorecard/cache';
import { getDateRangeError, RANGE_DAYS } from '@/lib/analytics/date-range';
import { getPdnaSnapshot } from '@/lib/analytics/pdna-db';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

const BMP_ENDPOINT = process.env['BMP_ENDPOINT'] ?? 'https://metric-api.bmp.api.int.godaddy.com/api/v1/gql';

type BmpKV = { name: string; value: number };

const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BMP_SAFE_RE = /^[a-zA-Z0-9_\-.]+$/;
const BMP_ALLOWED_OPERATIONS = new Set(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);
const BMP_ALLOWED_PERIODS = new Set(['HOUR', 'DAY', 'WEEK', 'MONTH']);

function parseBmpParam(value: string | null, fallback: string): string {
  return value !== null && BMP_SAFE_RE.test(value) ? value : fallback;
}

function parseBmpMeasures(value: string | null, fallback: string[]): string[] {
  if (!value) return fallback;
  const parsed: string[] = value.split(',').map((m) => m.trim()).filter((m) => BMP_SAFE_RE.test(m) && m.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function parseBmpOperation(value: string | null): string {
  const v: string = (value ?? '').toUpperCase();
  return BMP_ALLOWED_OPERATIONS.has(v) ? v : 'SUM';
}

function parseBmpPeriod(value: string | null): string {
  const v: string = (value ?? '').toUpperCase();
  return BMP_ALLOWED_PERIODS.has(v) ? v : 'WEEK';
}

type BmpMetricRow = {
  dimensions: BmpKV[];
  aggregatedSummary: BmpKV[];
  intervals: Array<{ startTime: string; endTime: string; intervalSummary: BmpKV[] }>;
};

type BmpResponseShape = {
  data?: { metricRequest?: { metrics?: BmpMetricRow[] } };
  errors?: Array<{ message: string }>;
};

const SCORECARD_WEBSITE_CORE_MEASURES: readonly string[] = [
  'context_gathering_started', 'context_gathering_completed',
  'initial_build_started', 'initial_build_completed', 'generation_triggered',
  'chat_start', 'chat_complete', 'chat_failed', 'chat_submit',
  'chat_delete', 'chat_reorder', 'chat_undo',
  'edit_triggered', 'rebuild_started', 'inline_edit',
  'publish_attempt', 'publish_failed', 'first_publish_success',
  'republish_success', 'publish_button_click', 'prompt_stop',
];

const SCORECARD_WEBSITE_DIM_MEASURES: readonly string[] = [
  'initial_build_completed', 'initial_build_started', 'publish_attempt', 'first_publish_success',
];

const SCORECARD_PAYWALL_MEASURES: readonly string[] = [
  'paywall_view', 'purchase_success', 'purchase_starter', 'purchase_professional', 'purchase_ultimate',
  'credits_purchase', 'plan_cancellation', 'downgrade_scheduled', 'suspended_nonpayment',
  'upgrade_banner_view', 'upgrade_banner_click', 'upgrade_banner_dismiss',
];

interface BmpQueryOpts {
  metricId: string;
  namespace: string;
  measures: readonly string[];
  period: string;
  operation: string;
  dimensions: readonly string[];
  range: string;
  csStart: string | undefined;
  csEnd: string | undefined;
}

async function runBmpQuery(
  token: string,
  opts: BmpQueryOpts,
): Promise<{ configMissing: false; metrics: BmpMetricRow[] } | { configMissing: false; error: string }> {
  const endDate = opts.csEnd
    ? `${opts.csEnd}T23:59:59.000Z`
    : new Date().toISOString();
  const startDate = opts.csStart
    ? `${opts.csStart}T00:00:00.000Z`
    : (() => {
      const n: number = RANGE_DAYS[opts.range] ?? 7;
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    })();

  const gqlBody = JSON.stringify({
    query: `{
  metricRequest(where: {
    metricId: "${opts.metricId}"
    namespace: "${opts.namespace}"
    startDate: "${startDate}"
    endDate: "${endDate}"
    operation: ${opts.operation}
    period: ${opts.period}
    dimensions: [${[...opts.dimensions].map((d) => `{name: "${d}"}`).join(', ')}]
    measures: [${[...opts.measures].map((m) => `"${m}"`).join(', ')}]
  }) {
    metrics {
      dimensions { name value }
      aggregatedSummary { name value }
      intervals {
        startTime
        endTime
        intervalSummary { name value }
      }
    }
  }
}`,
  });

  const measuresStr = [...opts.measures].sort().join(',');
  const dimensionsStr = [...opts.dimensions].sort().join(',');
  const bmpCacheKey = opts.csStart && opts.csEnd
    ? `scorecard_bmp_${opts.metricId}_${opts.namespace}_${measuresStr}_${dimensionsStr}_${opts.csStart}_${opts.csEnd}_${opts.period}_${opts.operation}`
    : `scorecard_bmp_${opts.metricId}_${opts.namespace}_${measuresStr}_${dimensionsStr}_${opts.range}_${opts.period}_${opts.operation}`;

  try {
    const metrics = await scorecardCached(bmpCacheKey, 300_000, async () => {
      const res = await fetch(BMP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `sso-jwt ${token}` },
        body: gqlBody,
      });
      if (!res.ok) throw new Error(`BMP HTTP ${res.status}`);
      const json = await res.json() as BmpResponseShape;
      if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
      return json.data?.metricRequest?.metrics ?? [];
    }, 60_000);
    return { configMissing: false, metrics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { configMissing: false, error: msg };
  }
}

export const dynamic = 'force-dynamic';

void scorecardCached('scorecard_loki_7d', 300_000, () => getScorecardLokiData('7d'), 60_000);
void getScorecardS3Data(new URLSearchParams('days=7'));

export const GET = withAuth(async (request, _auth) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? '';

  try {
    switch (action) {
      case 'datasource-status': {
        return NextResponse.json({
          pdna: { configured: !!(process.env.PDNA_ES_ENDPOINT && process.env.PDNA_ES_API_KEY) },
          s3: { configured: !!process.env.FEEDBACK_S3_BUCKET },
          loki: { configured: !!process.env.LOKI_ENDPOINT },
          bmp: { configured: !!request.cookies.get('auth_jomax')?.value },
          fullstory: { configured: !!process.env.FULLSTORY_API_KEY },
          c1: { configured: !!getClickHouseC1Config() },
        });
      }

      case 'journey': {
        if (!process.env.FULLSTORY_API_KEY) {
          return NextResponse.json({ error: 'FULLSTORY_API_KEY not configured' }, { status: 503 });
        }
        const journeyAppId = searchParams.get('appId');
        if (!journeyAppId) {
          return NextResponse.json({ error: 'appId is required' }, { status: 400 });
        }
        if (!APP_ID_RE.test(journeyAppId.trim())) {
          return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
        }
        const rawDays = Number(searchParams.get('lookbackDays'));
        const lookbackDays: number = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(365, rawDays) : 365;
        const journeyData = await getJourneyData(journeyAppId.trim(), lookbackDays);
        if (journeyData.totalSessions === 0) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }
        return NextResponse.json(journeyData, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'journey-list': {
        if (!process.env.FULLSTORY_API_KEY) {
          return NextResponse.json({ error: 'FULLSTORY_API_KEY not configured' }, { status: 503 });
        }
        const listAppId = searchParams.get('appId');
        if (!listAppId) return NextResponse.json({ error: 'appId is required' }, { status: 400 });
        if (!APP_ID_RE.test(listAppId.trim())) return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
        const rawListDays = Number(searchParams.get('lookbackDays'));
        const listLookback: number = Number.isFinite(rawListDays) && rawListDays > 0 ? Math.min(365, rawListDays) : 365;
        // Pagination params — only present on subsequent page requests.
        const rawPageToken = searchParams.get('pageToken') ?? undefined;
        const rawSegmentId = searchParams.get('segmentId') ?? undefined;
        // Opaque cursors from FullStory can contain base64/URL-safe chars; allow a generous set.
        const PAGE_TOKEN_RE = /^[A-Za-z0-9+/=_:.-]{1,512}$/;
        const SEGMENT_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
        if (rawPageToken && !PAGE_TOKEN_RE.test(rawPageToken)) {
          return NextResponse.json({ error: 'Invalid pageToken' }, { status: 400 });
        }
        if (rawSegmentId && !SEGMENT_ID_RE.test(rawSegmentId)) {
          return NextResponse.json({ error: 'Invalid segmentId' }, { status: 400 });
        }
        const listData = await getJourneySessions(listAppId.trim(), listLookback, rawPageToken, rawSegmentId);
        // Only 404 on the first page (no pageToken); subsequent pages returning 0 sessions is valid.
        if (!rawPageToken && listData.totalSessions === 0) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }
        return NextResponse.json(listData, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'journey-session': {
        if (!process.env.FULLSTORY_API_KEY) {
          return NextResponse.json({ error: 'FULLSTORY_API_KEY not configured' }, { status: 503 });
        }
        const rawDeviceId = searchParams.get('deviceId') ?? '';
        const rawSessionId = searchParams.get('sessionId') ?? '';
        const rawSessionUrl = searchParams.get('sessionUrl') ?? undefined;
        const SAFE_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
        if (!SAFE_ID_RE.test(rawDeviceId) || !SAFE_ID_RE.test(rawSessionId)) {
          return NextResponse.json({ error: 'Invalid deviceId or sessionId' }, { status: 400 });
        }
        const sessionData = await getJourneySessionEvents(rawDeviceId, rawSessionId, rawSessionUrl);
        if (!sessionData) return NextResponse.json({ error: 'not_found' }, { status: 404 });
        return NextResponse.json(sessionData, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'bmp-feedback': {
        const bmpToken: string | undefined = request.cookies.get('auth_jomax')?.value;
        if (!bmpToken) {
          return NextResponse.json({ configMissing: true }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const bmpRange = searchParams.get('range') ?? '7d';
        const csStart = searchParams.get('start') ?? undefined;
        const csEnd = searchParams.get('end') ?? undefined;
        if ((csStart && !csEnd) || (!csStart && csEnd)) {
          return NextResponse.json({ error: 'Custom range requires both start and end' }, { status: 400 });
        }
        if (csStart && csEnd) {
          const rangeErr = getDateRangeError(csStart, csEnd);
          if (rangeErr) return NextResponse.json({ error: rangeErr }, { status: 400 });
        }

        const metricId = parseBmpParam(searchParams.get('metricId'), 'agent_feedback_count');
        const namespace = parseBmpParam(searchParams.get('namespace'), 'agent-observability');
        const measures = parseBmpMeasures(searchParams.get('measures'), ['positive_count', 'negative_count', 'total_count']);
        const period = parseBmpPeriod(searchParams.get('period'));
        const operation = parseBmpOperation(searchParams.get('operation'));
        const dimensions: string[] = (searchParams.get('dimensions') ?? '').split(',').map((d) => d.trim()).filter((d) => BMP_SAFE_RE.test(d) && d.length > 0);

        const result = await runBmpQuery(bmpToken, { metricId, namespace, measures, period, operation, dimensions, range: bmpRange, csStart, csEnd });
        const httpStatus = 'error' in result ? 502 : 200;
        return NextResponse.json(result, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
      }

      case 'loki': {
        const range = searchParams.get('range') ?? '7d';
        const csStart = searchParams.get('start') ?? undefined;
        const csEnd = searchParams.get('end') ?? undefined;
        if ((csStart && !csEnd) || (!csStart && csEnd)) {
          return NextResponse.json({ error: 'Custom range requires both start and end' }, { status: 400 });
        }
        if (csStart && csEnd) {
          const rangeErr = getDateRangeError(csStart, csEnd);
          if (rangeErr) return NextResponse.json({ error: rangeErr }, { status: 400 });
        }
        const lokiCacheKey = csStart && csEnd
          ? `scorecard_loki_${csStart}_${csEnd}`
          : `scorecard_loki_${range}`;
        try {
          // Race against a 28s hard cap so the route always responds before any
          // reverse-proxy timeout. Cold Loki queries (7d+) can take 30-60s because
          // they scan cold storage, causing the proxy to 502. The background fetch
          // continues after the timeout fires and populates the cache (5-min TTL),
          // so subsequent requests within the window return immediately.
          const cached = scorecardCached(lokiCacheKey, 300_000, () => getScorecardLokiData(range, csStart, csEnd), 60_000);
          const guard = new Promise<never>((_, reject) => {
            const t: ReturnType<typeof setTimeout> = setTimeout(() => reject(new Error('Loki data not ready yet — try again in ~30s (cache warming)')), 28_000);
            if (typeof t === 'object' && 'unref' in t) t.unref();
          });
          const lokiData = await Promise.race([cached, guard]);
          return NextResponse.json(lokiData, { headers: { 'Cache-Control': 'no-store' } });
        } catch (lokiErr) {
          const msg = lokiErr instanceof Error ? lokiErr.message : String(lokiErr);
          logger.warn('analytics.scorecard.loki.error', { range, error: msg });
          return NextResponse.json(
            {
              configMissing: false, error: msg,
              publish: { begins: 0, successes: 0, failures: 0, buildFailed: 0, archiveFailed: 0, successRate: null },
              websocket: { errors: 0 }, summarization: { total: 0, successful: 0, failed: 0 }
            },
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }
      }

      case 'pdna': {
        const range = searchParams.get('range') ?? '7d';
        const csStart = searchParams.get('start') ?? undefined;
        const csEnd = searchParams.get('end') ?? undefined;
        if (csStart && csEnd) {
          const rangeErr = getDateRangeError(csStart, csEnd);
          if (rangeErr) return NextResponse.json({ error: rangeErr }, { status: 400 });
        }
        if ((csStart && !csEnd) || (!csStart && csEnd)) {
          return NextResponse.json({ error: 'Custom range requires both start and end' }, { status: 400 });
        }
        const ALLOWED_TLA = new Set(['non-tla', 'tla', 'all']);
        const rawTla: string = searchParams.get('tla') ?? 'non-tla';
        const tla = (ALLOWED_TLA.has(rawTla) ? rawTla : 'non-tla') as 'non-tla' | 'tla' | 'all';
        const snapshot = await getPdnaSnapshot(tla, []);
        if (!snapshot) return NextResponse.json({ configMissing: true });
        const PAID_PLANS = ['starter', 'professional', 'ultimate'] as const;
        const allDaily = snapshot.subscriptionsDailyByPlan.map((d: { date: string; byPlan: Record<string, number> }) => ({
          date: d.date,
          total: PAID_PLANS.reduce((sum, p) => sum + (d.byPlan[p] ?? 0), 0),
          byPlan: {
            starter: d.byPlan.starter ?? 0,
            professional: d.byPlan.professional ?? 0,
            ultimate: d.byPlan.ultimate ?? 0,
          },
        }));
        const cutoff = csStart && csEnd
          ? csStart
          : (() => {
            const n: number = RANGE_DAYS[range] ?? 7;
            const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
            return d.toISOString().split('T')[0];
          })();
        const endCutoff = csEnd ?? new Date().toISOString().split('T')[0];
        const paidUnitsDaily = allDaily.filter((d: { date: string }) => d.date >= cutoff && d.date <= endCutoff);
        const paidUnitsToday = paidUnitsDaily.length > 0 ? paidUnitsDaily[paidUnitsDaily.length - 1].total : 0;
        const paidUnitsInRange = paidUnitsDaily.reduce((s: number, d: { total: number }) => s + d.total, 0);
        const purchaseStarter = paidUnitsDaily.reduce((s: number, d: { byPlan: { starter: number } }) => s + d.byPlan.starter, 0);
        const purchasePro = paidUnitsDaily.reduce((s: number, d: { byPlan: { professional: number } }) => s + d.byPlan.professional, 0);
        const purchaseUltimate = paidUnitsDaily.reduce((s: number, d: { byPlan: { ultimate: number } }) => s + d.byPlan.ultimate, 0);
        return NextResponse.json({
          configMissing: false,
          paidUnitsDaily,
          paidUnitsToday,
          paidUnitsInRange,
          purchaseStarter,
          purchasePro,
          purchaseUltimate,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'feedback-s3': {
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const emit = (obj: Record<string, unknown>): void => {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };
            try {
              await streamScorecardS3Feed(searchParams, emit);
            } catch (err) {
              emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      case 'feedback-comments': {
        const commentsResult = await getScorecardFeedbackComments(searchParams);
        if (commentsResult.configMissing) return NextResponse.json({ configMissing: true }, { headers: { 'Cache-Control': 'no-store' } });
        if (commentsResult.error) return NextResponse.json({ error: commentsResult.error }, { status: commentsResult.errorStatus ?? 400 });
        return NextResponse.json(
          { comments: commentsResult.comments, total: commentsResult.total, page: commentsResult.page, pageSize: commentsResult.pageSize },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'c1-events': {
        if (!getClickHouseC1Config()) {
          return NextResponse.json({ configMissing: true, events: [], total: 0, productCounts: {} });
        }

        const VALID_GROUP_KEYS = new Set(['all', 'website', 'logo', 'domain', 'revenue', 'feedback', 'seo']);
        const rawProduct: string = searchParams.get('product') ?? '';
        const product: string = VALID_GROUP_KEYS.has(rawProduct) ? rawProduct : 'all';
        const pageNum: number = Math.max(0, Math.min(1000, parseInt(searchParams.get('page') ?? '0', 10) || 0));
        const rawSearch: string = (searchParams.get('search') ?? '').slice(0, 100);
        const bust: boolean = searchParams.get('bust') === '1';

        const PAGE_SIZE = 10;
        const offset: number = pageNum * PAGE_SIZE;

        const productCondition: string =
          product === 'website' ? `splitByChar('.', eid)[3] NOT IN ('brand', 'domains', 'loading') AND splitByChar('.', eid)[2] NOT IN ('plan', 'usage_gauge', 'seo') AND eid NOT LIKE '%feedback%' AND eid NOT LIKE '%thumbs_up%' AND eid NOT LIKE '%thumbs_down%'` :
            product === 'logo' ? `splitByChar('.', eid)[3] = 'brand'` :
              product === 'domain' ? `splitByChar('.', eid)[3] = 'domains'` :
                product === 'revenue' ? `splitByChar('.', eid)[2] IN ('plan', 'usage_gauge')` :
                  product === 'feedback' ? `(eid LIKE '%feedback%' OR eid LIKE '%thumbs_up%' OR eid LIKE '%thumbs_down%')` :
                    product === 'seo' ? `splitByChar('.', eid)[2] = 'seo'` :
                      '';

        const c1Params: Record<string, string> = rawSearch ? { searchLike: `%${rawSearch}%` } : {};
        const searchCondition: string = rawSearch
          ? `(eid LIKE {searchLike:String} OR page_path LIKE {searchLike:String} OR session_id LIKE {searchLike:String} OR visitor_id LIKE {searchLike:String})`
          : '';

        const baseConditions: string[] = [
          `processed_timestamp >= now() - INTERVAL 24 HOUR`,
          `notEmpty(eid)`,
          `startsWith(eid, 'appbuilder.')`,
        ];
        const filterConditions: string[] = [
          ...baseConditions,
          ...(productCondition ? [productCondition] : []),
          ...(searchCondition ? [searchCondition] : []),
        ];
        const baseWhere: string = baseConditions.join(' AND ');
        const filterWhere: string = filterConditions.join(' AND ');

        type C1EventRow = {
          ts: string; event_type: string; eid: string;
          element_product: string; session_id: string; visitor_id: string; app_id: string;
        };
        type TotalRow = { total: string };
        type ProductRow = { group_name: string; cnt: string };

        const eventsCacheKey: string = `c1_events_${product}_p${pageNum}_s${rawSearch}`;
        const totalCacheKey: string = `c1_total_${product}_s${rawSearch}`;

        const withBust = async <T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
          if (!bust) return routeCached(key, ttlMs, fn);
          const val = await fn();
          setRouteCache(key, val, ttlMs);
          return val;
        };

        const eventsSQL = `
          SELECT
            toString(processed_timestamp) AS ts,
            event_type, eid, element_product, session_id, visitor_id,
            IF(page_path LIKE '/develop/%',
               replaceRegexpOne(page_path, '^/develop/([^/?#]+).*', '\\1'),
               '') AS app_id
          FROM analytics.c1_events
          WHERE ${filterWhere}
          ORDER BY processed_timestamp DESC
          LIMIT ${PAGE_SIZE} OFFSET ${offset}
        `;
        const totalSQL = `SELECT count() AS total FROM analytics.c1_events WHERE ${filterWhere}`;
        const groupCountSQL = `
          SELECT
            multiIf(
              eid LIKE '%feedback%' OR eid LIKE '%thumbs_up%' OR eid LIKE '%thumbs_down%',
                                                                     'feedback',
              splitByChar('.', eid)[2] IN ('plan', 'usage_gauge'),   'revenue',
              splitByChar('.', eid)[3] = 'brand',                    'logo',
              splitByChar('.', eid)[3] = 'domains',                  'domain',
              splitByChar('.', eid)[2] = 'seo',                      'seo',
              splitByChar('.', eid)[3] = 'loading',                  'all',
              'website'
            ) AS group_name,
            count() AS cnt
          FROM analytics.c1_events
          WHERE ${baseWhere}
          GROUP BY group_name
          ORDER BY cnt DESC
        `;

        const [events, totalRows, productCountRows] = await Promise.all([
          withBust(eventsCacheKey, 60_000, () => c1Query<C1EventRow>(eventsSQL, c1Params)),
          withBust(totalCacheKey, 60_000, () => c1Query<TotalRow>(totalSQL, c1Params)),
          withBust('c1_group_counts_24h', 300_000, () => c1Query<ProductRow>(groupCountSQL)),
        ]);

        const productCounts: Record<string, number> = {};
        for (const row of productCountRows) {
          productCounts[row.group_name ?? 'website'] = parseInt(row.cnt, 10);
        }
        const total: number = parseInt(totalRows[0]?.total ?? '0', 10);

        return NextResponse.json({ configMissing: false, events, total, productCounts });
      }

      case 'pdna-apps': {
        const ALLOWED_TLA_PA = new Set(['non-tla', 'tla', 'all']);
        const rawTlaPA: string = searchParams.get('tla') ?? 'non-tla';
        const tlaPA = (ALLOWED_TLA_PA.has(rawTlaPA) ? rawTlaPA : 'non-tla') as 'non-tla' | 'tla' | 'all';

        const ALLOWED_PLANS_PA = new Set(['free', 'starter', 'professional', 'ultimate']);
        const rawPlansPA: string = searchParams.get('plans') ?? '';
        const planFilterPA: string[] = rawPlansPA.split(',').map((s: string) => s.trim()).filter((p: string) => ALLOWED_PLANS_PA.has(p));

        const rangePA: string = searchParams.get('range') ?? '7d';
        const csStartPA: string | undefined = searchParams.get('start') ?? undefined;
        const csEndPA: string | undefined = searchParams.get('end') ?? undefined;
        if ((csStartPA && !csEndPA) || (!csStartPA && csEndPA)) {
          return NextResponse.json({ error: 'Custom range requires both start and end' }, { status: 400 });
        }
        if (csStartPA && csEndPA) {
          const rangeErrPA = getDateRangeError(csStartPA, csEndPA);
          if (rangeErrPA) return NextResponse.json({ error: rangeErrPA }, { status: 400 });
        }

        const cutoffPA: string = csStartPA ?? (() => {
          const n: number = RANGE_DAYS[rangePA] ?? 7;
          return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
        })();
        const endCutoffPA: string = csEndPA ?? (new Date().toISOString().split('T')[0] as string);

        const snapshotPA = await getPdnaSnapshot(tlaPA, planFilterPA, { from: cutoffPA, to: endCutoffPA });
        if (!snapshotPA) return NextResponse.json({ configMissing: true });

        function filterDates<T extends { date: string }>(arr: T[]): T[] {
          return arr.filter((d: T) => d.date >= cutoffPA && d.date <= endCutoffPA);
        }

        return NextResponse.json({
          configMissing: false,
          snapshotDate: snapshotPA.snapshotDate,
          totalApps: snapshotPA.totalApps,
          publishedCount: snapshotPA.publishedCount,
          publishRate: snapshotPA.publishRate,
          everPublishedCount: snapshotPA.everPublishedCount,
          everPublishedRate: snapshotPA.everPublishedRate,
          hibernatedCount: snapshotPA.hibernatedCount,
          hibernationRate: snapshotPA.hibernationRate,
          deletedCount: snapshotPA.deletedCount,
          totalSubscriptions: snapshotPA.totalSubscriptions,
          customDomainCount: snapshotPA.customDomainCount,
          customDomainRate: snapshotPA.customDomainRate,
          downgradesCount: snapshotPA.downgradesCount,
          timeToPublishP50: snapshotPA.timeToPublishHours.p50 ?? null,
          timeToPublishP90: snapshotPA.timeToPublishHours.p90 ?? null,
          timeToPublishP50Range: snapshotPA.timeToPublishHoursRange.p50 ?? null,
          timeToPublishP90Range: snapshotPA.timeToPublishHoursRange.p90 ?? null,
          appsCreatedDaily: filterDates(snapshotPA.appsCreatedDaily),
          appsCreatedDailyByPlan: filterDates(snapshotPA.appsCreatedDailyByPlan),
          appsDeletedDaily: filterDates(snapshotPA.appsDeletedDaily),
          everPublishedDaily: filterDates(snapshotPA.everPublishedDaily),
          appsHibernatedDaily: filterDates(snapshotPA.appsHibernatedDaily),
          appsCustomDomainDaily: filterDates(snapshotPA.appsCustomDomainDaily),
          uniqueCustomersDaily: filterDates(snapshotPA.uniqueCustomersDaily),
          subscriptionsDaily: filterDates(snapshotPA.subscriptionsDaily),
          subscriptionsDailyByPlan: filterDates(snapshotPA.subscriptionsDailyByPlan),
          timeToPublishDaily: filterDates(snapshotPA.timeToPublishDaily),
          subscriptionPlans: snapshotPA.subscriptionPlans,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'bmp': {
        const bmpToken: string | undefined = request.cookies.get('auth_jomax')?.value;
        if (!bmpToken) {
          const missing = { configMissing: true as const };
          return NextResponse.json(
            { bmp: missing, website: missing, dimEntryPoint: missing, dimPlanType: missing, dimCreationSource: missing, dimIntent: missing, paywall: missing },
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }

        const range = searchParams.get('range') ?? '7d';
        const csStart = searchParams.get('start') ?? undefined;
        const csEnd = searchParams.get('end') ?? undefined;
        if ((csStart && !csEnd) || (!csStart && csEnd)) {
          return NextResponse.json({ error: 'Custom range requires both start and end' }, { status: 400 });
        }
        if (csStart && csEnd) {
          const rangeErr = getDateRangeError(csStart, csEnd);
          if (rangeErr) return NextResponse.json({ error: rangeErr }, { status: 400 });
        }

        const bmpBase: Omit<BmpQueryOpts, 'metricId' | 'namespace' | 'measures' | 'dimensions'> = {
          period: 'DAY', operation: 'SUM', range, csStart, csEnd,
        };
        const mkBmp = (metricId: string, namespace: string, measures: readonly string[], dimensions: readonly string[]) =>
          runBmpQuery(bmpToken, { ...bmpBase, metricId, namespace, measures, dimensions });

        const [r0, r1, r2, r3, r4, r5, r6] = await Promise.allSettled([
          mkBmp('agent_feedback_count', 'agent-observability', ['positive_count', 'negative_count', 'total_count'], []),
          mkBmp('website_core_events', 'airo-instrumentation', SCORECARD_WEBSITE_CORE_MEASURES, []),
          mkBmp('website_core_events', 'airo-instrumentation', SCORECARD_WEBSITE_DIM_MEASURES, ['entry_point']),
          mkBmp('website_core_events', 'airo-instrumentation', SCORECARD_WEBSITE_DIM_MEASURES, ['plan_type']),
          mkBmp('website_core_events', 'airo-instrumentation', SCORECARD_WEBSITE_DIM_MEASURES, ['creation_source']),
          mkBmp('website_core_events', 'airo-instrumentation', SCORECARD_WEBSITE_DIM_MEASURES, ['intent_category']),
          mkBmp('paywall_conversion_events', 'airo-instrumentation', SCORECARD_PAYWALL_MEASURES, []),
        ]);

        const ok = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
          r.status === 'fulfilled' ? r.value : fallback;
        const bmpFallback = { configMissing: false as const, error: 'query failed' };

        return NextResponse.json({
          bmp: ok(r0, bmpFallback),
          website: ok(r1, bmpFallback),
          dimEntryPoint: ok(r2, bmpFallback),
          dimPlanType: ok(r3, bmpFallback),
          dimCreationSource: ok(r4, bmpFallback),
          dimIntent: ok(r5, bmpFallback),
          paywall: ok(r6, bmpFallback),
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      case 'pdna-apps-snapshot': {
        const snapshotOnly = await getPdnaSnapshot('non-tla', [], null);
        if (!snapshotOnly) return NextResponse.json({ configMissing: true });
        return NextResponse.json({
          configMissing: false,
          snapshotDate: snapshotOnly.snapshotDate,
          totalApps: snapshotOnly.totalApps,
          publishedCount: snapshotOnly.publishedCount,
          publishRate: snapshotOnly.publishRate,
          everPublishedCount: snapshotOnly.everPublishedCount,
          everPublishedRate: snapshotOnly.everPublishedRate,
          hibernatedCount: snapshotOnly.hibernatedCount,
          hibernationRate: snapshotOnly.hibernationRate,
          deletedCount: snapshotOnly.deletedCount,
          totalSubscriptions: snapshotOnly.totalSubscriptions,
          customDomainCount: snapshotOnly.customDomainCount,
          customDomainRate: snapshotOnly.customDomainRate,
          downgradesCount: snapshotOnly.downgradesCount,
          timeToPublishP50: snapshotOnly.timeToPublishHours.p50 ?? null,
          timeToPublishP90: snapshotOnly.timeToPublishHours.p90 ?? null,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('analytics.scorecard.route.error', {
      action,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to fetch scorecard data', details: String(error) },
      { status: 500 },
    );
  }
});
