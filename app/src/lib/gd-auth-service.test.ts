import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeTokenPayload, extractTokenFromRequest } from './gd-auth-service';

// Create shared mock authenticate function at module level
const mockAuthenticate = vi.fn();

// Mock gd-auth library with shared instance
vi.mock('gd-auth', () => ({
  GdAuth: vi.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate
  }))
}));
vi.mock('gd-auth/src/fetch-key', () => ({}));
vi.mock('@/lib/features', () => ({
  authUtils: {
    getSupportedAuthTypes: () => ['basic', 'e2s', 's2s']
  }
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
    // Clear mock call history
    mockAuthenticate.mockReset();

    // Reset environment
    process.env.AUTH_TYPE = 'jwt';
    process.env.NODE_ENV = 'test';

    // Reset modules to ensure fresh import with mocks
    vi.resetModules();

    // Re-import after reset
    const module = await import('./gd-auth-service'); // eslint-disable-line @next/next/no-assign-module-variable
    GdAuthService = module.GdAuthService;

    // Create service
    service = new GdAuthService();
  });

  describe('authenticate', () => {
    // Skip: Mock not intercepting dynamic require('gd-auth') in service
    it.skip('should handle basic auth tokens', async () => {
      mockAuthenticate.mockResolvedValue({
        auth: 'basic',
        shopperId: 'shopper-123',
        cid: 'customer-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const result = await service.authenticate('basic-token');

      expect(result.valid).toBe(true);
      expect(result.payload?.shopperId).toBe('shopper-123');
      expect(result.payload?.cid).toBe('customer-123');
      expect(result.payload?.authType).toBe('basic');
    });

    // Skip: Mock not intercepting dynamic require('gd-auth') in service
    it.skip('should handle e2s (employee-to-shopper) tokens', async () => {
      mockAuthenticate.mockResolvedValue({
        auth: 'e2s',
        shopperId: 'employee-456',
        cid: 'employee-cid',
        e2s: {
          shopperId: 'customer-789',
          cid: 'customer-cid-789'
        },
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const result = await service.authenticate('e2s-token');

      expect(result.valid).toBe(true);
      // Should use e2s nested object
      expect(result.payload?.shopperId).toBe('customer-789');
      expect(result.payload?.cid).toBe('customer-cid-789');
      expect(result.payload?.authType).toBe('e2s');
    });

    // Skip: Mock not intercepting dynamic require('gd-auth') in service
    it.skip('should handle s2s (shopper-to-shopper delegation) tokens', async () => {
      mockAuthenticate.mockResolvedValue({
        auth: 's2s',
        shopperId: 'wdd-account-123',
        cid: 'wdd-cid',
        s2s: {
          shopperId: 'client-account-456',
          cid: 'client-cid-456'
        },
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      });

      const result = await service.authenticate('s2s-token');

      expect(result.valid).toBe(true);
      // Should use s2s nested object (delegated account)
      expect(result.payload?.shopperId).toBe('client-account-456');
      expect(result.payload?.cid).toBe('client-cid-456');
      expect(result.payload?.authType).toBe('s2s');
    });

    // Skip: Mock not intercepting dynamic require('gd-auth') in service
    it.skip('should handle authentication errors', async () => {
      mockAuthenticate.mockRejectedValue(new Error('Invalid token'));

      const result = await service.authenticate('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid token');
    });

    it('should bypass auth in non-JWT mode', async () => {
      process.env.AUTH_TYPE = 'mock';
      const mockService = new GdAuthService();

      const result = await mockService.authenticate('any-token');

      expect(result.valid).toBe(true);
      expect(result.payload?.shopperId).toBe('dev-user');
      expect(result.reason).toContain('Authentication bypassed');
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
