import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/log-sources', () => ({
  requireLokiEndpoint: vi.fn(function () { return 'https://loki.test'; }),
}));

import {
  getDirectPublishStats,
  getDirectRollingHourlyPublish,
  getDirectSummarizationStats,
} from '../loki-events';

const originalFetch = global.fetch;

function sample(iso: string, value: number): [number, string] {
  return [new Date(iso).getTime() / 1000, String(value)];
}

function matrix(series: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>) {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: series,
      },
    }),
    text: async () => '',
  } as unknown as Response;
}

describe('loki-events', () => {
  beforeEach(() => {
    process.env.ENVIRONMENT_NAME = 'prod';
    global.fetch = vi.fn() as unknown as typeof fetch;
    vi.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses direct Loki metric calls to aggregate summarizations by UTC day', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(matrix([
        { metric: { event: 'summarization.background.complete' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'summarization.detailed_llm.failure' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'summarization.detailed_llm.token_budget_exceeded' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
      ]));

    const stats = await getDirectSummarizationStats('2026-04-21T00:00:00.000Z', '2026-04-21T23:59:59.999Z');

    expect(stats).toEqual({
      total: 3,
      daily_stats: [
        {
          date: '2026-04-21T00:00:00.000Z',
          total: 3,
          successful: 1,
          failed: 2,
          apps: 0,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/loki/api/v1/query_range');
    const query = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('query');
    expect(query).toContain('sum by (event) (count_over_time');
    expect(query).toContain('{job="airo-agents", env="prod"}');
  });

  it('uses direct Loki metric calls for publish success-rate inputs', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(matrix([
        { metric: { event: 'route.publish.strategy-selected' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'route.publish.begin' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'route.publish.success' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'route.publish.default.build.failed' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'route.publish.paas.archive.failed' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
        { metric: { event: 'route.publish.supervisor.failed' }, values: [sample('2026-04-22T00:00:00.000Z', 1)] },
      ]));

    const stats = await getDirectPublishStats('2026-04-21T00:00:00.000Z', '2026-04-21T23:59:59.999Z');

    expect(stats).toEqual({
      total: 3,
      successes: 1,
      failures: 2,
      daily_stats: [
        {
          date: '2026-04-21T00:00:00.000Z',
          apps: 0,
          begins: 2,
          successes: 1,
          build_failed: 1,
          archive_failed: 1,
          failures: 2,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns zero-filled rolling publish buckets for missing hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:30:00.000Z'));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(matrix([
      { metric: { event: 'route.publish.strategy-selected' }, values: [sample('2026-04-21T12:30:00.000Z', 1)] },
      { metric: { event: 'route.publish.success' }, values: [sample('2026-04-21T12:30:00.000Z', 1)] },
      { metric: { event: 'route.publish.default.archive.failed' }, values: [sample('2026-04-21T11:30:00.000Z', 1)] },
    ]));

    const stats = await getDirectRollingHourlyPublish();

    expect(stats.start).toBe('2026-04-20T12:30:00.000Z');
    expect(stats.end).toBe('2026-04-21T12:30:00.000Z');
    expect(stats.hourly_stats).toHaveLength(24);
    expect(stats.hourly_stats[0]).toMatchObject({ hoursAgo: 0, begins: 1, successes: 1, failures: 0 });
    expect(stats.hourly_stats[1]).toMatchObject({ hoursAgo: 1, begins: 0, successes: 0, failures: 1 });
    expect(stats.hourly_stats[2]).toMatchObject({ hoursAgo: 2, begins: 0, successes: 0, failures: 0 });
  });
});
