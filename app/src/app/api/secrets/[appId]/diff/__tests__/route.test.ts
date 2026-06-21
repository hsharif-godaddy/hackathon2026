/**
 * Tests for GET /api/secrets/[appId]/diff — focused on the aab-multi-user FGA
 * manage-secrets gate. Secrets read is a level-3, sensitive action, so the gate
 * firing (and short-circuiting before compareSecrets) must be asserted.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockCompareSecrets,
  mockEnforce,
  mockResolveMultiUserFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockCompareSecrets: vi.fn(),
  mockEnforce: vi.fn(),
  mockResolveMultiUserFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({ getSite: mockGetSite, compareSecrets: mockCompareSecrets })),
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

import { GET } from '../route';

const APP_ID = 'app-secrets-diff-1';

function getReq(): NextRequest {
  return new NextRequest(`https://airo.test/api/secrets/${APP_ID}/diff?source=preview&destination=publish`);
}
const params = { params: Promise.resolve({ appId: APP_ID }) };

describe('GET /api/secrets/[appId]/diff — FGA manage-secrets gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMultiUserFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ id: APP_ID, team_venture_id: 'v1', owner_customer_id: 'owner-9' });
    mockCompareSecrets.mockResolvedValue({ added: [], updated: [], deleted: [] });
  });

  it('returns the deny response and does NOT read secrets when the FGA gate denies', async () => {
    mockEnforce.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    const res = await GET(getReq(), params as any);

    expect(res.status).toBe(403);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockCompareSecrets).not.toHaveBeenCalled();
  });

  it('proceeds to compare secrets when the FGA gate allows (null)', async () => {
    mockEnforce.mockResolvedValue(null);

    const res = await GET(getReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockCompareSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt', true);
  });
});
