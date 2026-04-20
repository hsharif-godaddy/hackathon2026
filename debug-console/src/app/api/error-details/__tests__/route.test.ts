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

vi.mock('@/lib/time-range', () => ({
  parseTimeRange: () => ({
    startTime: new Date('2025-01-01T00:00:00.000Z'),
    endTime: new Date('2025-01-02T00:00:00.000Z'),
  }),
}));

const mockLokiSource = {
  id: 'mock-loki',
  name: 'Mock Loki',
  backendType: 'loki' as const,
  lokiEndpoint: 'https://loki.example',
  lokiApiKey: 'key',
  lokiLabels: {},
  environment: 'test',
  fieldMapping: {
    timestampField: '@timestamp',
    levelField: 'level',
    messageField: 'message',
    appIdField: 'app_id',
  },
};

const transformMock = vi.fn();
const queryLokiMock = vi.fn();

vi.mock('@/lib/loki-client', () => ({
  buildLokiQuery: vi.fn(async () => ({})),
  queryLoki: (...args: unknown[]) => queryLokiMock(...args),
  transformLokiResponse: (...args: unknown[]) => transformMock(...args),
}));

vi.mock('@/lib/log-sources', async () => {
  const actual = await vi.importActual<typeof import('@/lib/log-sources')>(
    '@/lib/log-sources'
  );
  return {
    ...actual,
    getAllLogSources: () => [mockLokiSource],
    buildAppIdQuery: () => null,
    DEFAULT_SUMMARY_SOURCE_IDS: ['mock-loki'],
  };
});

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('https://localhost/api/error-details');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: 'GET' });
}

describe('error-details route GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryLokiMock.mockResolvedValue({ data: { result: [] } });
    transformMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns 400 when appId is missing', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ message: 'boom' })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/appId/);
  });

  it('returns 400 when message is missing', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ appId: 'abc' })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/message/);
  });

  it('returns 400 when message exceeds the length cap', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ appId: 'abc', message: 'x'.repeat(501) })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/<= 500/);
  });

  it('Loki path: only returns error-level entries whose message includes the needle', async () => {
    // Populate the Loki response with a mix of levels and messages so we
    // exercise both the `level !== 'error'` guard and the `.includes()` filter.
    transformMock.mockReturnValue([
      {
        id: '1',
        timestamp: '2025-01-01T01:00:00.000Z',
        level: 'error',
        message: 'boom: disk full',
        raw: { a: 1 },
      },
      {
        id: '2',
        timestamp: '2025-01-01T02:00:00.000Z',
        level: 'warn',
        message: 'boom: ignored because not error',
        raw: {},
      },
      {
        id: '3',
        timestamp: '2025-01-01T03:00:00.000Z',
        level: 'error',
        message: 'unrelated failure',
        raw: {},
      },
      {
        id: '4',
        timestamp: '2025-01-01T04:00:00.000Z',
        level: 'error',
        // no message at all — skipped by the !log.message guard
        raw: {},
      },
    ]);

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ appId: 'abc', message: 'boom' })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBe('boom: disk full');
    expect(queryLokiMock).toHaveBeenCalledTimes(1);
  });

  it('Loki path: structured-logger error fires when Loki throws, without failing the response', async () => {
    queryLokiMock.mockRejectedValueOnce(new Error('loki down'));
    const { logger } = await import('@/lib/logger');
    const { GET } = await import('../route');

    const response = await (GET as unknown as (req: NextRequest) => Promise<Response>)(
      makeRequest({ appId: 'abc', message: 'boom' })
    );
    // Individual source failures are swallowed — route still returns 200 with
    // whatever other sources produced (here: nothing).
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      'error-details.loki.failed',
      expect.objectContaining({ sourceId: 'mock-loki', appId: 'abc' }),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});
