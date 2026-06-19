import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

const { mockGetSite, mockModifyDomains } = vi.hoisted(function hoisted() {
  return {
    mockGetSite: vi.fn(),
    mockModifyDomains: vi.fn(),
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

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: function withAuth(handler: any) {
    return async function wrapped(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
      const mockAuthContext = {
        jwt: 'test-jwt-token',
        user: {
          customerId: 'auth-customer-1',
          shopperId: 'auth-shopper-1',
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
        modifyDomains: mockModifyDomains,
      };
    }),
  };
});

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sites/site-1/domains', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('/api/sites/[id]/domains', function domainsRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockModifyDomains.mockResolvedValue({
      statusJobId: 'job-1',
      status: 'pending',
      message: 'started',
    });
  });

  it('lowercases fqdn in domainsToCreate and domainsToDelete', async function lowercasesFqdn() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'Example.COM' }],
      domainsToDelete: [{ fqdn: 'Other.NET' }],
    });

    const response = await POST(request, routeParams('site-1'));

    expect(response.status).toBe(200);
    expect(mockModifyDomains).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        domainsToCreate: [{ fqdn: 'example.com' }],
        domainsToDelete: [{ fqdn: 'other.net' }],
      }),
    );
  });

  it('passes transferFromMWP through to client.modifyDomains', async function validTransferFromMwp() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      createCdn: true,
      transferFromMWP: { v2AppId: '1129971' },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.statusJobId).toBe('job-1');
    expect(mockModifyDomains).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        domainsToCreate: [{ fqdn: 'example.com' }],
        transferFromMWP: { v2AppId: '1129971' },
      })
    );
  });

  it('returns 400 when transferFromMWP is null', async function nullTransferFromMwp() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFromMWP: null,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFrom is null', async function nullTransferFrom() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFrom: null,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFrom.appId is empty', async function emptyTransferFromAppId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFrom: {
        appId: '',
        systemId: 'sys-1',
        subscriptionId: 'sub-1',
      },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFrom.systemId is empty', async function emptyTransferFromSystemId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFrom: {
        appId: 'app-1',
        systemId: '',
        subscriptionId: 'sub-1',
      },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFrom.subscriptionId is empty', async function emptyTransferFromSubscriptionId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFrom: {
        appId: 'app-1',
        systemId: 'sys-1',
        subscriptionId: '',
      },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('passes transferFrom through to client.modifyDomains', async function validTransferFrom() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      createCdn: true,
      transferFrom: {
        appId: 'app-1',
        systemId: 'sys-1',
        subscriptionId: 'sub-1',
      },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.statusJobId).toBe('job-1');
    expect(mockModifyDomains).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        domainsToCreate: [{ fqdn: 'example.com' }],
        transferFrom: {
          appId: 'app-1',
          systemId: 'sys-1',
          subscriptionId: 'sub-1',
        },
      })
    );
  });

  it('returns 400 when transferFromMWP.v2AppId is empty', async function emptyV2AppId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFromMWP: { v2AppId: '' },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFromMWP.v2AppId is whitespace-only', async function whitespaceOnlyV2AppId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFromMWP: { v2AppId: '   ' },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFromMWP.v2AppId is non-string', async function nonStringV2AppId() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFromMWP: { v2AppId: 1129971 },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
  });

  it('returns 400 when transferFrom and transferFromMWP are both present', async function mutualExclusion() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      transferFrom: {
        appId: 'a',
        systemId: 's',
        subscriptionId: 'sub',
      },
      transferFromMWP: { v2AppId: 'v2-123' },
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_TRANSFER_FROM);
    expect(body.error).toBe('Cannot specify both transferFrom and transferFromMWP');
    expect(mockModifyDomains).not.toHaveBeenCalled();
  });

  it('passes through when neither transferFrom nor transferFromMWP is provided', async function noTransferPayload() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      createCdn: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.statusJobId).toBe('job-1');
    expect(mockModifyDomains).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        domainsToCreate: [{ fqdn: 'example.com' }],
      })
    );
  });

  it('returns 400 when site is missing subscription_id or system_id', async function incompleteSite() {
    const { POST } = await import('../route');
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: null,
      system_id: 'sys-1',
    });
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(ApiErrorCode.SITE_CONFIG_INCOMPLETE);
    expect(mockModifyDomains).not.toHaveBeenCalled();
  });
});
