import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler,
}));

vi.mock('@/lib/analytics/scorecard/cache', () => ({
  scorecardCached:  vi.fn((_k: string, _t: number, fn: () => unknown) => fn()),
  scorecardCachePeek: vi.fn(() => null),
  scorecardCacheSet:  vi.fn(),
}));

vi.mock('@/lib/analytics/scorecard/s3-feedback', () => ({
  getScorecardS3Data:         vi.fn().mockResolvedValue({ configMissing: true }),
  streamScorecardS3Feed:      vi.fn(),
  getScorecardFeedbackComments: vi.fn().mockResolvedValue({ configMissing: true }),
}));

vi.mock('@/lib/analytics/scorecard/loki', () => ({
  getScorecardLokiData: vi.fn().mockResolvedValue({ configMissing: true }),
}));

vi.mock('@/lib/analytics/scorecard/fs-journey', () => ({
  getJourneyData: vi.fn().mockResolvedValue({ totalSessions: 0 }),
}));

vi.mock('@/lib/analytics/pdna-db', () => ({
  getPdnaSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/route-cache', () => ({
  routeCached:  vi.fn((_k: string, _t: number, fn: () => unknown) => fn()),
  setRouteCache: vi.fn(),
}));

vi.mock('@/lib/clickhouse-c1-client', () => ({
  getClickHouseC1Config: vi.fn(() => null),
  c1Query:       vi.fn().mockResolvedValue([]),
  chFirstNumber: vi.fn(() => 0),
}));

vi.mock('@/lib/analytics/date-range', () => ({
  getDateRangeError: vi.fn(() => null),
  RANGE_DAYS: { '7d': 7, '14d': 14, '30d': 30 },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetModules();
});

function makeRequest(
  params: Record<string, string>,
  cookies: Record<string, string> = {},
): Request {
  const url = new URL('http://localhost/api/analytics/scorecard');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new Request(url.toString());
  Object.defineProperty(req, 'cookies', {
    value: { get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined) },
  });
  return req;
}

type Handler = (req: Request) => Promise<Response>;

describe('scorecard route — action dispatch', () => {
  it('returns 400 for unknown action', async () => {
    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(makeRequest({ action: 'not-a-real-action' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/unknown action/i);
  });
});

describe('scorecard route — bmp-feedback guards', () => {
  it('returns configMissing when auth_jomax cookie is absent', async () => {
    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(makeRequest({ action: 'bmp-feedback' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { configMissing: boolean };
    expect(body.configMissing).toBe(true);
  });

  it('returns 400 when only start is provided without end', async () => {
    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'bmp-feedback', start: '2026-06-01' }, { auth_jomax: 'tok' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('start and end');
  });

  it('returns 400 when only end is provided without start', async () => {
    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'bmp-feedback', end: '2026-06-07' }, { auth_jomax: 'tok' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('start and end');
  });

  it('returns 400 when getDateRangeError reports an invalid range', async () => {
    const { getDateRangeError } = await import('@/lib/analytics/date-range');
    vi.mocked(getDateRangeError).mockReturnValueOnce('end must be after start');

    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'bmp-feedback', start: '2026-06-10', end: '2026-06-01' }, { auth_jomax: 'tok' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('end must be after start');
  });
});

describe('scorecard route — bmp-feedback input sanitization', () => {
  it('strips measures with invalid chars and only sends safe names to BMP', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { metricRequest: { metrics: [] } } }),
    });
    global.fetch = fetchSpy;

    const { GET } = await import('../route');
    await (GET as unknown as Handler)(
      makeRequest(
        { action: 'bmp-feedback', measures: 'valid_measure,bad<script>,another_ok' },
        { auth_jomax: 'tok' },
      ),
    );

    expect(fetchSpy).toHaveBeenCalled();
    const body: string = (fetchSpy.mock.calls[0] as [string, { body: string }])[1].body;
    expect(body).toContain('valid_measure');
    expect(body).toContain('another_ok');
    expect(body).not.toContain('bad<script>');
  });

  it('falls back to default measures when all provided measures are invalid', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { metricRequest: { metrics: [] } } }),
    });
    global.fetch = fetchSpy;

    const { GET } = await import('../route');
    await (GET as unknown as Handler)(
      makeRequest(
        { action: 'bmp-feedback', measures: '"; DROP TABLE--,<xss>' },
        { auth_jomax: 'tok' },
      ),
    );

    expect(fetchSpy).toHaveBeenCalled();
    const body: string = (fetchSpy.mock.calls[0] as [string, { body: string }])[1].body;
    // default fallback measures
    expect(body).toContain('positive_count');
    expect(body).toContain('negative_count');
    expect(body).toContain('total_count');
  });
});

describe('scorecard route — BMP error mapping', () => {
  it('returns 502 when BMP responds with a non-OK HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'bmp-feedback' }, { auth_jomax: 'tok' }),
    );
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('503');
  });

  it('returns 502 when BMP GraphQL returns an errors array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: 'metric not found' }] }),
    });

    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'bmp-feedback' }, { auth_jomax: 'tok' }),
    );
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('metric not found');
  });
});

describe('scorecard route — feedback-s3 SSE', () => {
  it('returns text/event-stream content-type', async () => {
    const { streamScorecardS3Feed } = await import('@/lib/analytics/scorecard/s3-feedback');
    vi.mocked(streamScorecardS3Feed).mockImplementationOnce(async (_sp, emit) => {
      emit({ type: 'result', configMissing: true });
    });

    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(
      makeRequest({ action: 'feedback-s3', days: '7' }),
    );
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });
});

describe('scorecard route — c1-events config guard', () => {
  it('returns configMissing when ClickHouse is not configured', async () => {
    const { GET } = await import('../route');
    const res = await (GET as unknown as Handler)(makeRequest({ action: 'c1-events' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { configMissing: boolean };
    expect(body.configMissing).toBe(true);
  });
});
