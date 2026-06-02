/**
 * Domain DNS ownership API route tests
 *
 * GET /api/sites/[id]/domain-dns-ownership
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

const { mockGetSite, mockGetDomainDnsOwnership } = vi.hoisted(function hoisted() {
  return {
    mockGetSite: vi.fn(),
    mockGetDomainDnsOwnership: vi.fn(),
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const AUTH_CUSTOMER_ID = 'auth-customer-99';
const AUTH_SHOPPER_ID = 'auth-shopper-88';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const mockAuthContext = {
        jwt: 'test-jwt-token',
        user: {
          customerId: AUTH_CUSTOMER_ID,
          shopperId: AUTH_SHOPPER_ID,
          accountId: 'test-account',
        },
      };
      return handler(request, mockAuthContext, routeContext);
    };
  },
  customerHasAccount: vi.fn(function () { return true; }),
  createCustomerAuthError: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return {
    getSite: mockGetSite,
  }; }),
}));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  return {
    ...actual,
    AiroMgmtClient: vi.fn().mockImplementation(function MockAiroMgmtClient() {
      return {
        getDomainDnsOwnership: mockGetDomainDnsOwnership,
      };
    }),
  };
});

const OWNERSHIP_PAYLOAD = {
  isGdDomain: false,
  isGDDomainOwner: true,
  isGoDaddyDns: false,
  pendingNsPropagation: false,
  domainCreatedAt: null,
  zoneMatchedAt: null,
  nameserverType: 'external',
  nameservers: [] as string[],
  dnsApiResponseCode: null,
  domainsApiResponseCode: null,
};

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('/api/sites/[id]/domain-dns-ownership', function domainDnsOwnershipRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('returns 400 when fqdns query param is missing', async function missingFqdns() {
    const { GET } = await import('../route');
    const request = new NextRequest('http://localhost:3000/api/sites/site-1/domain-dns-ownership');
    const response = await GET(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.FQDNS_REQUIRED);
    expect(mockGetSite).not.toHaveBeenCalled();
    expect(mockGetDomainDnsOwnership).not.toHaveBeenCalled();
  });

  it('returns 400 when site is missing subscription_id or system_id', async function incompleteSite() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: null,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/sites/site-1/domain-dns-ownership?fqdns=example.com'
    );
    const response = await GET(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(ApiErrorCode.SITE_CONFIG_INCOMPLETE);
    expect(mockGetDomainDnsOwnership).not.toHaveBeenCalled();
  });

  it('returns 404 when site is not found', async function siteNotFound() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue(null);

    const request = new NextRequest(
      'http://localhost:3000/api/sites/missing/domain-dns-ownership?fqdns=example.com'
    );
    const response = await GET(request, routeParams('missing'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe(ApiErrorCode.SITE_NOT_FOUND);
    expect(mockGetDomainDnsOwnership).not.toHaveBeenCalled();
  });

  it('returns success with domain ownership data', async function success() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockGetDomainDnsOwnership.mockResolvedValue(OWNERSHIP_PAYLOAD);

    const request = new NextRequest(
      'http://localhost:3000/api/sites/site-1/domain-dns-ownership?fqdns=example.com'
    );
    const response = await GET(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(OWNERSHIP_PAYLOAD);
    expect(mockGetSite).toHaveBeenCalledWith('site-1', 'test-jwt-token');
    expect(mockGetDomainDnsOwnership).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        fqdns: 'example.com',
        customerId: AUTH_CUSTOMER_ID,
        shopperId: AUTH_SHOPPER_ID,
      })
    );
  });

  it('passes through AiroHttpError status', async function airoHttpError() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockGetDomainDnsOwnership.mockRejectedValue(new AiroHttpError(422, 'Unprocessable Entity', 'upstream'));

    const request = new NextRequest(
      'http://localhost:3000/api/sites/site-1/domain-dns-ownership?fqdns=example.com'
    );
    const response = await GET(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe(DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED);
    expect(body.details).toBe('upstream');
  });

  it('returns 500 for unexpected errors', async function genericError() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockGetDomainDnsOwnership.mockRejectedValue(new Error('Unexpected failure'));

    const request = new NextRequest(
      'http://localhost:3000/api/sites/site-1/domain-dns-ownership?fqdns=example.com'
    );
    const response = await GET(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe(DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED);
    expect(body.details).toBe('Unexpected failure');
  });

  it('derives customerId and shopperId from authContext.user, not query params', async function authIdsNotFromQuery() {
    const { GET } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockGetDomainDnsOwnership.mockResolvedValue(OWNERSHIP_PAYLOAD);

    const request = new NextRequest(
      'http://localhost:3000/api/sites/site-1/domain-dns-ownership?fqdns=example.com&customerId=hijacker&shopperId=evil'
    );
    await GET(request, routeParams('site-1'));

    expect(mockGetDomainDnsOwnership).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        fqdns: 'example.com',
        customerId: AUTH_CUSTOMER_ID,
        shopperId: AUTH_SHOPPER_ID,
      })
    );
    expect(mockGetDomainDnsOwnership).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.not.objectContaining({
        customerId: 'hijacker',
        shopperId: 'evil',
      })
    );
  });
});
