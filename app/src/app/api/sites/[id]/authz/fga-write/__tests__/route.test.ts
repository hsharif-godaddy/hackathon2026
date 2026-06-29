import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockWriteFgaTuples,
  mockEnforce,
  mockCheckSwitchboardFlag,
  mockGetAuthzFgaConfig,
} = vi.hoisted(function hoisted() {
  return {
    mockGetSite: vi.fn(),
    mockWriteFgaTuples: vi.fn(),
    mockEnforce: vi.fn(),
    mockCheckSwitchboardFlag: vi.fn(),
    mockGetAuthzFgaConfig: vi.fn(),
  };
});

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
  checkSwitchboardValue: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: function withAuth(handler: any) {
    return async function wrapped(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
      const authContext = {
        jwt: 'test-jwt-token',
        user: { customerId: 'cust-1', shopperId: 'shop-1', accountId: 'acct-1' },
      };
      return handler(request, authContext, routeContext);
    };
  },
  customerHasAccount: vi.fn(function () { return true; }),
  createCustomerAuthError: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));

vi.mock('@/lib/authz-fga/config', () => ({
  getAuthzFgaConfig: mockGetAuthzFgaConfig,
}));

vi.mock('@/lib/authz-fga/oauth-token', () => ({
  getAuthzFgaAccessToken: vi.fn().mockResolvedValue('access-token'),
}));

vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforce,
}));

vi.mock('@/lib/authz-fga/write', () => ({
  writeFgaTuples: mockWriteFgaTuples,
}));

// The route mirrors grants into mgmt-airo after the FGA write; stub it to a
// clean success so these tuple-constraint tests don't reach the real IAM/mgmt
// path. (The sync's own behavior is covered in collaborator-sync.test.ts.)
vi.mock('@/lib/mgmt-airo/collaborator-sync', () => ({
  syncCollaboratorsToMgmtAiro: vi.fn().mockResolvedValue({ grantFailures: 0, granted: 0 }),
}));

const mockResolveOwnerPaidPlan = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));
vi.mock('@/lib/mgmt-airo/resolve-owner-paid-plan', () => ({
  resolveOwnerPaidPlan: mockResolveOwnerPaidPlan,
}));

// Keep the real relations module so the allowlist under test is the real one.

import { POST } from '@/app/api/sites/[id]/authz/fga-write/route';

const VENTURE_ID = 'venture-abc';

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown) {
  return new NextRequest('https://local.test/api/sites/site-1/authz/fga-write', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/sites/[id]/authz/fga-write tuple constraint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSwitchboardFlag.mockResolvedValue(true); // aab-multi-user ON
    mockGetSite.mockResolvedValue({ id: 'site-1', team_venture_id: VENTURE_ID });
    mockGetAuthzFgaConfig.mockReturnValue({ baseUrl: 'https://fga', storeId: 's', oauthTokenUrl: 'o', clientId: 'c', clientSecret: 'x' });
    mockEnforce.mockResolvedValue(null); // caller authorized
    mockWriteFgaTuples.mockResolvedValue(undefined);
  });

  it('returns 404 and never touches FGA when the flag is off', async () => {
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    const res = await POST(
      makeRequest({ writes: [{ user: 'customer:cust-2', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` }] }),
      routeParams('site-1')
    );
    expect(res.status).toBe(404);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('accepts member-permission tuples targeting this venture', async () => {
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` }],
        deletes: [{ user: 'customer:cust-3', relation: 'airo_app_build', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(200);
    expect(mockWriteFgaTuples).toHaveBeenCalledTimes(1);
  });

  it('rejects a batch that exceeds the tuple cap before doing any FGA work', async () => {
    const writes = Array.from({ length: 101 }, (_unused, i) => ({
      user: `customer:cust-${i}`,
      relation: 'airo_app_view',
      object: `venture:${VENTURE_ID}`,
    }));
    const res = await POST(makeRequest({ writes }), routeParams('site-1'));
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('rejects a tuple targeting a different venture', async () => {
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'airo_app_view', object: 'venture:someone-else' }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('rejects a tuple with a relation outside the AAB allowlist', async () => {
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'can_do_anything', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('rejects the whole batch if any one tuple is out of policy', async () => {
    const res = await POST(
      makeRequest({
        writes: [
          { user: 'customer:cust-2', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` },
          { user: 'customer:cust-3', relation: 'airo_app_build', object: 'venture:other' },
        ],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('rejects a non-customer subject (e.g. a userset)', async () => {
    const res = await POST(
      makeRequest({
        writes: [{ user: 'venture:other#member', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('never allows writing the owner relation, even for an owner caller', async () => {
    // enforce resolves null (caller IS owner) for every relation here.
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:self', relation: 'owner', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(400);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('lets an owner assign admin', async () => {
    mockEnforce.mockResolvedValue(null); // owner check passes
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'admin', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(200);
    expect(mockWriteFgaTuples).toHaveBeenCalledTimes(1);
  });

  it('blocks a non-owner admin from assigning admin (escalation)', async () => {
    // Caller holds user_invite (canManageMembers passes) but NOT owner: the
    // owner check (relation 'owner') is denied with a 403.
    mockEnforce.mockImplementation(async (opts: { relation: string }) =>
      opts.relation === 'owner'
        ? new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        : null
    );
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:self', relation: 'admin', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(403);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('blocks a non-owner admin from granting user_update', async () => {
    mockEnforce.mockImplementation(async (opts: { relation: string }) =>
      opts.relation === 'owner'
        ? new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
        : null
    );
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:accomplice', relation: 'user_update', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(403);
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('returns 403 when the owner is on a free tier (server-side paywall)', async () => {
    mockResolveOwnerPaidPlan.mockResolvedValue({ allowed: false, reason: 'free_tier' });
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('paid plan');
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });

  it('returns 503 when subscription fetch fails (infra error, not paywall)', async () => {
    mockResolveOwnerPaidPlan.mockResolvedValue({ allowed: false, reason: 'fetch_failed' });
    const res = await POST(
      makeRequest({
        writes: [{ user: 'customer:cust-2', relation: 'airo_app_view', object: `venture:${VENTURE_ID}` }],
      }),
      routeParams('site-1')
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('verify subscription');
    expect(mockWriteFgaTuples).not.toHaveBeenCalled();
  });
});
