import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/log-sources', () => ({
  getLogSourceConfig: vi.fn(() => ({
    id: 'airo-agents',
    lokiEndpoint: 'https://loki.test',
    lokiApiKey: '',
    lokiLabels: { service_name: 'airo-agents', env: 'dev' },
    environment: 'dev',
    fieldMapping: {},
  })),
}));

vi.mock('@/lib/investigate/evidence', () => ({
  resolveAppCluster: vi.fn(async () => null),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getStripeStatusFromLogs } from '../stripe-status';
import { getLogSourceConfig } from '@/lib/log-sources';

const originalFetch = global.fetch;

function ns(iso: string): string {
  return (BigInt(new Date(iso).getTime()) * 1_000_000n).toString();
}

function streams(values: Array<[string, string]>): Response {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: { resultType: 'streams', result: [{ values }] },
    }),
    text: async () => '',
  } as unknown as Response;
}

describe('getStripeStatusFromLogs', () => {
  beforeEach(() => {
    process.env.ENVIRONMENT_NAME = 'dev';
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns configured with sandboxId/claimStatus from the most recent status.success', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-20T10:00:00.000Z'),
          JSON.stringify({
            event: 'skill.stripe.status.success',
            sandboxId: 'sb_123',
            claimStatus: 'claimed',
          }),
        ],
        [
          ns('2026-06-19T10:00:00.000Z'),
          JSON.stringify({ event: 'skill.stripe.setup.success', sandboxId: 'sb_123' }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('injheqgfdb');

    expect(result).toEqual({
      detected: true,
      skillInstalled: false,
      configured: true,
      sandboxId: 'sb_123',
      claimStatus: 'claimed',
      lastSeenAt: '2026-06-20T10:00:00.000Z',
    });
  });

  it('reads sandboxId/claimStatus nested under a data object', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-20T10:00:00.000Z'),
          JSON.stringify({
            event: 'skill.stripe.status.success',
            data: { sandboxId: 'sb_data', claimStatus: 'live' },
          }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result.configured).toBe(true);
    expect(result.sandboxId).toBe('sb_data');
    expect(result.claimStatus).toBe('live');
  });

  it('treats a more recent not_found as not configured even when an earlier success exists', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-21T10:00:00.000Z'),
          JSON.stringify({ event: 'skill.stripe.status.not_found' }),
        ],
        [
          ns('2026-06-19T10:00:00.000Z'),
          JSON.stringify({ event: 'skill.stripe.setup.success', sandboxId: 'sb_old' }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.sandboxId).toBeNull();
    expect(result.lastSeenAt).toBe('2026-06-21T10:00:00.000Z');
  });

  it('treats a legacy setup as configured with claimStatus legacy', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [ns('2026-06-22T10:00:00.000Z'), JSON.stringify({ event: 'skill.stripe.setup.legacy' })],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result).toEqual({
      detected: true,
      skillInstalled: false,
      configured: true,
      sandboxId: null,
      claimStatus: 'legacy',
      lastSeenAt: '2026-06-22T10:00:00.000Z',
    });
  });

  it('detects Stripe intent when only an incomplete setup.begin event exists', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [ns('2026-06-22T10:00:00.000Z'), JSON.stringify({ event: 'skill.stripe.setup.begin' })],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.sandboxId).toBeNull();
    expect(result.lastSeenAt).toBe('2026-06-22T10:00:00.000Z');
  });

  it('detects Stripe intent from agent file edits touching a stripe code path', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-25T19:42:33.000Z'),
          JSON.stringify({
            event: 'develop_agent.tool.file_edit.success',
            data: {
              filePath: 'src/server/api/stripe/create-checkout-session/POST.ts',
              operation: 'str_replace',
            },
          }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('injheqgfdb');

    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.sandboxId).toBeNull();
    expect(result.lastSeenAt).toBe('2026-06-25T19:42:33.000Z');
  });

  it('ignores non-stripe agent lines that merely mention the word stripe', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-25T19:00:00.000Z'),
          JSON.stringify({
            event: 'develop_agent.tool.file_edit.success',
            data: { filePath: 'src/pages/index.tsx', operation: 'str_replace' },
            message: 'mention of stripe in passing',
          }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result.detected).toBe(false);
  });

  it('detects intent and skillInstalled from payment/stripe skill-install events', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-25T19:32:57.000Z'),
          JSON.stringify({
            event: 'skill.install.success',
            data: { skill: 'payment/stripe', filesInstalled: 15 },
          }),
        ],
        [
          ns('2026-06-25T19:32:50.000Z'),
          JSON.stringify({
            event: 'skill.install.file_copied',
            data: { skill: 'payment/stripe', to: 'src/lib/stripe/format.ts' },
          }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('injheqgfdb');

    expect(result.detected).toBe(true);
    expect(result.skillInstalled).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.sandboxId).toBeNull();
    expect(result.lastSeenAt).toBe('2026-06-25T19:32:57.000Z');
  });

  it('records skillInstalled from applied_skills.install.recorded', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      streams([
        [
          ns('2026-06-25T19:32:57.000Z'),
          JSON.stringify({
            event: 'applied_skills.install.recorded',
            data: { skillName: 'payment/stripe', appPath: '/alloc/customer-app/x/preview' },
          }),
        ],
      ])
    );

    const result = await getStripeStatusFromLogs('app1');

    expect(result.detected).toBe(true);
    expect(result.skillInstalled).toBe(true);
  });

  it('returns not configured when no matching lines exist', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(streams([]));

    const result = await getStripeStatusFromLogs('app1');

    expect(result).toEqual({
      detected: false,
      skillInstalled: false,
      configured: false,
      sandboxId: null,
      claimStatus: null,
      lastSeenAt: null,
    });
  });

  it('degrades to not configured when Loki config lookup throws', async () => {
    vi.mocked(getLogSourceConfig).mockImplementationOnce(() => {
      throw new Error('LOKI_ENDPOINT is required');
    });

    const result = await getStripeStatusFromLogs('app1');

    expect(result).toEqual({
      detected: false,
      skillInstalled: false,
      configured: false,
      sandboxId: null,
      claimStatus: null,
      lastSeenAt: null,
    });
  });

  it('degrades to not configured when the Loki request fails', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'down',
    } as unknown as Response);

    const result = await getStripeStatusFromLogs('app1');

    expect(result.configured).toBe(false);
  });

  it('degrades to not configured when fetch throws', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('network'));

    const result = await getStripeStatusFromLogs('app1');

    expect(result.configured).toBe(false);
  });
});
