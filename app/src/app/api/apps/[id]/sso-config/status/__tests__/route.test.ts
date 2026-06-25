/**
 * GET /api/apps/[id]/sso-config/status route tests.
 *
 * Reads presence via airo-go's customer-proxy `getSecrets` and checks for
 * BOTH credential pointer rows in the `auth` group. Pin contract: 200 +
 * the presence boolean on success, 200 + {configured:false} on any
 * upstream failure (fail-safe so the publish guard stays blocked).
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSecrets, mockGetSite, mockLogger } = vi.hoisted(() => ({
  mockGetSecrets: vi.fn(),
  mockGetSite: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: () => ({ getSite: mockGetSite }),
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

vi.mock('@/lib/mgmt-airo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mgmt-airo')>('@/lib/mgmt-airo');
  class FakeAiroMgmtClient {
    getSecrets = mockGetSecrets;
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

import { GET } from '../route';

const APP_ID = 'app-abc123';
const params = Promise.resolve({ id: APP_ID });

function makeReq(): NextRequest {
  return new NextRequest(`https://airo.test/api/apps/${APP_ID}/sso-config/status`, { method: 'GET' });
}

function authResponse(names: string[]): { auth: { secrets: { name: string; systemManaged: boolean }[] } } {
  return {
    auth: {
      secrets: names.map((name) => ({ name, systemManaged: false })),
    },
  };
}

describe('GET /api/apps/[id]/sso-config/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-godaddy-shopper',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      clientIdSecretName: 'GD_SSO_OAUTH_CLIENT_ID',
      clientSecretSecretName: 'GD_SSO_OAUTH_CLIENT_SECRET',
    });
  });

  it('returns 200 + {configured:true} when BOTH pointer rows are present in the auth group', async () => {
    mockGetSecrets.mockResolvedValue(authResponse(['GD_SSO_OAUTH_CLIENT_ID', 'GD_SSO_OAUTH_CLIENT_SECRET']));

    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true });

    expect(mockGetSecrets).toHaveBeenCalledWith('sub-1', 'sys-1', APP_ID);
  });

  it('returns 200 + {configured:false} when only one pointer is present (half-saved state)', async () => {
    mockGetSecrets.mockResolvedValue(authResponse(['GD_SSO_OAUTH_CLIENT_ID']));
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it('returns 200 + {configured:false} when the auth group is empty', async () => {
    mockGetSecrets.mockResolvedValue({ auth: { secrets: [] } });
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it('returns 200 + {configured:false} when the auth group is absent from the response', async () => {
    mockGetSecrets.mockResolvedValue({});
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it('matches pointer names case-insensitively', async () => {
    mockGetSecrets.mockResolvedValue(authResponse(['gd_sso_oauth_client_id', 'gd_sso_oauth_client_secret']));
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true });
  });

  it('uses per-config pointer names when surfaced on SiteInfo', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      ssoConfigId: 'cfg-custom-idp',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
      clientIdSecretName: 'CUSTOM_IDP_CLIENT_ID',
      clientSecretSecretName: 'CUSTOM_IDP_CLIENT_SECRET',
    });
    mockGetSecrets.mockResolvedValue(authResponse(['CUSTOM_IDP_CLIENT_ID', 'CUSTOM_IDP_CLIENT_SECRET']));

    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true });
  });

  it('short-circuits to {configured:false} when the app has no bound SSO config (no upstream call)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-1',
      // ssoConfigId / subscription_id / system_id intentionally absent
    });
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
    expect(mockGetSecrets).not.toHaveBeenCalled();
  });

  it('fail-safes to {configured:false} when the upstream call throws', async () => {
    mockGetSecrets.mockRejectedValue(new Error('upstream timeout'));

    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });

    const warnCall = mockLogger.warn.mock.calls.find(
      ([event]: [string]) => event === 'sso-config.status.fetch-failed',
    );
    expect(warnCall).toBeDefined();
  });

  it('returns 404 when the caller does not own the app (IDOR guard)', async () => {
    mockGetSite.mockResolvedValue(null);

    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'App not found' });
    expect(mockGetSecrets).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller is a collaborator (sharedWithMe)', async () => {
    mockGetSite.mockResolvedValue({
      id: APP_ID,
      owner_customer_id: 'cust-owner-not-caller',
      sharedWithMe: true,
      ssoConfigId: 'cfg-godaddy-shopper',
      subscription_id: 'sub-1',
      system_id: 'sys-1',
    });

    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'App not found' });
    expect(mockGetSecrets).not.toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls.find(
      ([event]: [string]) => event === 'sso-config.status.rejected.not-owner',
    );
    expect(warnCall).toBeDefined();
  });
});
