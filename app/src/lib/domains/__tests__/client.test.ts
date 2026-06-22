import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainsClient } from '../client';

const BASE_URL = 'https://domains.dcc.api.test-godaddy.com';
const JWT = 'test-jwt';
const CUSTOMER_ID = 'cust-123';

function makeClient(): DomainsClient {
  return new DomainsClient({ baseUrl: BASE_URL, jwt: JWT, maxRetries: 1 });
}

const originalFetch = global.fetch;

describe('DomainsClient.getAllDomainsForCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends no filter in pagination when none is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domains: [], total: 0 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeClient().getAllDomainsForCustomer(CUSTOMER_ID);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pagination.filter).toBeUndefined();
  });

  it('sends the picker filter (domainStates + hasInternalDNS) inside pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domains: [], total: 0 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeClient().getAllDomainsForCustomer(CUSTOMER_ID, {
      filter: { domainStates: ['ACTIVE'], hasInternalDNS: true },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pagination.filter).toEqual({
      domainStates: ['ACTIVE'],
      hasInternalDNS: true,
    });
  });

  it('sends partial filter when only some fields are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domains: [], total: 0 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeClient().getAllDomainsForCustomer(CUSTOMER_ID, {
      filter: { domainStates: ['ACTIVE'] },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pagination.filter).toEqual({ domainStates: ['ACTIVE'] });
  });

  it('sends the correct URL and method', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domains: [], total: 0 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeClient().getAllDomainsForCustomer(CUSTOMER_ID);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v2/customers/${CUSTOMER_ID}/domains/get`);
    expect(init.method).toBe('POST');
  });

  it('includes default pagination fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domains: [], total: 0 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await makeClient().getAllDomainsForCustomer(CUSTOMER_ID, { pageSize: 25 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { pagination } = JSON.parse(init.body as string);
    expect(pagination.pageSize).toBe(25);
    expect(pagination.sortColumn).toBe('domainName');
    expect(pagination.sortDirection).toBe('ascending');
    expect(pagination.pagingDirection).toBe('forward');
  });
});
