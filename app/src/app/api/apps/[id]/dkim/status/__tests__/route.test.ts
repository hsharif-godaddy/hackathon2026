import { NextRequest } from 'next/server';
import type { MockInstance } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDkimStatusCached,
  mockGetSite,
  mockLogger,
  mockMarkActive,
  mockGetRow,
  mockClaimDuePoll,
  mockCompleteDuePoll,
  mockCheckSwitchboardFlag,
} = vi.hoisted(() => ({
  mockGetDkimStatusCached: vi.fn(),
  mockGetSite: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockMarkActive: vi.fn().mockResolvedValue(undefined),
  mockGetRow: vi.fn().mockResolvedValue({
    createdAt: null,
    pollStartedAt: '2026-06-17T10:00:00.000Z',
    nextPollAt: '2026-06-17T10:00:30.000Z',
    lastPolledAt: '2026-06-17T10:00:00.000Z',
  }),
  mockClaimDuePoll: vi.fn(),
  mockCompleteDuePoll: vi.fn().mockResolvedValue(undefined),
  mockCheckSwitchboardFlag: vi.fn(),
}));

vi.mock('@/lib/dkim/dkim-cache', () => ({ getDkimStatusCached: mockGetDkimStatusCached }));
vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/dkim/dkim-agent-client', () => ({
  DkimAgentClient: vi.fn(),
}));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

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

import { DkimAgentClient } from '@/lib/dkim/dkim-agent-client';
import { GET } from '../route';

const APP_ID = 'app1234567';
// Site fixture now includes the domains array — the route validates the
// queried domain against this list to prevent cross-app probes.
const SITE = {
  subscription_id: 'sub-1',
  system_id: 'sys-1',
  agent_url: 'https://agent.example',
  domains: [
    { fqdn: 'example.com', isPrimary: true, prefix: '', status: 'active', createdAt: '', updatedAt: '', domainType: null },
    { fqdn: 'shop.example.com', isPrimary: false, prefix: 'shop', status: 'active', createdAt: '', updatedAt: '', domainType: null },
  ],
};
const validStatus = { dkimValid: true, dkimResult: 'DKIM_VALID' };

function makeRequest(domain?: string, externalPolling = false): NextRequest {
  const qs = domain
    ? `?domain=${domain}${externalPolling ? '&polling=external' : ''}`
    : '';
  const url = `https://airo.test/api/apps/${APP_ID}/dkim/status${qs}`;
  return new NextRequest(url, { method: 'GET' });
}

const params = Promise.resolve({ id: APP_ID });

describe('GET /api/apps/[id]/dkim/status', () => {
  beforeEach(() => {
    mockGetSite.mockReset();
    mockGetDkimStatusCached.mockReset();
    mockMarkActive.mockReset();
    mockMarkActive.mockResolvedValue(undefined);
    mockGetRow.mockReset();
    mockGetRow.mockResolvedValue({
      createdAt: null,
      pollStartedAt: '2026-06-17T10:00:00.000Z',
      nextPollAt: '2026-06-17T10:00:30.000Z',
      lastPolledAt: '2026-06-17T10:00:00.000Z',
    });
    mockClaimDuePoll.mockReset();
    mockClaimDuePoll.mockResolvedValue({
      shouldPoll: true,
      expired: false,
      pollStartedAt: '2026-06-17T10:00:00.000Z',
      nextPollAt: '2026-06-17T10:02:00.000Z',
      lastPolledAt: '2026-06-17T10:00:00.000Z',
    });
    mockCompleteDuePoll.mockReset();
    mockCompleteDuePoll.mockResolvedValue(undefined);
    mockCheckSwitchboardFlag.mockReset();
    // Default durable flag to ON so existing reconcile tests pass unchanged.
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    (DkimAgentClient as unknown as MockInstance).mockReset();
    // Must use a regular function (not an arrow) so Vitest can call `new impl()`.
    (DkimAgentClient as unknown as MockInstance).mockImplementation(function () {
      return {
        markActive: mockMarkActive,
        getRow: mockGetRow,
        claimDuePoll: mockClaimDuePoll,
        completeDuePoll: mockCompleteDuePoll,
      };
    });
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

  it('normalizes domain to lowercase before attached check and getDkimStatusCached', async () => {
    // Use a site fixture that has 'acme.com' (lowercase) in its domains list
    const siteWithAcme = {
      ...SITE,
      domains: [
        { fqdn: 'acme.com', isPrimary: true, prefix: '', status: 'active', createdAt: '', updatedAt: '', domainType: null },
      ],
    };
    mockGetSite.mockResolvedValue(siteWithAcme);
    mockGetDkimStatusCached.mockResolvedValue(validStatus);
    // Query with mixed-case — route must lowercase before the attached check
    const res = await GET(makeRequest('Acme.COM'), { params });
    // 'acme.com' is in the site domains so attached check passes → 200
    expect(res.status).toBe(200);
    // getDkimStatusCached must be called with the already-lowercased domain
    expect(mockGetDkimStatusCached).toHaveBeenCalledWith('acme.com');
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

  describe('reconcile-on-read', () => {
    it('promotes to active when dkimValid is true', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
      const res = await GET(makeRequest('example.com'), { params });
      expect(res.status).toBe(200);
      expect(DkimAgentClient).toHaveBeenCalledWith('https://agent.example', APP_ID);
      expect(mockMarkActive).toHaveBeenCalledWith('example.com');
    });

    it('does NOT promote when dkimValid is false', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false, dkimResult: 'pending' });
      await GET(makeRequest('example.com'), { params });
      expect(mockMarkActive).not.toHaveBeenCalled();
    });

    it('does NOT promote when site has no agent_url', async () => {
      mockGetSite.mockResolvedValue({ ...SITE, agent_url: undefined });
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
      await GET(makeRequest('example.com'), { params });
      expect(mockMarkActive).not.toHaveBeenCalled();
    });

    it('returns 200 and warns when markActive rejects', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
      mockMarkActive.mockRejectedValue(new Error('agent down'));
      const res = await GET(makeRequest('example.com'), { params });
      // Let the fire-and-forget .catch microtask settle so the rejection is
      // swallowed before the test ends (avoids unhandled-rejection warnings).
      await new Promise((r) => setImmediate(r));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ dkimValid: true, dkimResult: 'valid', pollStartedAt: null });
    });

    it('does NOT reconcile when durable flag is off', async () => {
      // Both flags off — reconcile must not fire.
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
      const res = await GET(makeRequest('example.com'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      // reconcileEnabled is false so no agent call, pollStartedAt stays null
      expect(body).toEqual({ dkimValid: true, dkimResult: 'valid', pollStartedAt: null });
      // markActive must not have been called — durable layer is disabled.
      expect(mockMarkActive).not.toHaveBeenCalled();
    });

    it('still returns 200 (not 503) when the flag lookup throws', async () => {
      // Switchboard outage must not degrade the status endpoint.
      mockCheckSwitchboardFlag.mockRejectedValue(new Error('switchboard down'));
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'DKIM_VALID' });
      const res = await GET(makeRequest('example.com'), { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ dkimValid: true, dkimResult: 'DKIM_VALID', pollStartedAt: null });
      // Flag lookup failed — reconcile must be skipped (not attempted).
      expect(mockMarkActive).not.toHaveBeenCalled();
    });

    it('does NOT reconcile when base flag is off', async () => {
      // Base flag off, durable flag on — reconcile must still be skipped.
      mockCheckSwitchboardFlag.mockImplementation((name: string) =>
        Promise.resolve(name === 'appbuilder-dkim-durable-state'),
      );
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'valid' });
      const res = await GET(makeRequest('example.com', true), { params });
      expect(res.status).toBe(200);
      expect(mockMarkActive).not.toHaveBeenCalled();
    });
  });

  describe('external durable polling gate', () => {
    it('does not call MailFlow when another device has already claimed the current poll window', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockClaimDuePoll.mockResolvedValue({
        shouldPoll: false,
        expired: false,
        pollStartedAt: '2026-06-17T10:00:00.000Z',
        nextPollAt: '2026-06-17T10:00:30.000Z',
        lastPolledAt: '2026-06-17T10:00:00.000Z',
      });

      const res = await GET(makeRequest('example.com', true), { params });

      expect(res.status).toBe(200);
      expect(mockGetDkimStatusCached).not.toHaveBeenCalled();
      expect(mockCompleteDuePoll).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({
        dkimValid: false,
        dkimResult: 'DKIM_POLL_NOT_DUE',
        pollStartedAt: '2026-06-17T10:00:00.000Z',
        nextPollAt: '2026-06-17T10:00:30.000Z',
        lastPolledAt: '2026-06-17T10:00:00.000Z',
        pollingExpired: false,
      });
    });

    it('completes the durable poll window after a due MailFlow check', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: false, dkimResult: 'pending' });

      const res = await GET(makeRequest('example.com', true), { params });

      expect(res.status).toBe(200);
      expect(mockGetDkimStatusCached).toHaveBeenCalledWith('example.com');
      expect(mockCompleteDuePoll).toHaveBeenCalledWith('example.com');
      expect(await res.json()).toMatchObject({
        dkimValid: false,
        dkimResult: 'pending',
        pollStartedAt: '2026-06-17T10:00:00.000Z',
        nextPollAt: '2026-06-17T10:00:30.000Z',
        pollingExpired: false,
      });
    });

    it('stops polling when the agents schedule is expired', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockClaimDuePoll.mockResolvedValue({
        shouldPoll: false,
        expired: true,
        pollStartedAt: '2026-05-17T10:00:00.000Z',
        nextPollAt: null,
        lastPolledAt: '2026-06-16T10:00:00.000Z',
      });

      const res = await GET(makeRequest('example.com', true), { params });

      expect(res.status).toBe(200);
      expect(mockGetDkimStatusCached).not.toHaveBeenCalled();
      expect(await res.json()).toMatchObject({
        dkimValid: false,
        dkimResult: 'DKIM_POLLING_EXPIRED',
        pollingExpired: true,
        nextPollAt: null,
      });
    });

    it('returns the real DKIM status when the durable row is already active', async () => {
      mockGetSite.mockResolvedValue(SITE);
      mockClaimDuePoll.mockResolvedValue({
        shouldPoll: false,
        expired: false,
        status: 'active',
        pollStartedAt: '2026-06-17T10:00:00.000Z',
        nextPollAt: null,
        lastPolledAt: '2026-06-17T10:10:00.000Z',
      });
      mockGetDkimStatusCached.mockResolvedValue({ dkimValid: true, dkimResult: 'DKIM_VALID' });

      const res = await GET(makeRequest('example.com', true), { params });

      expect(res.status).toBe(200);
      expect(mockGetDkimStatusCached).toHaveBeenCalledWith('example.com');
      expect(mockCompleteDuePoll).not.toHaveBeenCalled();
      expect(await res.json()).toMatchObject({
        dkimValid: true,
        dkimResult: 'DKIM_VALID',
        pollStartedAt: '2026-06-17T10:00:00.000Z',
        nextPollAt: null,
        pollingExpired: false,
      });
    });
  });
});
