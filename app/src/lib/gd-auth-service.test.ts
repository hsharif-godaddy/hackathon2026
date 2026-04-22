import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeTokenPayload, extractTokenFromRequest } from './auth-utils';

// Create shared mock functions at module level
const mockParseToken = vi.fn();
const mockGetShopperId = vi.fn();
const mockGetCustomerId = vi.fn();
const mockGetPayload = vi.fn();
const mockSetAppConfig = vi.fn();

// Mock @godaddy/gd-auth-lib (NAPI module, loaded via require() in constructor)
vi.mock('@godaddy/gd-auth-lib', () => ({
  GdAuth: vi.fn().mockImplementation(() => ({
    parseToken: mockParseToken,
    getShopperId: mockGetShopperId,
    getCustomerId: mockGetCustomerId,
    getPayload: mockGetPayload,
    setAppConfig: mockSetAppConfig
  })),
  SecurityLevel: { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 },
  // Values from @godaddy/gd-auth-lib/src/types.ts GdAuthErrorCode enum
  GdAuthErrorCode: {
    TOKEN_EXPIRED: -1018,
    INVALID_TOKEN_SIGNATURE: -1007,
    INVALID_TOKEN: -1013,
    INVALID_AUTH_TYPE: -1004,
    TOKEN_TYPE_NOT_ALLOWED: -1010,
    TOKEN_AUTH_RESTRICTED: -1011,
    TIMEOUT_ERROR: -1020,
    REQUEST_ERROR: -1014,
  }
}));
vi.mock('@/lib/features', () => ({
  authUtils: {
    getSupportedAuthTypes: () => ['basic', 'e2s', 's2s']
  },
  SsoExpirationCode: { NOT_EXPIRED: 0, LOGIN: 1, HBI: 2, VAT: 3 }
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}));

function encodeJwtPayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function createMockJwt(payload: object): string {
  const header = encodeJwtPayload({ alg: 'HS256', typ: 'JWT' });
  const body = encodeJwtPayload(payload);
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}

describe('decodeTokenPayload', () => {
  it('should extract cid from valid JWT', () => {
    const token = createMockJwt({ cid: 'customer-123', shopperId: 'shopper-456' });

    const result = decodeTokenPayload(token);

    expect(result).not.toBeNull();
    expect(result?.cid).toBe('customer-123');
    expect(result?.shopperId).toBe('shopper-456');
  });

  it('should fall back to customerId when cid is not present', () => {
    const token = createMockJwt({ customerId: 'fallback-customer-789' });

    const result = decodeTokenPayload(token);

    expect(result).not.toBeNull();
    expect(result?.cid).toBe('fallback-customer-789');
  });

  it('should fall back to sub when shopperId is not present', () => {
    const token = createMockJwt({ sub: 'subject-user-123' });

    const result = decodeTokenPayload(token);

    expect(result).not.toBeNull();
    expect(result?.shopperId).toBe('subject-user-123');
  });

  it('should return null for invalid JWT format (missing parts)', () => {
    expect(decodeTokenPayload('not-a-jwt')).toBeNull();
    expect(decodeTokenPayload('only.two')).toBeNull();
    expect(decodeTokenPayload('')).toBeNull();
  });

  it('should return null for malformed base64 payload', () => {
    const token = 'header.!!!invalid-base64!!!.signature';

    const result = decodeTokenPayload(token);

    expect(result).toBeNull();
  });

  it('should return null for non-JSON payload', () => {
    const header = encodeJwtPayload({ alg: 'HS256' });
    const notJson = Buffer.from('this is not json').toString('base64url');
    const token = `${header}.${notJson}.signature`;

    const result = decodeTokenPayload(token);

    expect(result).toBeNull();
  });

  it('should return empty object when payload has no cid/customerId/shopperId/sub', () => {
    const token = createMockJwt({ exp: 12345, iat: 12345 });

    const result = decodeTokenPayload(token);

    expect(result).not.toBeNull();
    expect(result?.cid).toBeUndefined();
    expect(result?.shopperId).toBeUndefined();
  });
});

describe('extractTokenFromRequest (standalone function)', () => {
  it('should extract token from Bearer authorization header', () => {
    const request = {
      headers: {
        get: vi.fn((name: string) => {
          if (name === 'authorization') return 'Bearer standalone-token-123';
          return null;
        })
      },
      cookies: { get: vi.fn() }
    };

    const token = extractTokenFromRequest(request);

    expect(token).toBe('standalone-token-123');
  });

  it('should extract token from sso-jwt authorization header', () => {
    const request = {
      headers: {
        get: vi.fn((name: string) => {
          if (name === 'authorization') return 'sso-jwt standalone-token-456';
          return null;
        })
      },
      cookies: { get: vi.fn() }
    };

    const token = extractTokenFromRequest(request);

    expect(token).toBe('standalone-token-456');
  });

  it('should extract token from auth_idp cookie', () => {
    const request = {
      headers: { get: vi.fn(() => null) },
      cookies: {
        get: vi.fn((name: string) => {
          if (name === 'auth_idp') return { value: 'cookie-token-standalone' };
          return null;
        })
      }
    };

    const token = extractTokenFromRequest(request);

    expect(token).toBe('cookie-token-standalone');
  });

  it('should return null when no token is present', () => {
    const request = {
      headers: { get: vi.fn(() => null) },
      cookies: { get: vi.fn(() => null) }
    };

    const token = extractTokenFromRequest(request);

    expect(token).toBeNull();
  });

  it('should handle missing cookies object gracefully', () => {
    const request = {
      headers: { get: vi.fn(() => null) },
      cookies: undefined
    };

    const token = extractTokenFromRequest(request);

    expect(token).toBeNull();
  });
});

describe('GdAuthService', () => {
  let service: any;
  let GdAuthService: any;

  beforeEach(async () => {
    mockParseToken.mockReset();
    mockGetShopperId.mockReset();
    mockGetCustomerId.mockReset();
    mockGetPayload.mockReset();
    mockSetAppConfig.mockReset();

    process.env.AUTH_TYPE = 'jwt';
    process.env.NODE_ENV = 'test';

    vi.resetModules();

    const module = await import('./gd-auth-service'); // eslint-disable-line @next/next/no-assign-module-variable
    GdAuthService = module.GdAuthService;

    service = new GdAuthService();
  });

  describe('authenticate', () => {
    it('should bypass auth in non-JWT mode', async () => {
      process.env.AUTH_TYPE = 'mock';
      const mockService = new GdAuthService();

      const result = await mockService.authenticate('any-token');

      expect(result.valid).toBe(true);
      expect(result.payload?.shopperId).toBe('dev-user');
      expect(result.reason).toContain('Authentication bypassed');
    });

    it('should return valid result with extracted identity on success', async () => {
      mockParseToken.mockReturnValue({ token_type: 'go_daddy_s_s_o', payload: {} });
      mockGetShopperId.mockReturnValue('shopper-123');
      mockGetCustomerId.mockReturnValue('customer-456');
      mockGetPayload.mockReturnValue({ auth: 'basic', exp: 9999999999, iat: 1000000000 });

      const result = await service.authenticate('valid-token');

      expect(result.valid).toBe(true);
      expect(result.payload.shopperId).toBe('shopper-123');
      expect(result.payload.cid).toBe('customer-456');
      expect(result.payload.authType).toBe('basic');
    });

    it('should return authReason LOGIN (1) for TOKEN_EXPIRED at level 1', async () => {
      // GdAuthErrorCode.TOKEN_EXPIRED = -1018 (from @godaddy/gd-auth-lib types.ts)
      const error = new Error('Token expired');
      (error as any).code = -1018;
      mockParseToken.mockImplementation(() => { throw error; });

      const result = await service.authenticate('expired-token', 1);

      expect(result.valid).toBe(false);
      expect(result.authReason).toBe(1);
    });

    it('should return authReason HBI (2) for TOKEN_EXPIRED at level 3', async () => {
      const error = new Error('Token expired');
      (error as any).code = -1018;
      mockParseToken.mockImplementation(() => { throw error; });

      const result = await service.authenticate('expired-token', 3);

      expect(result.valid).toBe(false);
      expect(result.authReason).toBe(2);
    });

    it('should return authReason LOGIN (1) for non-expiration auth errors', async () => {
      // GdAuthErrorCode.INVALID_TOKEN_SIGNATURE = -1007
      const error = new Error('Invalid signature');
      (error as any).code = -1007;
      mockParseToken.mockImplementation(() => { throw error; });

      const result = await service.authenticate('bad-token', 3);

      expect(result.valid).toBe(false);
      expect(result.authReason).toBe(1);
    });

    it('should omit authReason for transient errors (network, timeout)', async () => {
      // GdAuthErrorCode.TIMEOUT_ERROR = -1020 (not in AUTH_ERROR_CODES)
      const error = new Error('Request timeout');
      (error as any).code = -1020;
      mockParseToken.mockImplementation(() => { throw error; });

      const result = await service.authenticate('any-token', 1);

      expect(result.valid).toBe(false);
      expect(result.authReason).toBeUndefined();
    });
  });

  describe('extractTokenFromRequest', () => {
    it('should extract token from Bearer authorization header', () => {
      const request = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return 'Bearer test-token-123';
            return null;
          })
        },
        cookies: {
          get: vi.fn()
        }
      };

      const token = service.extractTokenFromRequest(request);

      expect(token).toBe('test-token-123');
    });

    it('should extract token from sso-jwt authorization header', () => {
      const request = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return 'sso-jwt test-token-456';
            return null;
          })
        },
        cookies: {
          get: vi.fn()
        }
      };

      const token = service.extractTokenFromRequest(request);

      expect(token).toBe('test-token-456');
    });

    it('should extract token from cookie if no header', () => {
      const request = {
        headers: {
          get: vi.fn(() => null)
        },
        cookies: {
          get: vi.fn((name: string) => {
            if (name === 'auth_idp') return { value: 'cookie-token-789' };
            return null;
          })
        }
      };

      const token = service.extractTokenFromRequest(request);

      expect(token).toBe('cookie-token-789');
    });

    it('should return null if no token found', () => {
      const request = {
        headers: {
          get: vi.fn(() => null)
        },
        cookies: {
          get: vi.fn(() => null)
        }
      };

      const token = service.extractTokenFromRequest(request);

      expect(token).toBeNull();
    });
  });
});
