/**
 * Tests for POST /api/secrets/[appId]/sync — focused on the aab-multi-user FGA
 * manage-secrets gate. Sync mutates publish-variant secrets (level-3), so the
 * gate firing (and short-circuiting before syncSecrets) must be asserted.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockSyncSecrets,
  mockEnforce,
  mockResolveMultiUserFlag,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockSyncSecrets: vi.fn(),
  mockEnforce: vi.fn(),
  mockResolveMultiUserFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({ getSite: mockGetSite, syncSecrets: mockSyncSecrets })),
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

const APP_ID = 'app-secrets-sync-1';

function postReq(): NextRequest {
  return new NextRequest(`https://airo.test/api/secrets/${APP_ID}/sync`, {
    method: 'POST',
    body: JSON.stringify({ source: 'preview', destination: 'publish' }),
  });
}
const params = { params: Promise.resolve({ appId: APP_ID }) };

describe('POST /api/secrets/[appId]/sync — FGA manage-secrets gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMultiUserFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ id: APP_ID, team_venture_id: 'v1', owner_customer_id: 'owner-9' });
    mockSyncSecrets.mockResolvedValue({
      success: true,
      message: 'Secrets synced successfully',
      operations: { added: 0, updated: 0, deleted: 0 },
    });
  });

  it('returns the deny response and does NOT sync when the FGA gate denies', async () => {
    mockEnforce.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    );

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(403);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockSyncSecrets).not.toHaveBeenCalled();
  });

  it('proceeds to sync secrets when the FGA gate allows (null)', async () => {
    mockEnforce.mockResolvedValue(null);

    const res = await POST(postReq(), params as any);

    expect(res.status).toBe(200);
    expect(mockEnforce).toHaveBeenCalledTimes(1);
    expect(mockSyncSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'publish', 'test-jwt');
  });
});
