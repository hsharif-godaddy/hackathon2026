import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockGetDomainDnsOwnership,
  mockActivate,
  mockLogger,
  mockCheckSwitchboardFlag,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockGetDomainDnsOwnership: vi.fn(),
  mockActivate: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockCheckSwitchboardFlag: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn(function () { return { getDomainDnsOwnership: mockGetDomainDnsOwnership }; }),
}));
vi.mock('@/lib/dkim/dkim-service', () => ({
  DkimService: vi.fn(function () { return { activate: mockActivate }; }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

const capturedAuthOptions = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler: any, options?: unknown) {
      capturedAuthOptions.set('POST', options);
      return (req: NextRequest, ...args: any[]) =>
        handler(req, { isAuthenticated: true, jwt: 'test-jwt', user: { shopperId: 'sh1', customerId: 'c1' } }, ...args);
    }),
  };
});

import { POST } from '../route';

const APP_ID = 'app1234567';
const SITE = { subscription_id: 'sub-1', system_id: 'sys-1', agent_url: 'http://agent' };
const INTERNAL_OWNERSHIP = {
  isGdDomain: true, isGDDomainOwner: true, isGoDaddyDns: true,
  pendingNsPropagation: false, domainCreatedAt: null, zoneMatchedAt: null,
  nameserverType: 'GODADDY', nameservers: [], dnsApiResponseCode: null, domainsApiResponseCode: null,
};
const params = Promise.resolve({ id: APP_ID });

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/dkim/onboard`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/apps/[id]/dkim/onboard', () => {
  beforeEach(() => {
    mockGetSite.mockReset();
    mockGetDomainDnsOwnership.mockReset();
    mockActivate.mockReset();
    mockCheckSwitchboardFlag.mockReset();
    // Default to flag ON so existing tests don't need to change. Tests
    // that verify the flag-off short-circuit override below.
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  it('uses auth level 3', () => {
    expect(capturedAuthOptions.get('POST')).toEqual({ level: 3 });
  });

  it('returns 400 when domain missing', async () => {
    const res = await POST(makeRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it('short-circuits with skipped + feature_flag_off WITHOUT calling getSite or DCC', async () => {
    // Strict gating: when the switchboard flag is off, the route returns
    // immediately. mgmt-hosting and mgmt-airo must NOT be hit — the whole
    // point of the route-level gate is to save those round-trips during
    // partial rollout.
    mockCheckSwitchboardFlag.mockResolvedValue(false);

    const res = await POST(makeRequest({ domain: 'example.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'skipped', reason: 'feature_flag_off' });

    // Critical assertions — these are the load-bearing ones for the gate.
    expect(mockGetSite).not.toHaveBeenCalled();
    expect(mockGetDomainDnsOwnership).not.toHaveBeenCalled();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('returns 404 when site not found', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await POST(makeRequest({ domain: 'example.com' }), { params });
    expect(res.status).toBe(404);
  });

  it('returns 200 skipped when isGoDaddyDns is false', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue({ ...INTERNAL_OWNERSHIP, isGoDaddyDns: false });
    const res = await POST(makeRequest({ domain: 'external.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('skipped');
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('returns 200 accepted for INTERNAL domain', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    // Match the actual DkimActivateOutcome shape — 'accepted', not 'activated'.
    // The previous mock used a value not in the type union; the test passed
    // vacuously because mocks aren't type-checked against the production type.
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:123' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('accepted');
    expect(body.executionArn).toBe('arn:123');
    // Verify the request was plumbed through to DkimService.activate so
    // switchboard's per-shopper criteria can fire.
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP_ID, domain: 'internal.com', shopperId: 'sh1' }),
      expect.any(NextRequest),
    );
  });

  it('returns 200 even when DkimService returns failed (fail-open)', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockActivate.mockResolvedValue({ result: 'failed', error: 'network' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
  });
});
