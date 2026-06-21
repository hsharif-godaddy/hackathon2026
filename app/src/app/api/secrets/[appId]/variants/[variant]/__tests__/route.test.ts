/**
 * Tests for /api/secrets/[appId]/variants/[variant] — focused on the
 * aab-multi-user FGA manage-secrets gate on both GET (read) and POST (write).
 * Both are level-3, sensitive secret operations, so the gate firing (and
 * short-circuiting before getSecrets/updateSecrets) must be asserted.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSite,
  mockGetSecrets,
  mockUpdateSecrets,
  mockEnforce,
  mockResolveMultiUserFlag,
} = vi.hoisted(() => ({
  mockGetSite: vi.fn(),
  mockGetSecrets: vi.fn(),
  mockUpdateSecrets: vi.fn(),
  mockEnforce: vi.fn(),
  mockResolveMultiUserFlag: vi.fn(),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(() => ({
    getSite: mockGetSite,
    getSecrets: mockGetSecrets,
    updateSecrets: mockUpdateSecrets,
  })),
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
vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (request: NextRequest, ...args: any[]) =>
    handler(request, { isAuthenticated: true, jwt: 'test-jwt', user: { customerId: 'cust-1' } }, ...args),
  customerHasAccount: () => true,
  createCustomerAuthError: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

import { GET, POST } from '../route';

const APP_ID = 'app-secrets-variant-1';
const denyResponse = () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
const params = { params: Promise.resolve({ appId: APP_ID, variant: 'preview' }) };

describe('/api/secrets/[appId]/variants/[variant] — FGA manage-secrets gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMultiUserFlag.mockResolvedValue(true);
    mockGetSite.mockResolvedValue({ id: APP_ID, team_venture_id: 'v1', owner_customer_id: 'owner-9' });
    mockGetSecrets.mockResolvedValue({ appId: APP_ID, secrets: [], count: 0 });
    mockUpdateSecrets.mockResolvedValue({ success: true });
  });

  describe('GET (read secrets)', () => {
    function getReq(): NextRequest {
      return new NextRequest(`https://airo.test/api/secrets/${APP_ID}/variants/preview`);
    }

    it('returns the deny response and does NOT read secrets when the FGA gate denies', async () => {
      mockEnforce.mockResolvedValue(denyResponse());

      const res = await GET(getReq(), params as any);

      expect(res.status).toBe(403);
      expect(mockEnforce).toHaveBeenCalledTimes(1);
      expect(mockGetSecrets).not.toHaveBeenCalled();
    });

    it('proceeds to read secrets when the FGA gate allows (null)', async () => {
      mockEnforce.mockResolvedValue(null);

      const res = await GET(getReq(), params as any);

      expect(res.status).toBe(200);
      expect(mockEnforce).toHaveBeenCalledTimes(1);
      expect(mockGetSecrets).toHaveBeenCalledWith(APP_ID, 'preview', 'test-jwt');
    });
  });

  describe('POST (bulk secret operations)', () => {
    function postReq(): NextRequest {
      return new NextRequest(`https://airo.test/api/secrets/${APP_ID}/variants/preview`, {
        method: 'POST',
        body: JSON.stringify({ operations: { additions: [{ name: 'A', value: '1' }] } }),
      });
    }

    it('returns the deny response and does NOT write secrets when the FGA gate denies', async () => {
      mockEnforce.mockResolvedValue(denyResponse());

      const res = await POST(postReq(), params as any);

      expect(res.status).toBe(403);
      expect(mockEnforce).toHaveBeenCalledTimes(1);
      expect(mockUpdateSecrets).not.toHaveBeenCalled();
    });

    it('proceeds to write secrets when the FGA gate allows (null)', async () => {
      mockEnforce.mockResolvedValue(null);

      const res = await POST(postReq(), params as any);

      expect(res.status).toBe(200);
      expect(mockEnforce).toHaveBeenCalledTimes(1);
      expect(mockUpdateSecrets).toHaveBeenCalledWith(
        APP_ID,
        'preview',
        { additions: [{ name: 'A', value: '1' }] },
        'test-jwt'
      );
    });
  });
});
