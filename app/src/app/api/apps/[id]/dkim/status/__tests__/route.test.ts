import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDkimStatusCached,
  mockGetSite,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetDkimStatusCached: vi.fn(),
  mockGetSite: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/dkim/dkim-cache', () => ({ getDkimStatusCached: mockGetDkimStatusCached }));
vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

const capturedAuthOptions = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler: any, options?: unknown) {
      capturedAuthOptions.set('GET', options);
      return (req: NextRequest, ...args: any[]) =>
        handler(req, { isAuthenticated: true, jwt: 'test-jwt', user: { shopperId: 'sh1', customerId: 'c1' } }, ...args);
    }),
  };
});

import { GET } from '../route';

const APP_ID = 'app1234567';
// Site fixture now includes the domains array — the route validates the
// queried domain against this list to prevent cross-app probes.
const SITE = {
  subscription_id: 'sub-1',
  system_id: 'sys-1',
  domains: [
    { fqdn: 'example.com', isPrimary: true, prefix: '', status: 'active', createdAt: '', updatedAt: '', domainType: null },
    { fqdn: 'shop.example.com', isPrimary: false, prefix: 'shop', status: 'active', createdAt: '', updatedAt: '', domainType: null },
  ],
};
const validStatus = { dkimValid: true, dkimResult: 'DKIM_VALID' };

function makeRequest(domain?: string): NextRequest {
  const url = `https://airo.test/api/apps/${APP_ID}/dkim/status${domain ? `?domain=${domain}` : ''}`;
  return new NextRequest(url, { method: 'GET' });
}

const params = Promise.resolve({ id: APP_ID });

describe('GET /api/apps/[id]/dkim/status', () => {
  beforeEach(() => {
    mockGetSite.mockReset();
    mockGetDkimStatusCached.mockReset();
  });

  it('GET uses default auth level (no options)', () => {
    expect(capturedAuthOptions.get('GET')).toBeUndefined();
  });

  it('returns 400 when domain query param missing', async () => {
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(400);
  });

  it('returns 404 when site not found', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await GET(makeRequest('example.com'), { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 with DKIM status when domain is attached to the app', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDkimStatusCached.mockResolvedValue(validStatus);
    const res = await GET(makeRequest('example.com'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dkimValid).toBe(true);
  });

  it('matches attached domains case-insensitively', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDkimStatusCached.mockResolvedValue(validStatus);
    const res = await GET(makeRequest('EXAMPLE.com'), { params });
    expect(res.status).toBe(200);
  });

  it('returns 403 when queried domain is NOT attached to this app', async () => {
    // Without this guard, an authenticated caller could probe DKIM status
    // for any domain by passing it via ?domain=. The route fetches the
    // site and rejects if the queried fqdn isn't in site.domains.
    mockGetSite.mockResolvedValue(SITE);
    const res = await GET(makeRequest('competitor.com'), { params });
    expect(res.status).toBe(403);
    expect(mockGetDkimStatusCached).not.toHaveBeenCalled();
  });

  it('returns 403 when site has no domains attached', async () => {
    mockGetSite.mockResolvedValue({ ...SITE, domains: [] });
    const res = await GET(makeRequest('example.com'), { params });
    expect(res.status).toBe(403);
    expect(mockGetDkimStatusCached).not.toHaveBeenCalled();
  });

  it('returns 503 when cache throws', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDkimStatusCached.mockRejectedValue(new Error('upstream down'));
    const res = await GET(makeRequest('example.com'), { params });
    expect(res.status).toBe(503);
  });
});
