import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock withAuth to pass through the handler directly
vi.mock('@/lib/api-auth', () => ({
  withAuth: (handler: unknown) => handler
}));

describe('llm-spend route', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://es.example.com';
    process.env.AIRO_BUILDER_ES_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  function makeRequest(params: Record<string, string | string[]>) {
    const url = new URL('http://localhost/api/llm-spend');
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach(val => url.searchParams.append(k, val));
      } else {
        url.searchParams.set(k, v);
      }
    });
    return new Request(url.toString());
  }

  it('should return 400 when grantUserId is missing', async () => {
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('grantUserId');
  });

  it('should return 500 when ES credentials are not configured', async () => {
    delete process.env.AIRO_BUILDER_ES_ENDPOINT;
    delete process.env.AIRO_BUILDER_ES_API_KEY;
    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123' }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('credentials');
  });

  it('should aggregate spend data from ES hits grouped by end_user', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _source: {
                date: '2026-03-05',
                end_user: 'airo-builder:grant:test123',
                spend: 1.5,
                prompt_tokens: 1000,
                completion_tokens: 500,
                total_tokens: 1500,
                cache_read_input_tokens: 200,
                cache_creation_input_tokens: 50,
                api_requests: 10
              }
            },
            {
              _source: {
                date: '2026-03-04T00:00:00.000Z',
                end_user: 'airo-builder:grant:test123',
                spend: 2.5,
                prompt_tokens: 2000,
                completion_tokens: 1000,
                total_tokens: 3000,
                cache_read_input_tokens: 400,
                cache_creation_input_tokens: 100,
                api_requests: 20
              }
            }
          ]
        }
      })
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123', subscriptionId: 'sub123' }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.subscriptionId).toBe('sub123');
    expect(body.totalSpend).toBe(4.0);
    expect(body.totalTokens).toBe(4500);
    expect(body.totalRequests).toBe(30);
    expect(body.grantBreakdowns).toHaveLength(1);
    expect(body.grantBreakdowns[0].grantUserId).toBe('airo-builder:grant:test123');
    expect(body.grantBreakdowns[0].dailySpend).toHaveLength(2);
    expect(body.docCount).toBe(2);
  });

  it('should normalize ISO date to yyyy-MM-dd', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              date: '2026-03-05T12:30:00.000Z',
              end_user: 'airo-builder:grant:test123',
              spend: 1.0,
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              api_requests: 5
            }
          }]
        }
      })
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123' }));
    const body = await response.json();

    expect(body.grantBreakdowns[0].dailySpend[0].date).toBe('2026-03-05');
  });

  it('should return empty data when no hits found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hits: { total: { value: 0 }, hits: [] }
      })
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123' }));
    const body = await response.json();

    expect(body.totalSpend).toBe(0);
    expect(body.totalTokens).toBe(0);
    expect(body.totalRequests).toBe(0);
    expect(body.grantBreakdowns).toHaveLength(1);
    expect(body.grantBreakdowns[0].dailySpend).toHaveLength(0);
    expect(body.docCount).toBe(0);
  });

  it('should handle ES query failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable')
    });

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('503');
  });

  it('should handle fetch exceptions', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { GET } = await import('../route');
    const response = await (GET as unknown as (req: Request) => Promise<Response>)(makeRequest({ grantUserId: 'airo-builder:grant:test123' }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toContain('Network error');
  });
});
