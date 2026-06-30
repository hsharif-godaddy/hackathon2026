import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

const mockAuthenticate = vi.fn();
const mockExtractTokenFromRequest = vi.fn();
const mockMockLogin = vi.fn(function () {
  return false;
});

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: () => mockMockLogin(),
  },
}));

vi.mock('@/lib/gd-auth-service', () => ({
  gdAuthService: {
    authenticate: (token: string, level: 1 | 2 | 3) => mockAuthenticate(token, level),
    extractTokenFromRequest: (request: NextRequest) => mockExtractTokenFromRequest(request),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

function createRequest(cookies: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/validate', {
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
  });
}

describe('/api/auth/validate', function validateRouteTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockMockLogin.mockReturnValue(false);
    mockExtractTokenFromRequest.mockReturnValue('test-token');
  });

  describe('GET', function getTests() {
    it('should return payload and gasket-compatible details on success', async function successShape() {
      mockAuthenticate.mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'shopper-1',
          cid: 'customer-1',
          email: 'user@example.com',
          name: 'Test User',
          authType: 'basic',
        },
        reason: 'ok',
      });

      const response = await GET(createRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.valid).toBe(true);
      expect(body.payload).toEqual({
        shopperId: 'shopper-1',
        cid: 'customer-1',
        email: 'user@example.com',
        name: 'Test User',
        authType: 'basic',
      });
      expect(body.details).toEqual({
        cid: 'customer-1',
        customerId: 'customer-1',
        shopperId: 'shopper-1',
        email: 'user@example.com',
        accountName: 'Test User',
        type: 'basic',
      });
    });

    it('should enrich email and name from info_idp cookie when absent from JWT payload', async function cookieEnrichment() {
      mockAuthenticate.mockResolvedValue({
        valid: true,
        payload: {
          shopperId: 'shopper-1',
          cid: 'customer-1',
          authType: 'basic',
        },
        reason: 'ok',
      });

      const infoIdp = encodeURIComponent(JSON.stringify({
        auth: 'basic',
        basic: {
          email: 'cookie@example.com',
          firstname: 'Cookie',
          lastname: 'User',
        },
      }));

      const response = await GET(createRequest({ info_idp: infoIdp }));
      const body = await response.json();

      expect(body.payload.email).toBe('cookie@example.com');
      expect(body.payload.name).toBe('Cookie User');
      expect(body.details.email).toBe('cookie@example.com');
      expect(body.details.accountName).toBe('Cookie User');
    });

    it('should return 401 when no token is provided', async function noToken() {
      mockExtractTokenFromRequest.mockReturnValue(null);

      const response = await GET(createRequest());
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('No token provided');
    });
  });
});
