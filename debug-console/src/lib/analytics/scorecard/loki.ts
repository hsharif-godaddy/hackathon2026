import { rangeToDateWindow } from '@/lib/analytics/date-range';
import { getDirectPublishStats, getDirectSummarizationStats, getDirectWebsocketErrorStats } from '@/lib/analytics/loki-events';

function scorecardDateRange(range: string, customFrom?: string, customTo?: string): { start: string; end: string } {
  // '24h' uses a 2-day window so the last 24h is fully covered across UTC boundaries.
  if (range === '24h') {
    const now = new Date();
    const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = utcToday.toISOString().slice(0, 10);
    const yesterday = new Date(utcToday.getTime() - 24 * 60 * 60 * 1000);
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
  const { start, end } = scorecardDateRange(range, customFrom, customTo);

  const [pubResult, wsResult, summResult] = await Promise.allSettled([
    getDirectPublishStats(start, end),
    getDirectWebsocketErrorStats(start, end),
    getDirectSummarizationStats(start, end),
  ]);

  // Surface the first error that isn't a "not configured" error so the UI can
  // show a warning. A "not configured" error means the endpoint env var is
  // missing — surface that as configMissing instead.
  const errors: string[] = [];
  for (const r of [pubResult, wsResult, summResult]) {
    if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
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

  // Includes strategy-selected events emitted before the build starts — overcounts actual attempts. Use `attempted` (successes + failures) as the denominator for success rate.
  const begins        = pub ? pub.daily_stats.reduce((s, d) => s + d.begins,        0) : 0;
  const buildFailed   = pub ? pub.daily_stats.reduce((s, d) => s + d.build_failed,   0) : 0;
  const archiveFailed = pub ? pub.daily_stats.reduce((s, d) => s + d.archive_failed, 0) : 0;
  const attempted     = pub ? pub.successes + pub.failures : 0;

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
