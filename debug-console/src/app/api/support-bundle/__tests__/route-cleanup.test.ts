import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler as (req: NextRequest) => Promise<Response>,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('@/lib/langfuse-eb-client', () => ({
  getLangfuseEbConfig: () => null,
  resolveCustomerId: vi.fn().mockResolvedValue(null),
}));

const streamConfiguredLogSourcesMock = vi.fn();
vi.mock('@/app/api/support-bundle/log-streams', () => ({
  streamConfiguredLogSources: (...args: unknown[]) => streamConfiguredLogSourcesMock(...args),
}));

const findAnchorTimestampMock = vi.fn();
const streamTracesMock = vi.fn();
vi.mock('@/app/api/support-bundle/langfuse-streams', () => ({
  findAnchorTimestamp: (...args: unknown[]) => findAnchorTimestampMock(...args),
  streamTraces: (...args: unknown[]) => streamTracesMock(...args),
}));

import { GET } from '@/app/api/support-bundle/route';

function makeRequest(appId = 'app-1'): NextRequest {
  return new NextRequest(
    new URL(`https://test/api/support-bundle?appId=${appId}`),
  );
}

// withAuth wraps the inner handler so its TS signature is (req, ctx). The
// vi.mock above bypasses the wrapper at runtime so only `request` is read,
// but we still need to satisfy the compiled type with a stub context.
const stubCtx = { params: Promise.resolve({}) } as unknown as Parameters<typeof GET>[1];

async function drain(stream: ReadableStream | null): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // Aborted streams are expected when buildArchive throws; swallow.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

describe('GET /api/support-bundle inFlightBundles cleanup', () => {
  beforeEach(() => {
    streamConfiguredLogSourcesMock.mockReset();
    findAnchorTimestampMock.mockReset();
    streamTracesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the in-flight guard after the response when buildArchive rejects', async () => {
    // Without the outer .catch() on buildArchive(), a rejection here would
    // leave appId permanently in the in-flight set and every subsequent
    // request for it would 429. Verify by issuing a second request and
    // asserting it is NOT 429.
    streamConfiguredLogSourcesMock.mockRejectedValue(new Error('boom'));

    const first = await GET(makeRequest('cleanup-app'), stubCtx);
    expect(first.status).toBe(200);

    // Drain the stream so buildArchive's .catch() runs and clears the guard.
    await drain(first.body);

    streamConfiguredLogSourcesMock.mockResolvedValue({});

    const second = await GET(makeRequest('cleanup-app'), stubCtx);
    expect(second.status).toBe(200);
    await drain(second.body);
  });

  it('returns 429 while a bundle is still building for the same appId', async () => {
    // Block streamConfiguredLogSources so the first request stays in-flight
    // while we issue the second request. This locks in the 429 contract that
    // the cleanup test above must distinguish from a permanent block.
    let release!: () => void;
    streamConfiguredLogSourcesMock.mockImplementation(
      function () { return new Promise((resolve) => {
        release = () => resolve({});
      }); },
    );

    const first = await GET(makeRequest('busy-app'), stubCtx);
    expect(first.status).toBe(200);

    const concurrent = await GET(makeRequest('busy-app'), stubCtx);
    expect(concurrent.status).toBe(429);

    release();
    await drain(first.body);
  });
});
