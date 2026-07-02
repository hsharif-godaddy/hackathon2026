import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({ loadConfig: vi.fn().mockResolvedValue({
  esWrite: { node: 'n', username: 'u', password: 'p' },
  esRead: { node: 'r', apiKey: 'k' },
  slackWebhookUrl: 'https://hooks.slack.com/x',
  appLogIndex: 'idx', statsIndex: 'watchtower_stats',
  apmIndex: 'metrics-apm.service_transaction.1m*',
  apmServiceName: 'airo-app-builder-test',
  albLoadBalancerName: 'app/test-alb/abc123',
}) }));
vi.mock('./es-clients.js', () => ({ makeReadClient: () => ({}), makeWriteClient: () => ({}) }));
vi.mock('./bootstrap.js', () => ({ ensureStatsIndex: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./collector.js', () => ({ collectHour: vi.fn().mockResolvedValue({ data: { log_count: 1 }, errorEventNames: [] }) }));
vi.mock('./apm-collector.js', () => ({ collectApm: vi.fn().mockResolvedValue({ req_throughput: 100, req_error_rate: 0, latency_p50_ms: 10, latency_p95_ms: 50 }) }));
vi.mock('./cloudwatch-collector.js', () => ({ collectCloudwatch: vi.fn().mockResolvedValue({ alb_5xx_count: 0, alb_req_count: 500, alb_p95_ms: 200 }) }));
vi.mock('./writer.js', () => ({
  buildStatsDoc: (d: unknown, w: unknown, ts: unknown, n: unknown, names: unknown) => ({ data: d, names }),
  writeStatsDoc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./detector.js', () => ({
  loadBaselines: vi.fn().mockResolvedValue({}),
  loadRecentRows: vi.fn().mockResolvedValue([]),
  loadRecentDailyStats: vi.fn().mockResolvedValue([]),
  loadRecentDailyNotes: vi.fn().mockResolvedValue([]),
  loadEventNameBaseline: vi.fn().mockResolvedValue(new Set<string>()),
  detectSeries: vi.fn().mockReturnValue([]),
  detectTrends: vi.fn().mockReturnValue([]),
}));
vi.mock('./aggregate.js', () => ({ aggregateDay: vi.fn().mockReturnValue({ log_count: 10 }) }));
vi.mock('./reporter.js', () => ({ buildDigestBlocks: () => [], postSlack: vi.fn().mockResolvedValue(true) }));

import { handler } from './index.js';
import * as collector from './collector.js';
import * as apmCollector from './apm-collector.js';
import * as cwCollector from './cloudwatch-collector.js';
import * as writer from './writer.js';
import * as detector from './detector.js';
import * as aggregate from './aggregate.js';
import * as reporter from './reporter.js';

const collectHour = collector.collectHour as ReturnType<typeof vi.fn>;
const collectApm = apmCollector.collectApm as ReturnType<typeof vi.fn>;
const collectCloudwatch = cwCollector.collectCloudwatch as ReturnType<typeof vi.fn>;
const writeStatsDoc = writer.writeStatsDoc as ReturnType<typeof vi.fn>;
const loadRecentRows = detector.loadRecentRows as ReturnType<typeof vi.fn>;
const loadBaselines = detector.loadBaselines as ReturnType<typeof vi.fn>;
const loadEventNameBaseline = detector.loadEventNameBaseline as ReturnType<typeof vi.fn>;
const detectSeries = detector.detectSeries as ReturnType<typeof vi.fn>;
const aggregateDay = aggregate.aggregateDay as ReturnType<typeof vi.fn>;
const postSlack = reporter.postSlack as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  postSlack.mockResolvedValue(true);
  loadEventNameBaseline.mockResolvedValue(new Set<string>());
  aggregateDay.mockReturnValue({ log_count: 10 });
  collectHour.mockResolvedValue({ data: { log_count: 1 }, errorEventNames: [] });
});

describe('handler', () => {
  it('tripwire mode calls all 3 collectors + writeStatsDoc, does not call postSlack', async () => {
    expect(await handler({ mode: 'tripwire' })).toEqual({ ok: true, mode: 'tripwire' });
    expect(collectHour).toHaveBeenCalledOnce();
    expect(collectApm).toHaveBeenCalledOnce();
    expect(collectCloudwatch).toHaveBeenCalledOnce();
    expect(writeStatsDoc).toHaveBeenCalledOnce();
    expect(postSlack).not.toHaveBeenCalled();
  });

  it('tripwire computes novel fingerprints against loadEventNameBaseline', async () => {
    collectHour.mockResolvedValueOnce({
      data: { log_count: 1, new_error_fingerprints: 0 },
      errorEventNames: ['foo.error', 'bar.failed'],
    });
    loadEventNameBaseline.mockResolvedValueOnce(new Set(['foo.error']));
    await handler({ mode: 'tripwire' });
    // 'bar.failed' is novel; written doc data should have new_error_fingerprints = 1
    expect(writeStatsDoc).toHaveBeenCalledOnce();
  });

  it('daily mode calls loadRecentRows + loadBaselines + detectSeries + aggregateDay + postSlack; calls collectHour once for fresh 24h latency', async () => {
    expect(await handler({ mode: 'daily' })).toEqual({ ok: true, mode: 'daily', posted: true });
    expect(loadRecentRows).toHaveBeenCalledOnce();
    expect(loadBaselines).toHaveBeenCalledOnce();
    expect(detectSeries).toHaveBeenCalledOnce();
    expect(aggregateDay).toHaveBeenCalledOnce();
    expect(postSlack).toHaveBeenCalledOnce();
    // collectHour is called once in daily mode for fresh 24h SSE latency (not to write a row)
    expect(collectHour).toHaveBeenCalledOnce();
    expect(writeStatsDoc).not.toHaveBeenCalled();
  });

  it('daily mode reports posted:false when the Slack post is skipped/fails', async () => {
    postSlack.mockResolvedValueOnce(false);
    expect(await handler({ mode: 'daily' })).toEqual({ ok: true, mode: 'daily', posted: false });
  });
});
