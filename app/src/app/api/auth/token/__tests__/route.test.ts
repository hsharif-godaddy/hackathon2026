/**
 * /api/auth/token route tests
 *
 * Covers the cert2s extension: hosting (mhp-core) calls this endpoint with
 * `Authorization: sso-jwt <cert2s>` to obtain an airo-app JWT for the
 * pre-archive screenshot capture flow. The route must:
 *   - accept the cert2s SSO JWT (already validated upstream by withCustomerAuth
 *     via gd-auth) and confirm the cert2s shopperId owns the requested siteId,
 *   - mint an airo-app JWT with `authType: 'cert2s'` and a 15-minute TTL,
 *   - reject sso-jwt callers whose authType is not cert2s (no plain cert-realm,
 *     no s2s from arbitrary shoppers).
 *
 * The cookie/customer path remains unchanged: standard withCustomerAuth flow,
 * default 12h TTL on the minted airo-app JWT.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJWTService, mockAuthenticateCustomer, mockControlPlaneAdapter } = vi.hoisted(() => ({
  mockJWTService: {
    createToken: vi.fn(),
  },
  mockControlPlaneAdapter: {
    getSite: vi.fn(),
  },
  mockAuthenticateCustomer: vi.fn(),
}));

vi.mock('@/lib/jwt-service', () => ({
  getJWTService: vi.fn().mockReturnValue(mockJWTService),
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
}));

vi.mock('@/lib/mgmt-airo', () => ({
  AIRO_OWNER_PRODUCTS: { AIRO_APP_BUILDER: 'AiroAppBuilder', PAAS_NODEJS: 'PaaSNodeJS' },
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler) => {
      return async (request: NextRequest, ...args: any[]) => {
        const authContext = await mockAuthenticateCustomer(request);
        if (!authContext.isAuthenticated) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return handler(request, authContext, ...args);
      };
    }),
    customerHasAccount: vi.fn((user) => !!user.accountId),
    createCustomerAuthError: vi.fn((message, status) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  };
});

import { GET } from '../route';

const SITE_ID = 'site-abc123';
const SHOPPER_ID = 'shopper-456';
const MINTED_TOKEN = 'minted-airoapp-jwt';
const TOKEN_EXPIRES = new Date(Date.now() + 12 * 60 * 60 * 1000);

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://airo-builder.test-godaddy.com/api/auth/token?siteId=${SITE_ID}`, {
    method: 'GET',
    headers,
  });
}

describe('GET /api/auth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockControlPlaneAdapter.getSite.mockResolvedValue({ id: SITE_ID });
    mockJWTService.createToken.mockResolvedValue({ token: MINTED_TOKEN, expires: TOKEN_EXPIRES });
  });

  describe('cookie / customer auth (existing behavior)', () => {
    it('mints with the customer authType and the default TTL (no override)', async () => {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          shopperId: SHOPPER_ID,
          customerId: 'cust-456',
          accountId: 'acct-456',
          authType: 'basic',
          isE2S: false,
        },
        jwt: 'customer-jwt',
      });

      // Cookie auth — no Authorization header.
      const res = await GET(makeRequest());

      expect(res.status).toBe(200);
      // Cert2s-only TTL override should NOT be applied here.
      expect(mockJWTService.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ siteId: SITE_ID, authType: 'basic' }),
        undefined,
      );
    });
  });

  describe('cert2s service-caller delegation', () => {
    it('mints with authType=cert2s and a 15-minute TTL when sso-jwt + cert2s claim', async () => {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          shopperId: SHOPPER_ID,
          customerId: SHOPPER_ID,
          accountId: SHOPPER_ID,
          authType: 'cert2s',
          isE2S: false,
        },
        jwt: 'cert2s-jwt',
      });

      const res = await GET(makeRequest({ Authorization: 'sso-jwt cert2s-token' }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBe(MINTED_TOKEN);
      expect(mockJWTService.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ authType: 'cert2s' }),
        15 * 60, // TTL override in seconds
      );
    });

    it('still confirms ownership via the control-plane adapter for cert2s', async () => {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          shopperId: SHOPPER_ID,
          customerId: SHOPPER_ID,
          accountId: SHOPPER_ID,
          authType: 'cert2s',
          isE2S: false,
        },
        jwt: 'cert2s-jwt',
      });

      // Site lookup returns null → 404. Same path as the customer flow uses.
      mockControlPlaneAdapter.getSite.mockResolvedValue(null);

      const res = await GET(makeRequest({ Authorization: 'sso-jwt cert2s-token' }));

      expect(res.status).toBe(404);
      expect(mockJWTService.createToken).not.toHaveBeenCalled();
    });
  });

  describe('cert2s gate is symmetric (both directions)', () => {
    it.each(['basic', 'e2s', 's2s'])(
      '403s sso-jwt callers whose authType is %s',
      async (authType) => {
        mockAuthenticateCustomer.mockResolvedValue({
          isAuthenticated: true,
          user: {
            shopperId: SHOPPER_ID,
            customerId: SHOPPER_ID,
            accountId: SHOPPER_ID,
            authType,
            isE2S: authType === 'e2s',
          },
          jwt: `${authType}-jwt`,
        });

        const res = await GET(makeRequest({ Authorization: 'sso-jwt some-token' }));

        expect(res.status).toBe(403);
        expect(mockJWTService.createToken).not.toHaveBeenCalled();
      },
    );

    it('403s a cookie caller whose validated authType is cert2s', async () => {
      // gd-auth shouldn't produce this combination, but gate both directions
      // so the cert2s path can't fire from anything but an sso-jwt header.
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          shopperId: SHOPPER_ID,
          customerId: SHOPPER_ID,
          accountId: SHOPPER_ID,
          authType: 'cert2s',
          isE2S: false,
        },
        jwt: 'cookie-jwt',
      });

      const res = await GET(makeRequest()); // no Authorization header

      expect(res.status).toBe(403);
      expect(mockJWTService.createToken).not.toHaveBeenCalled();
    });

    it('accepts the same authType=basic when it arrives via cookie (not sso-jwt)', async () => {
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: {
          shopperId: SHOPPER_ID,
          customerId: 'cust',
          accountId: 'acct',
          authType: 'basic',
          isE2S: false,
        },
        jwt: 'cookie-jwt',
      });

      const res = await GET(makeRequest());

      expect(res.status).toBe(200);
      expect(mockJWTService.createToken).toHaveBeenCalled();
    });
  });
});
