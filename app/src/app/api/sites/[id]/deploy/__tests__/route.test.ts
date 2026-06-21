/**
 * Tests for POST /api/sites/[id]/deploy — focused on the aab-multi-user FGA
 * publish gate. Deploy is a level-3, externally-visible action, so the gate
 * firing (and short-circuiting before the deploy) must be asserted.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockDeploySite,
  mockEnforce,
  mockResolveMultiUserFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockDeploySite: vi.fn(),
  mockEnforce: vi.fn(),
  mockResolveMultiUserFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({ getSite: mockGetSite, deploySite: mockDeploySite })),
}));
vi.mock('@/lib/control-plane/error-handler', () => ({
  handleControlPlaneError: vi.fn(() => new Response('err', { status: 500 })),
}));
vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforce,
}));
vi.mock('@/lib/authz-fga/multi-user-flag', () => ({
  resolveMultiUserFlag: mockResolveMultiUserFlag,
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
  customerHasAccount: () => true,
  createCustomerAuthError: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

import { POST } from '../route';

const APP_ID = 'app-deploy-1';

function postReq(): NextRequest {
  return new NextRequest(`https://airo.test/api/sites/${APP_ID}/deploy`, { method: 'POST' });
}
const params = { params: Promise.resolve({ id: APP_ID }) };

describe('POST /api/sites/[id]/deploy — FGA publish gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMultiUserFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ id: APP_ID, team_venture_id: 'v1', owner_customer_id: 'owner-9' });
    mockDeploySite.mockResolvedValue({ success: true });
  });

  it('returns the deny response and does NOT deploy when the FGA publish gate denies', async () => {
    mockEnforce.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(403);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockDeploySite).not.toHaveBeenCalled();
  });

  it('proceeds to deploy when the FGA publish gate allows (null)', async () => {
    mockEnforce.mockResolvedValue(null);

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockDeploySite).toHaveBeenCalledWith(APP_ID, 'test-jwt', expect.any(Object));
  });
});
