import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-s3', async function mockS3Module() {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn(),
  };
});

const ctx = vi.hoisted(() => ({
  send: vi.fn(),
}));

describe('feedback-s3', function feedbackS3Package() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    ctx.send.mockReset();
    vi.mocked(S3Client).mockImplementation(function createS3() {
      return { send: ctx.send } as unknown as S3Client;
    });
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parseFeedbackRequest accepts all=1', async function parseAllOne() {
    const { parseFeedbackRequest } = await import('@/lib/supportplane/ingest/feedback-s3');
    const w = parseFeedbackRequest(new URLSearchParams({ all: '1' }));
    expect('error' in w).toBe(false);
    if ('error' in w) return;
    expect(w).toEqual({ kind: 'all' });
  });

  it('parseFeedbackRequest accepts all=true', async function parseAllTrue() {
    const { parseFeedbackRequest } = await import('@/lib/supportplane/ingest/feedback-s3');
    const w = parseFeedbackRequest(new URLSearchParams({ all: 'true' }));
    expect('error' in w).toBe(false);
    if ('error' in w) return;
    expect(w).toEqual({ kind: 'all' });
  });

  it('buildFeedbackSummary counts all items in all-time window', async function allWindowTotals() {
    const { buildFeedbackSummary } = await import('@/lib/supportplane/ingest/feedback-s3');
    const window = { kind: 'all' as const };
    const items = [
      { feedback_text: 'a', rating: 8, feedback_utc_ts: '2026-05-05T10:00:00.000Z' },
      { feedback_text: 'b', rating: 2, feedback_utc_ts: '2019-01-01T08:00:00.000Z' },
    ];
    const summary = buildFeedbackSummary(items, window, false);
    expect(summary.total).toBe(2);
    expect(summary.allTime).toBe(true);
  });

  it('getFeedbackItemsCached lists hive root prefix for all-time window', async function s3AllFetch() {
    vi.stubEnv('FEEDBACK_S3_BUCKET', 'test-feedback-bucket');
    ctx.send.mockImplementation(async function send(cmd: { input?: { Prefix?: string; Key?: string } }) {
      const input = cmd.input ?? {};
      if (input.Prefix !== undefined) {
        if (input.Prefix === 'airo_builder_feedback_cln/') {
          return {
            IsTruncated: false,
            Contents: [{ Key: `${input.Prefix}year=2026/month=05/day=06/batch.json` }],
          };
        }
        return { IsTruncated: false, Contents: [] };
      }
      if (input.Key) {
        return {
          Body: {
            transformToString: () =>
              Promise.resolve(
                '{"feedback_text":"Legacy","rating":6,"feedback_utc_ts":"2026-05-06T11:15:30.000Z"}\n',
              ),
          },
        };
      }
      throw new Error('unexpected S3 command');
    });

    const { getFeedbackItemsCached, buildFeedbackSummary } = await import('@/lib/supportplane/ingest/feedback-s3');
    const window = { kind: 'all' as const };
    const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(partition_errors).toBe(0);
    const summary = buildFeedbackSummary(items, window, merged_truncated);
    expect(summary.total).toBe(1);
    expect(summary.allTime).toBe(true);
  });

  it('parseFeedbackRequest accepts a 7-day rolling window', async function parseSevenDays() {
    const { parseFeedbackRequest } = await import('@/lib/supportplane/ingest/feedback-s3');
    const sp = new URLSearchParams({ days: '7' });
    const w = parseFeedbackRequest(sp);
    expect('error' in w).toBe(false);
    if ('error' in w) return;
    expect(w).toEqual({ kind: 'rolling', days: 7 });
  });

  it('buildFeedbackSummary totals only rows whose timestamps fall inside the rolling 7-day window', async function rollingFilter() {
    vi.useFakeTimers({ now: new Date('2026-05-06T12:00:00.000Z').getTime() });
    const { buildFeedbackSummary } = await import('@/lib/supportplane/ingest/feedback-s3');
    const window = { kind: 'rolling' as const, days: 7 as const };
    const items = [
      { feedback_text: 'inside', rating: 8, feedback_utc_ts: '2026-05-05T10:00:00.000Z' },
      { feedback_text: 'outside', rating: 2, feedback_utc_ts: '2026-03-01T08:00:00.000Z' },
    ];
    const summary = buildFeedbackSummary(items, window, false);
    expect(summary.total).toBe(1);
    expect(summary.positive).toBe(1);
    expect(summary.neutral).toBe(0);
    expect(summary.negative).toBe(0);
  });

  it('getFeedbackItemsCached returns no items without FEEDBACK_S3_BUCKET', async function missingBucket() {
    vi.stubEnv('FEEDBACK_S3_BUCKET', '');
    const { getFeedbackItemsCached } = await import('@/lib/supportplane/ingest/feedback-s3');
    const out = await getFeedbackItemsCached({ kind: 'rolling' as const, days: 7 });
    expect(out.items).toHaveLength(0);
    expect(out.partition_errors).toBe(0);
  });

  it('getFeedbackItemsCached loads JSON Lines from Hive partitions scanned for rolling 7 days', async function s3RollingFetch() {
    vi.useFakeTimers({ now: new Date('2026-05-06T15:30:00.000Z').getTime() });
    vi.stubEnv('FEEDBACK_S3_BUCKET', 'test-feedback-bucket');
    ctx.send.mockImplementation(async function send(cmd: { input?: { Prefix?: string; Key?: string } }) {
      const input = cmd.input ?? {};
      if (input.Prefix !== undefined) {
        if (input.Prefix.includes('year=2026/month=05/day=06')) {
          return {
            IsTruncated: false,
            Contents: [{ Key: `${input.Prefix}batch.json` }],
          };
        }
        return { IsTruncated: false, Contents: [] };
      }
      if (input.Key) {
        return {
          Body: {
            transformToString: () =>
              Promise.resolve(
                '{"feedback_text":"Ship it","rating":10,"feedback_utc_ts":"2026-05-06T11:15:30.000Z"}\n',
              ),
          },
        };
      }
      throw new Error('unexpected S3 command');
    });

    const { getFeedbackItemsCached, buildFeedbackSummary } = await import('@/lib/supportplane/ingest/feedback-s3');
    const window = { kind: 'rolling' as const, days: 7 as const };
    const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(merged_truncated).toBe(false);
    expect(partition_errors).toBe(0);
    expect(buildFeedbackSummary(items, window, merged_truncated).total).toBe(1);
  });

  it('getFeedbackItemsCached yields empty summaries when partitions list no usable objects', async function s3PartitionEmpty() {
    vi.useFakeTimers({ now: new Date('2026-05-06T12:00:00.000Z').getTime() });
    vi.stubEnv('FEEDBACK_S3_BUCKET', 'empty-bucket');
    ctx.send.mockImplementation(async function send(cmd: { input?: { Prefix?: string; Key?: string } }) {
      const input = cmd.input ?? {};
      if (input.Prefix !== undefined) {
        return { IsTruncated: false, Contents: [] };
      }
      throw new Error('unexpected GetObject');
    });

    const { getFeedbackItemsCached, buildFeedbackSummary } = await import('@/lib/supportplane/ingest/feedback-s3');
    const window = { kind: 'rolling' as const, days: 7 as const };
    const { items, merged_truncated, partition_errors } = await getFeedbackItemsCached(window);
    expect(items).toHaveLength(0);
    expect(partition_errors).toBe(0);
    expect(buildFeedbackSummary(items, window, merged_truncated).error).toBe('No feedback data available');
  });
});
