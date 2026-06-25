import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiroHttpError } from '@/lib/mgmt-airo';
import { ApiErrorCode } from '@/utils/api-errors';
import { DomainApiErrorCode } from '@/utils/domain-validation';

const { mockGetSite, mockCaaRemediation } = vi.hoisted(function hoisted() {
  return {
    mockGetSite: vi.fn(),
    mockCaaRemediation: vi.fn(),
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

// Route calls enforceAabMultiUserVentureRelation → checkSwitchboardFlag; mock it
// to "off" so it no-ops without hitting real gasket (Atlas plugin → fetch error).
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn().mockResolvedValue(false),
  checkSwitchboardValue: vi.fn().mockResolvedValue(null),
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
        caaRemediation: mockCaaRemediation,
      };
    }),
  };
});

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/sites/site-1/domains/caa-remediation', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('/api/sites/[id]/domains/caa-remediation', function caaRemediationRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue({
      id: 'site-1',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });
    mockCaaRemediation.mockResolvedValue({
      statusJobId: 'job-1',
      status: 'running',
      message: 'CAA remediation workflow initiated',
    });
  });

  it('starts remediation and returns the status job on the happy path', async function happyPath() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'Example.COM', primary: true }],
      createCdn: true,
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.statusJobId).toBe('job-1');
    expect(mockCaaRemediation).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        domainsToCreate: [{ fqdn: 'example.com', primary: true }],
        createCdn: true,
        consent: true,
      }),
    );
  });

  it('forwards an optional issuer override and supports fqdnsToCreate', async function issuerAndFqdns() {
    const { POST } = await import('../route');
    const request = createRequest({
      fqdnsToCreate: ['Example.COM'],
      consent: true,
      issuer: 'pki.goog',
    });

    const response = await POST(request, routeParams('site-1'));

    expect(response.status).toBe(200);
    expect(mockCaaRemediation).toHaveBeenCalledWith(
      'sub-1',
      'sys-1',
      'site-1',
      expect.objectContaining({
        fqdnsToCreate: ['example.com'],
        consent: true,
        issuer: 'pki.goog',
      }),
    );
  });

  it('returns 400 CONSENT_REQUIRED when consent is not true', async function consentRequired() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      consent: false,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.CONSENT_REQUIRED);
    expect(mockCaaRemediation).not.toHaveBeenCalled();
  });

  it('returns 400 when no domains are supplied', async function noDomains() {
    const { POST } = await import('../route');
    const request = createRequest({ consent: true });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.DOMAIN_OPERATION_REQUIRED);
    expect(mockCaaRemediation).not.toHaveBeenCalled();
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
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(ApiErrorCode.SITE_CONFIG_INCOMPLETE);
    expect(mockCaaRemediation).not.toHaveBeenCalled();
  });

  it('returns 404 SITE_NOT_FOUND when the site does not exist', async function siteNotFound() {
    const { POST } = await import('../route');
    mockGetSite.mockResolvedValue(null);
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe(ApiErrorCode.SITE_NOT_FOUND);
    expect(mockCaaRemediation).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_DOMAIN_FORMAT for a non-string fqdn', async function badFqdn() {
    const { POST } = await import('../route');
    const request = createRequest({
      domainsToCreate: [{ fqdn: 123 }],
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe(DomainApiErrorCode.INVALID_DOMAIN_FORMAT);
    expect(mockCaaRemediation).not.toHaveBeenCalled();
  });

  it('passes through the upstream status on an AiroHttpError', async function upstreamHttpError() {
    const { POST } = await import('../route');
    mockCaaRemediation.mockRejectedValue(new AiroHttpError(409, 'Conflict', { code: 'CAA_CONFLICT' }));
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe(DomainApiErrorCode.CAA_REMEDIATION_FAILED);
  });

  it('returns 500 CAA_REMEDIATION_FAILED on an unexpected error', async function unexpectedError() {
    const { POST } = await import('../route');
    mockCaaRemediation.mockRejectedValue(new Error('boom'));
    const request = createRequest({
      domainsToCreate: [{ fqdn: 'example.com' }],
      consent: true,
    });

    const response = await POST(request, routeParams('site-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe(DomainApiErrorCode.CAA_REMEDIATION_FAILED);
  });
});
