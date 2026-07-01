import { requireLokiEndpoint } from '@/lib/log-sources';
import { rangeToDateWindow } from '@/lib/analytics/date-range';
import { getDirectSummarizationStats, getDirectWebsocketErrorStats } from '@/lib/analytics/loki-events';

// ─── Scorecard-specific publish stats ────────────────────────────────────────
// loki-events.ts publishStatsFor only counts route.publish.success (rare in prod).
// The scorecard also needs route.publish.async.complete (the primary async-worker
// success event). This minimal inline implementation adds it without touching the
// shared analytics code.

const DAY_MS: number = 24 * 60 * 60 * 1000;

interface LokiMetricSeries {
  metric: Record<string, string>;
  values: Array<[number | string, string]>;
}

interface LokiMetricResponse {
  status?: string;
  error?: string;
  errorType?: string;
  data?: { resultType?: 'matrix'; result?: LokiMetricSeries[] };
}

function toNs(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function lokiQueryRange(query: string, start: Date, end: Date, step: string): Promise<LokiMetricSeries[]> {
  const endpoint: string = requireLokiEndpoint('scorecard Loki publish').replace(/\/+$/, '');
  const apiKey: string = process.env.LOKI_API_KEY || '';
  const params: URLSearchParams = new URLSearchParams({ query, start: toNs(start), end: toNs(end), step });
  let res: Response;
  try {
    res = await fetch(`${endpoint}/loki/api/v1/query_range?${params}`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(
      `Loki scorecard query error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
  if (!res.ok) {
    const body: string = await res.text().catch(() => '');
    throw new Error(`Loki scorecard query failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  const json: LokiMetricResponse = await res.json() as LokiMetricResponse;
  if (json.status === 'error') {
    throw new Error(`Loki scorecard query error: ${json.errorType ?? 'unknown'} — ${json.error ?? ''}`);
  }
  const result: LokiMetricSeries[] | undefined = json.data?.result;
  if (!Array.isArray(result)) throw new Error('Loki scorecard query: unexpected response shape');
  return result;
}

type DailyPublishRow = { date: string; begins: number; successes: number; failures: number; build_failed: number; archive_failed: number };
type PublishStats = { total: number; successes: number; failures: number; daily_stats: DailyPublishRow[] };

async function fetchScorecardPublishStats(startDate: string, endDate: string): Promise<PublishStats> {
  const start: Date = new Date(startDate);
  const end: Date = new Date(endDate);
  const queryStart: Date = new Date(utcDayStart(start).getTime() + DAY_MS);
  const queryEnd: Date = new Date(utcDayStart(end).getTime() + DAY_MS);

  const env: string = (process.env.ENVIRONMENT_NAME || 'dev') === 'prod' ? 'prod' : 'dev';
  const query: string = `sum by (event) (count_over_time({job="airo-agents", env="${env}"} |= "route.publish" | json | event=~"route\\.publish\\..*" | app_id!="" [24h]))`;

  const series: LokiMetricSeries[] = await lokiQueryRange(query, queryStart, queryEnd, '24h');

  const byDay: Map<string, Map<string, number>> = new Map();
  for (const item of series) {
    const event: string = item.metric.event;
    if (!event) continue;
    for (const [ts, val] of item.values) {
      const count: number = Number(val);
      if (!Number.isFinite(count) || count === 0) continue;
      const raw: string = String(ts);
      const sampleMs: number = /^\d{16,}$/.test(raw)
        ? Number(BigInt(raw) / 1_000_000n)
        : Math.round(Number.parseFloat(raw) * 1000);
      const bucket: string = utcDayStart(new Date(sampleMs - 1)).toISOString();
      let m: Map<string, number> | undefined = byDay.get(bucket);
      if (!m) { m = new Map(); byDay.set(bucket, m); }
      m.set(event, (m.get(event) ?? 0) + count);
    }
  }

  let total: number = 0;
  let successes: number = 0;
  let failures: number = 0;
  const daily_stats: DailyPublishRow[] = [];

  for (const date of Array.from(byDay.keys()).sort()) {
    const e: Map<string, number> = byDay.get(date) ?? new Map();
    // strategy-selected fires before the build starts, so begins overcounts actual publish attempts slightly.
    const begins: number = (e.get('route.publish.strategy-selected') ?? 0) + (e.get('route.publish.begin') ?? 0);
    const s: number = (e.get('route.publish.async.complete') ?? 0) + (e.get('route.publish.success') ?? 0);
    const build_failed: number =
      (e.get('route.publish.default.build.failed') ?? 0) +
      (e.get('route.publish.paas.build.failed') ?? 0) +
      (e.get('route.publish.build.failed') ?? 0);
    const archive_failed: number =
      (e.get('route.publish.default.archive.failed') ?? 0) +
      (e.get('route.publish.paas.archive.failed') ?? 0) +
      (e.get('route.publish.archive.failed') ?? 0) +
      (e.get('route.publish.git-archive.failed') ?? 0);
    const f: number = build_failed + archive_failed;
    if (begins > 0 || s > 0 || f > 0) {
      daily_stats.push({ date, begins, successes: s, failures: f, build_failed, archive_failed });
      total += s + f; successes += s; failures += f;
    }
  }

  return { total, successes, failures, daily_stats };
}

// ─── Public interface ─────────────────────────────────────────────────────────

function scorecardDateRange(range: string, customFrom?: string, customTo?: string): { start: string; end: string } {
  if (range === '24h') {
    const now: Date = new Date();
    const utcToday: Date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end: string = utcToday.toISOString().slice(0, 10);
    const yesterday: Date = new Date(utcToday.getTime() - DAY_MS);
    return { start: yesterday.toISOString().slice(0, 10), end };
  }
  return rangeToDateWindow(range, customFrom, customTo);
}

export interface ScorecardLokiData {
  configMissing: boolean;
  error?: string;
  publish: {
    begins:        number;
    successes:     number;
    failures:      number;
    buildFailed:   number;
    archiveFailed: number;
    successRate:   number | null;
  };
  websocket:     { errors: number };
  summarization: { total: number; successful: number; failed: number };
}

export async function getScorecardLokiData(
  range:       string,
  customFrom?: string,
  customTo?:   string,
): Promise<ScorecardLokiData> {
  const { start, end }: { start: string; end: string } = scorecardDateRange(range, customFrom, customTo);

  const [pubResult, wsResult, summResult] = await Promise.allSettled([
    fetchScorecardPublishStats(start, end),
    getDirectWebsocketErrorStats(start, end),
    getDirectSummarizationStats(start, end),
  ]);

  const errors: string[] = [];
  for (const r of [pubResult, wsResult, summResult]) {
    if (r.status === 'rejected') {
      const msg: string = r.reason instanceof Error ? r.reason.message : String(r.reason);
      if (msg.includes('LOKI_ENDPOINT') || msg.includes('required for') || msg.includes('not configured')) {
        return {
          configMissing: true,
          publish:       { begins: 0, successes: 0, failures: 0, buildFailed: 0, archiveFailed: 0, successRate: null },
          websocket:     { errors: 0 },
          summarization: { total: 0, successful: 0, failed: 0 },
        };
      }
      errors.push(msg.slice(0, 200));
    }
  }

  const pub  = pubResult.status  === 'fulfilled' ? pubResult.value  : null;
  const ws   = wsResult.status   === 'fulfilled' ? wsResult.value   : null;
  const summ = summResult.status === 'fulfilled' ? summResult.value : null;

  const begins: number        = pub ? pub.daily_stats.reduce((s, d) => s + d.begins,        0) : 0;
  const buildFailed: number   = pub ? pub.daily_stats.reduce((s, d) => s + d.build_failed,   0) : 0;
  const archiveFailed: number = pub ? pub.daily_stats.reduce((s, d) => s + d.archive_failed, 0) : 0;
  const attempted: number     = pub ? pub.successes + pub.failures : 0;

  const uniqueErrors: string[] = [...new Set(errors)];
  return {
    configMissing: false,
    ...(uniqueErrors.length > 0 ? { error: uniqueErrors.join(' | ') } : {}),
    publish: {
      begins,
      successes:    pub?.successes    ?? 0,
      failures:     pub?.failures     ?? 0,
      buildFailed,
      archiveFailed,
      successRate:  attempted > 0 ? Math.round(((pub?.successes ?? 0) / attempted) * 100) : null,
    },
    websocket:     { errors: ws?.total ?? 0 },
    summarization: {
      total:      summ?.total ?? 0,
      successful: summ ? summ.daily_stats.reduce((s, d) => s + d.successful, 0) : 0,
      failed:     summ ? summ.daily_stats.reduce((s, d) => s + d.failed,     0) : 0,
    },
  };
}
