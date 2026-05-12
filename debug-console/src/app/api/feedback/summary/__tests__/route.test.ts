import { S3Client } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler,
}));

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

describe('feedback summary route', function feedbackSummaryRoute() {
  const originalEnv = { ...process.env };

  beforeEach(function setup() {
    vi.clearAllMocks();
    ctx.send.mockReset();
    vi.useFakeTimers({ now: new Date('2026-05-06T14:00:00.000Z').getTime() });
    vi.mocked(S3Client).mockImplementation(function createS3() {
      return { send: ctx.send } as unknown as S3Client;
    });
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  function makeRequest(search: string) {
    return new NextRequest(`http://localhost/api/feedback/summary${search}`);
  }

  it('returns 503 when FEEDBACK_S3_BUCKET is not set', async function bucketMissing() {
    delete process.env.FEEDBACK_S3_BUCKET;
    const { GET } = await import('../route');
    const response = await (GET as (req: NextRequest) => Promise<Response>)(makeRequest('?days=7'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('FEEDBACK_S3_BUCKET');
  });

  it('returns 200 with counts and partition_errors when S3 returns feedback for the 7-day window', async function sevenDayOk() {
    process.env.FEEDBACK_S3_BUCKET = 'test-bucket';
    ctx.send.mockImplementation(async function send(cmd: { input?: { Prefix?: string; Key?: string } }) {
      const input = cmd.input ?? {};
      if (input.Prefix !== undefined) {
        if (input.Prefix.includes('year=2026/month=05/day=06')) {
          return {
            IsTruncated: false,
            Contents: [{ Key: `${input.Prefix}data.json` }],
          };
        }
        return { IsTruncated: false, Contents: [] };
      }
      if (input.Key) {
        return {
          Body: {
            transformToString: () =>
              Promise.resolve(
                '{"feedback_text":"Nice","rating":9,"feedback_utc_ts":"2026-05-06T10:00:00.000Z"}\n',
              ),
          },
        };
      }
      throw new Error('unexpected S3 command');
    });

    const { GET } = await import('../route');
    const response = await (GET as (req: NextRequest) => Promise<Response>)(makeRequest('?days=7'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.positive).toBe(1);
    expect(body.partition_errors).toBe(0);
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.daily)).toBe(true);
    expect(body.daily.length).toBe(7);
  });
});
