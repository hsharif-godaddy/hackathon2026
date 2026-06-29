import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockReconcile,
  mockEnforceVentureRelation,
  mockCheckSwitchboardFlag,
  mockCustomerHasAccount,
  mockCreateCustomerAuthError,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockReconcile: vi.fn(),
  mockEnforceVentureRelation: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
  mockCustomerHasAccount: vi.fn(),
  mockCreateCustomerAuthError: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({ getSite: mockGetSite })),
}));

vi.mock('@/lib/mgmt-airo/collaborator-sync', () => ({
  reconcileCollaboratorsFromFga: mockReconcile,
}));

vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforceVentureRelation,
}));

vi.mock('@/lib/authz-fga/relations', () => ({
  AUTHZ_FGA_RELATIONS: { canTransfer: 'owner' },
}));

const mockResolveOwnerPaidPlan = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));
vi.mock('@/lib/mgmt-airo/resolve-owner-paid-plan', () => ({
  resolveOwnerPaidPlan: mockResolveOwnerPaidPlan,
}));

// withCustomerAuth wrapper — injects a fixed authed context. The handler is the
// second arg; the real wrapper applies { level: 3 }, which is irrelevant here.
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { jwt: 'test-jwt', user: { customerId: 'owner-1' } }, ...args),
  customerHasAccount: mockCustomerHasAccount,
  createCustomerAuthError: mockCreateCustomerAuthError,
}));

import { POST } from '../route';

const SITE_ID = 'app-123';

function makeRequest(): NextRequest {
  return new NextRequest(`https://airo.test/api/sites/${SITE_ID}/collaborators/reconcile`, {
    method: 'POST',
  });
}

function routeParams(id: string = SITE_ID) {
  return { params: Promise.resolve({ id }) };
}

const baseSite = {
  id: SITE_ID,
  subscription_id: 'sub-1',
  team_venture_id: 'venture-1',
  owner_customer_id: 'owner-1',
};

describe('POST /api/sites/[id]/collaborators/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomerHasAccount.mockReturnValue(true);
    mockCheckSwitchboardFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue(baseSite);
    mockEnforceVentureRelation.mockResolvedValue(null); // null = allowed
    mockReconcile.mockResolvedValue({ members: 2, granted: 2, grantFailures: 0, revoked: 0, revokeFailures: 0 });
    mockCreateCustomerAuthError.mockImplementation((message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
    );
  });

  it('reconciles and returns the result on the happy path', async () => {
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, members: 2, granted: 2, grantFailures: 0 });
    expect(mockReconcile).toHaveBeenCalledWith({
      jwt: 'test-jwt',
      appId: SITE_ID,
      subscriptionId: 'sub-1',
      teamVentureId: 'venture-1',
      ownerCustomerId: 'owner-1',
    });
  });

  it('404s when the aab-multi-user flag is off (route is inert)', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(404);
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockGetSite).not.toHaveBeenCalled();
  });

  it('403s when the caller has no account', async () => {
    mockCustomerHasAccount.mockReturnValue(false);
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(403);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('404s when the site is not found', async () => {
    mockGetSite.mockResolvedValue(null);
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(404);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('returns success with skipped when the site has no team venture yet', async () => {
    mockGetSite.mockResolvedValue({ ...baseSite, team_venture_id: undefined });
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, skipped: 'no_team_venture', granted: 0, grantFailures: 0 });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('returns the venture-relation denial when the caller is not the owner', async () => {
    const denial = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    mockEnforceVentureRelation.mockResolvedValue(denial);
    const res = await POST(makeRequest(), routeParams());
    expect(res).toBe(denial);
    expect(mockReconcile).not.toHaveBeenCalled();
    // Owner-only relation is enforced before the reconcile runs.
    expect(mockEnforceVentureRelation).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID, customerId: 'owner-1', relation: 'owner' }),
    );
  });

  it('still returns 200 when reconcile reports partial grant failures', async () => {
    mockReconcile.mockResolvedValue({ members: 2, granted: 1, grantFailures: 1, revoked: 0, revokeFailures: 0 });
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, grantFailures: 1 });
    expect(mockLogger.warn).toHaveBeenCalledWith('sites.collaborators.reconcile.partial', expect.any(Object));
  });

  it('returns 403 when the owner is on a free tier (server-side paywall)', async () => {
    mockResolveOwnerPaidPlan.mockResolvedValue({ allowed: false, reason: 'free_tier' });
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('paid plan');
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('returns 503 when subscription fetch fails (infra error, not paywall)', async () => {
    mockResolveOwnerPaidPlan.mockResolvedValue({ allowed: false, reason: 'fetch_failed' });
    const res = await POST(makeRequest(), routeParams());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('verify subscription');
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
