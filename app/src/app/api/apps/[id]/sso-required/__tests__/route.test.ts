/**
 * BFF `PUT /api/apps/[id]/sso-required` route tests.
 *
 * Covers the Phase-2 customer-facing toggle:
 *   - tri-state body validation (true / false / null / missing)
 *   - IDOR guard (404 on cross-tenant)
 *   - 409 when no SSO config or subscription bound
 *   - airo-go 409 OVERRIDE_LOCKED → BFF 409 sso_toggle_locked
 *   - airo-go 404 → BFF 404
 *   - happy path returns the server-authoritative resolved fields
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSite, mockSetAppSsoRequired, mockLogger } = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockSetAppSsoRequired: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({ getSite: mockGetSite }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

// Stub AiroMgmtClient.setAppSsoRequired without faking the rest of the
// client surface — the route only constructs a fresh instance per call.
vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  class FakeAiroMgmtClient {
    setAppSsoRequired = mockSetAppSsoRequired;
  }
  return {
    ...actual,
    AiroMgmtClient: FakeAiroMgmtClient,
  };
});

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler: any) => async (request: NextRequest, ...args: any[]) =>
      handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
    ),
  };
});

import { AiroHttpError } from '@/lib/mgmt-airo';
import { PUT } from '../route';

const APP_ID = 'app-abc123';
const params = Promise.resolve({ id: APP_ID });

function makeReq(body?: string): NextRequest {
  const init: RequestInit = { method: 'PUT' };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/sso-required`, init);
}

describe('PUT /api/apps/[id]/sso-required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      subscription_id: 'sub-1',
      ssoConfigId: 'cfg-godaddy-shopper',
    });
    mockSetAppSsoRequired.mockResolvedValue({
      appId: APP_ID,
      ssoConfigId: 'cfg-godaddy-shopper',
      ssoRequired: true,
      ssoRequiredOverride: true,
      ssoOverrideAllowed: true,
    });
  });

  it('returns 200 + resolved server fields when toggling ON', async () => {
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      appId: APP_ID,
      ssoRequired: true,
      ssoRequiredOverride: true,
      ssoOverrideAllowed: true,
    });
    expect(mockSetAppSsoRequired).toHaveBeenCalledWith('sub-1', APP_ID, true);
  });

  it('accepts ssoRequired:false', async () => {
    mockSetAppSsoRequired.mockResolvedValue({
      appId: APP_ID,
      ssoConfigId: 'cfg-godaddy-shopper',
      ssoRequired: false,
      ssoRequiredOverride: false,
      ssoOverrideAllowed: true,
    });
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: false })), { params });
    expect(res.status).toBe(200);
    expect(mockSetAppSsoRequired).toHaveBeenCalledWith('sub-1', APP_ID, false);
  });

  it('accepts ssoRequired:null (clear override → defer to admin tier)', async () => {
    mockSetAppSsoRequired.mockResolvedValue({
      appId: APP_ID,
      ssoConfigId: 'cfg-godaddy-shopper',
      ssoRequired: false,
      ssoRequiredOverride: null,
      ssoOverrideAllowed: true,
    });
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: null })), { params });
    expect(res.status).toBe(200);
    expect(mockSetAppSsoRequired).toHaveBeenCalledWith('sub-1', APP_ID, null);
  });

  it('returns 400 when ssoRequired field is missing', async () => {
    const res = await PUT(makeReq(JSON.stringify({})), { params });
    expect(res.status).toBe(400);
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
  });

  it('returns 400 when ssoRequired is not bool|null', async () => {
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: 'yes' })), { params });
    expect(res.status).toBe(400);
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await PUT(makeReq('not-json'), { params });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the caller does not own the app (IDOR guard)', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(404);
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller is a collaborator (sharedWithMe)', async () => {
    // airo-go already enforces EntityOwner upstream, but the BFF check
    // fast-fails before the call and keeps the authz model consistent
    // across the three SSO routes. Use sharedWithMe (explicit FGA flag)
    // rather than owner_customer_id compare — LCP-friendly.
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-owner-not-caller',
      sharedWithMe: true,
      subscription_id: 'sub-1',
      ssoConfigId: 'cfg-godaddy-shopper',
    });
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'App not found' });
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls.find(
      ([event]: [string]) => event === 'sso-required.toggle-rejected.not-owner',
    );
    expect(warnCall).toBeDefined();
  });

  it('returns 409 when the app has no bound SSO config', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      subscription_id: 'sub-1',
      // ssoConfigId absent
    });
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(409);
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
  });

  it('returns 409 when the app has no subscription_id', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-godaddy-shopper',
      // subscription_id absent
    });
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(409);
    expect(mockSetAppSsoRequired).not.toHaveBeenCalled();
  });

  it('maps airo-go 409 OVERRIDE_LOCKED to BFF 409 sso_toggle_locked', async () => {
    mockSetAppSsoRequired.mockRejectedValue(
      new AiroHttpError(409, 'Conflict', { error: 'OVERRIDE_LOCKED' }),
    );
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'sso_toggle_locked' });
  });

  it('maps airo-go 404 to BFF 404 App not found', async () => {
    mockSetAppSsoRequired.mockRejectedValue(
      new AiroHttpError(404, 'Not Found', 'app not found'),
    );
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(404);
  });

  it('returns 502 on unexpected upstream failures', async () => {
    mockSetAppSsoRequired.mockRejectedValue(new Error('connection refused'));
    const res = await PUT(makeReq(JSON.stringify({ ssoRequired: true })), { params });
    expect(res.status).toBe(502);
  });
});
