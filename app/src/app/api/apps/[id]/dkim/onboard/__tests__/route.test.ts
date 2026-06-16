import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockGetDomainDnsOwnership,
  mockActivate,
  mockLogger,
  mockCheckSwitchboardFlag,
  mockGetDkimStatusCached,
  mockDkimAgentClient,
} = vi.hoisted(() => {
  const mockDkimAgentClientInstance = {
    claim: vi.fn(),
    markActive: vi.fn(),
    setAccepted: vi.fn(),
    setFailed: vi.fn(),
    deleteRow: vi.fn(),
  };
  return {
    mockGetSite: vi.fn(),
    mockGetDomainDnsOwnership: vi.fn(),
    mockActivate: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockCheckSwitchboardFlag: vi.fn(),
    mockGetDkimStatusCached: vi.fn(),
    mockDkimAgentClient: mockDkimAgentClientInstance,
  };
});

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn(function () { return { getDomainDnsOwnership: mockGetDomainDnsOwnership }; }),
  AiroHttpError: class extends Error { status = 500; },
}));
vi.mock('@/lib/dkim/dkim-service', () => ({
  DkimService: vi.fn(function () { return { activate: mockActivate }; }),
}));
vi.mock('@/lib/dkim/dkim-cache', () => ({
  getDkimStatusCached: mockGetDkimStatusCached,
}));
vi.mock('@/lib/dkim/dkim-agent-client', () => ({
  DkimAgentClient: vi.fn(function () { return mockDkimAgentClient; }),
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
    mockGetDkimStatusCached.mockReset();
    mockDkimAgentClient.claim.mockReset();
    mockDkimAgentClient.markActive.mockReset();
    mockDkimAgentClient.setAccepted.mockReset();
    mockDkimAgentClient.setFailed.mockReset();
    mockDkimAgentClient.deleteRow.mockReset();
    mockDkimAgentClient.deleteRow.mockResolvedValue(undefined);

    // Default to flag ON so existing tests don't need to change. Tests
    // that verify the flag-off short-circuit override below.
    mockCheckSwitchboardFlag.mockResolvedValue(true);

    // Default status: not yet valid, so the pre-check does not short-circuit.
    mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false, dkimResult: 'pending' });

    // Default claim: granted (so tests that focus on post-claim behavior work out of the box).
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: true, status: 'pending' });
    mockDkimAgentClient.markActive.mockResolvedValue(undefined);
    mockDkimAgentClient.setAccepted.mockResolvedValue(undefined);
    mockDkimAgentClient.setFailed.mockResolvedValue(undefined);
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

  it('returns 200 skipped no_agent_url when site.agent_url is missing', async () => {
    mockGetSite.mockResolvedValue({ subscription_id: 'sub-1', system_id: 'sys-1' });
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'skipped', reason: 'no_agent_url' });
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

  it('skips Vox and marks active when DKIM is already valid (backfilled domain)', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'noop', reason: 'already_active' });
    expect(mockDkimAgentClient.markActive).toHaveBeenCalledWith('internal.com');
    expect(mockActivate).not.toHaveBeenCalled();
    expect(mockDkimAgentClient.claim).not.toHaveBeenCalled();
  });

  it('proceeds to claim when the pre-check status fetch throws', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockGetDkimStatusCached.mockRejectedValue(new Error('cache miss'));
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:fallback' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Route fell through to claim and then Vox — should return accepted outcome, not an error.
    expect(body.result).toBe('accepted');
    expect(mockDkimAgentClient.claim).toHaveBeenCalled();
  });

  it('returns noop already_active when claim returns claimed=false with status=active', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: false, status: 'active' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'noop', reason: 'already_active' });
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('returns noop in_progress when claim returns claimed=false with status=pending', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: false, status: 'pending' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'noop', reason: 'in_progress' });
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
    // Verify the ARN is persisted back to the agent.
    expect(mockDkimAgentClient.setAccepted).toHaveBeenCalledWith('internal.com', 'arn:123');
  });

  it('returns 200 even when DkimService returns failed (fail-open) and records failure', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockActivate.mockResolvedValue({ result: 'failed', error: 'network' });
    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
    expect(mockDkimAgentClient.setFailed).toHaveBeenCalledWith('internal.com', 'network');
  });

  it('calls Vox directly without claim when durable flag is off', async () => {
    // Base flag on, durable flag off — pre-durable fallback path.
    mockCheckSwitchboardFlag.mockImplementation((name: string) =>
      Promise.resolve(name === 'appbuilder-dkim-onboarding'),
    );
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:fallback' });

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'accepted', executionArn: 'arn:fallback' });
    // Vox was called directly.
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({ appId: APP_ID, domain: 'internal.com', shopperId: 'sh1' }),
      expect.any(NextRequest),
    );
    // Durable claim must NOT have been called.
    expect(mockDkimAgentClient.claim).not.toHaveBeenCalled();
  });

  it('recovers a stale active row when DNS pre-check says invalid', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    // Pre-check: DNS is definitively invalid.
    mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false, dkimResult: 'pending' });
    // First claim: row is stale-active; second claim after delete: succeeds.
    mockDkimAgentClient.claim
      .mockResolvedValueOnce({ claimed: false, status: 'active' })
      .mockResolvedValueOnce({ claimed: true, status: 'pending' });
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:9' });

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ result: 'accepted', executionArn: 'arn:9' });
    expect(mockDkimAgentClient.deleteRow).toHaveBeenCalledWith('internal.com', { ifStatus: 'active' });
    expect(mockDkimAgentClient.claim).toHaveBeenCalledTimes(2);
    expect(mockActivate).toHaveBeenCalled();
  });

  it('does NOT recover stale active when pre-check threw (DNS unknown)', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    // Pre-check throws — DNS state is unknown.
    mockGetDkimStatusCached.mockRejectedValue(new Error('mailflow down'));
    // Claim returns stale active.
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: false, status: 'active' });

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Must NOT delete the row — DNS state is unknown so recovery would be dangerous.
    expect(mockDkimAgentClient.deleteRow).not.toHaveBeenCalled();
    expect(body).toEqual({ result: 'noop', reason: 'already_active' });
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('deletes the speculative row when activate returns skipped after claim', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false });
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: true, status: 'pending' });
    mockActivate.mockResolvedValue({ result: 'skipped', reason: 'unsupported_origin' });

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Speculative pending row must be cleaned up.
    expect(mockDkimAgentClient.deleteRow).toHaveBeenCalledWith('internal.com');
    expect(body).toEqual({ result: 'skipped', reason: 'unsupported_origin' });
  });

  it('still returns the accepted outcome when setAccepted rejects', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    // Default: dkimValid false, so pre-check does not short-circuit.
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: true, status: 'pending' });
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:9' });
    mockDkimAgentClient.setAccepted.mockRejectedValue(new Error('agent down'));

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    // setAccepted failure must not propagate — response should still carry the accepted outcome.
    expect(body).toEqual({ result: 'accepted', executionArn: 'arn:9' });
  });

  it('maps AiroHttpError to its status code', async () => {
    // The mock AiroHttpError class has `status = 500` as a default; override it
    // on the instance to verify the catch→status mapping covers non-500 codes.
    const { AiroHttpError } = await import('@/lib/mgmt-airo');
    const e = new AiroHttpError('upstream gateway error');
    (e as unknown as { status: number }).status = 502;
    mockGetSite.mockRejectedValue(e);

    const res = await POST(makeRequest({ domain: 'internal.com' }), { params });

    expect(res.status).toBe(502);
  });

  it('normalizes domain to lowercase before calling getDkimStatusCached and claim', async () => {
    mockGetSite.mockResolvedValue(SITE);
    mockGetDomainDnsOwnership.mockResolvedValue(INTERNAL_OWNERSHIP);
    // dkimValid false so pre-check does not short-circuit
    mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false, dkimResult: 'pending' });
    // claim granted so Vox is called
    mockDkimAgentClient.claim.mockResolvedValue({ claimed: true, status: 'pending' });
    mockActivate.mockResolvedValue({ result: 'accepted', executionArn: 'arn:norm' });

    const res = await POST(makeRequest({ domain: 'Acme.COM' }), { params });

    expect(res.status).toBe(200);
    // getDkimStatusCached and claim must receive the lowercased domain
    expect(mockGetDkimStatusCached).toHaveBeenCalledWith('acme.com');
    expect(mockDkimAgentClient.claim).toHaveBeenCalledWith('acme.com');
  });
});
