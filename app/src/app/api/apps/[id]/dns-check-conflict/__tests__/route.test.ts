import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

const { mockAiroMgmtClient, mockAuthenticateCustomer, mockControlPlaneAdapter, mockLogger } = vi.hoisted(
  function setup() {
    return {
      mockAiroMgmtClient: {
        checkDnsConflict: vi.fn(),
      },
      mockAuthenticateCustomer: vi.fn(),
      mockControlPlaneAdapter: {
        getSite: vi.fn(),
      },
      mockLogger: {
        error: vi.fn(),
        info: vi.fn(),
      },
    };
  }
);

vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
  };
});

vi.mock('@/lib/mgmt-airo', function mockMgmtAiroModule() {
  return {
    AiroMgmtClient: vi.fn().mockImplementation(function () { return mockAiroMgmtClient; }),
  };
});

vi.mock('@/lib/request-context', function mockLoggerModule() {
  return {
    logger: mockLogger,
  };
});

vi.mock('@/lib/customer-auth', async function mockCustomerAuthModule() {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function withCustomerAuth(handler) {
      return async function wrappedHandler(request: NextRequest, ...args: any[]) {
        const authContext = await mockAuthenticateCustomer(request);
        if (!authContext.isAuthenticated) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized', requiresAuth: true }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return handler(request, authContext, ...args);
      };
    }),
    createCustomerAuthError: vi.fn(function createCustomerAuthError(message: string, status: number) {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
    customerHasAccount: vi.fn(function customerHasAccount(user) {
      return !!user.accountId;
    }),
  };
});

const MOCK_SITE_ID = 'site-123';
const MOCK_FQDN = 'example.com';
const MOCK_SUBSCRIPTION_ID = 'sub-123';
const MOCK_SYSTEM_ID = 'sys-123';

const MOCK_USER = {
  accountId: 'account-123',
  customerId: 'customer-123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  shopperId: 'shopper-123',
};

function createMockRequest(siteId: string, fqdn?: string): NextRequest {
  const search = fqdn ? `?fqdn=${encodeURIComponent(fqdn)}` : '';
  return new NextRequest(
    `http://localhost:3000/api/apps/${siteId}/dns-check-conflict${search}`,
    { method: 'GET' }
  );
}

describe('dns-check-conflict GET', function routeTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();

    mockAuthenticateCustomer.mockResolvedValue({
      isAuthenticated: true,
      jwt: 'user-jwt-token',
      user: MOCK_USER,
    });

    mockControlPlaneAdapter.getSite.mockResolvedValue({
      account_id: 'account-123',
      domains: [{ fqdn: MOCK_FQDN }],
      id: MOCK_SITE_ID,
      subscription_id: MOCK_SUBSCRIPTION_ID,
      system_id: MOCK_SYSTEM_ID,
    });

    mockAiroMgmtClient.checkDnsConflict.mockResolvedValue({
      currentIps: ['160.153.0.2'],
      failedOpen: false,
      hasProductDNSConflict: false,
    });
  });

  it('returns dns conflict response for valid request', async function success() {
    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      currentIps: ['160.153.0.2'],
      failedOpen: false,
      hasProductDNSConflict: false,
    });
    expect(mockAiroMgmtClient.checkDnsConflict).toHaveBeenCalledWith(
      MOCK_SUBSCRIPTION_ID,
      MOCK_SYSTEM_ID,
      MOCK_SITE_ID,
      MOCK_FQDN
    );
  });

  it('returns 400 when fqdn query param is missing', async function missingFqdn() {
    const request = createMockRequest(MOCK_SITE_ID);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('fqdn query param is required');
  });

  it('returns 403 when user does not have an account', async function noAccount() {
    mockAuthenticateCustomer.mockResolvedValue({
      isAuthenticated: true,
      jwt: 'user-jwt-token',
      user: {
        ...MOCK_USER,
        accountId: '',
      },
    });

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('You must have an account to check DNS conflicts');
  });

  it('returns 404 when site is missing', async function siteNotFound() {
    mockControlPlaneAdapter.getSite.mockResolvedValue(null);

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Site not found');
  });

  it('returns 400 when fqdn is invalid', async function invalidFqdnFormat() {
    const request = createMockRequest(MOCK_SITE_ID, 'not-a-domain');
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid fqdn query param');
  });

  it('returns 400 when fqdn does not belong to site domains', async function fqdnNotAttachedToSite() {
    const request = createMockRequest(MOCK_SITE_ID, 'otherdomain.com');
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('fqdn must match a domain attached to this site');
  });

  it('returns 400 when site is missing subscription or system ids', async function missingSiteMetadata() {
    mockControlPlaneAdapter.getSite.mockResolvedValue({
      account_id: 'account-123',
      domains: [{ fqdn: MOCK_FQDN }],
      id: MOCK_SITE_ID,
      subscription_id: undefined,
      system_id: MOCK_SYSTEM_ID,
    });

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Site missing required metadata (subscription_id or system_id)');
  });

  it('maps downstream 4xx status codes to 502', async function mapsDownstream4xxToBadGateway() {
    const downstreamError = Object.assign(new Error('App not found'), { status: 404 });
    mockAiroMgmtClient.checkDnsConflict.mockRejectedValue(downstreamError);

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toBe('Failed to check DNS conflict');
    expect(payload).not.toHaveProperty('details');
  });

  it('preserves downstream 5xx status codes', async function preservesDownstream5xx() {
    const downstreamError = Object.assign(new Error('Internal server error'), { status: 503 });
    mockAiroMgmtClient.checkDnsConflict.mockRejectedValue(downstreamError);

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

    expect(response.status).toBe(503);
  });

  it('returns 500 when downstream error status is not in HTTP error range', async function invalidErrorStatus() {
    const downstreamError = Object.assign(new Error('Unexpected status'), { status: 200 });
    mockAiroMgmtClient.checkDnsConflict.mockRejectedValue(downstreamError);

    const request = createMockRequest(MOCK_SITE_ID, MOCK_FQDN);
    const response = await GET(request, { params: Promise.resolve({ id: MOCK_SITE_ID }) });

    expect(response.status).toBe(500);
  });
});
