import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return (request: NextRequest) =>
      handler(request, {
        jwt: 'test-jwt',
        user: { customerId: 'cust-123', shopperId: 'shopper-456' },
        isAuthenticated: true,
      });
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '../route';

const originalFetch = global.fetch;

function createRequest(
  host = 'airo-builder.test-godaddy.com',
  filter?: object
): NextRequest {
  const filterQuery = filter
    ? `?filter=${encodeURIComponent(JSON.stringify(filter))}`
    : '';
  return new NextRequest(`https://${host}/api/domains${filterQuery}`, {
    method: 'GET',
    headers: { host },
  });
}

function mockFetch(data: unknown, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), { status })
  ) as unknown as typeof fetch;
}

describe('GET /api/domains', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('returns 200 with the domains response from the Domains API', async () => {
    const apiResponse = {
      domains: [
        { domain: 'example.com', hasInternalNameservers: true },
        { domain: 'mysite.com', hasInternalNameservers: true },
      ],
      total: 2,
      startIndex: 0,
      pageSize: 50,
      filter: '',
    };
    mockFetch(apiResponse);

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(apiResponse);
  });

  it('forwards filter query param into the Domains API request body', async () => {
    mockFetch({ domains: [], total: 0 });

    await GET(createRequest('airo-builder.test-godaddy.com', {
      domainStates: ['ACTIVE'],
      hasInternalDNS: true,
    }));

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pagination.filter).toEqual({
      domainStates: ['ACTIVE'],
      hasInternalDNS: true,
    });
  });

  it('sends no filter when no query param is provided', async () => {
    mockFetch({ domains: [], total: 0 });

    await GET(createRequest());

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pagination.filter).toBeUndefined();
  });

  it('calls the test Domains API URL for test-godaddy.com host', async () => {
    mockFetch({ domains: [], total: 0 });

    await GET(createRequest('airo-builder.test-godaddy.com'));

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('domains.dcc.api.test-godaddy.com');
  });

  it('returns 500 when the upstream API call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch domains');
  });

  it('returns 400 for a malformed filter query param', async () => {
    const url = 'https://airo-builder.test-godaddy.com/api/domains?filter=not-valid-json';
    const request = new NextRequest(url, { method: 'GET', headers: { host: 'airo-builder.test-godaddy.com' } });

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Invalid filter parameter');
  });

  it('returns 400 when filter parses to a non-object value', async () => {
    const url = `https://airo-builder.test-godaddy.com/api/domains?filter=${encodeURIComponent('null')}`;
    const request = new NextRequest(url, { method: 'GET', headers: { host: 'airo-builder.test-godaddy.com' } });

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Invalid filter parameter');
  });
});
