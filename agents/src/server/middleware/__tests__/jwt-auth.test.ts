import { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateTokenMock = vi.fn();

vi.mock('../../../lib/jwt-validator.js', () => ({
  getJWTValidator: () => ({
    validateToken: validateTokenMock,
  }),
}));

vi.mock('../../../lib/jwks-config.js', () => ({
  validateJWTAgentConfig: () => ({ valid: true, errors: [] }),
}));

vi.mock('../../../services/features.js', () => ({
  auth: {
    getType: () => 'jwt',
    getSiteId: () => 'test-site',
  },
  AuthType: { JWT: 'jwt', MOCK: 'mock', NONE: 'none' },
  getFeatures: vi.fn(() => ({})),
}));

vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { JWTAuthMiddleware } from '../jwt-auth.js';
import type { AuthenticatedRequest } from '../jwt-auth.js';

describe('JWTAuthMiddleware', function jwtAuthMiddlewareSuite() {
  let middleware: JWTAuthMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  const baseClaims = {
    iss: 'test',
    aud: 'test',
    siteId: 'test-site',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();

    middleware = new JWTAuthMiddleware();

    mockReq = {
      headers: { authorization: 'Bearer valid-token' },
      path: '/test',
      method: 'GET',
    };

    jsonSpy = vi.fn();
    statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy, json: jsonSpy };
    mockNext = vi.fn();
  });

  describe('agent context model override claims', function modelOverrideClaims() {
    it('should map modelOverride from claims to req.agentContext', async function mapModelOverride() {
      validateTokenMock.mockResolvedValue({
        valid: true,
        claims: { ...baseClaims, modelOverride: 'gpt-4.1-mini' },
      });

      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as AuthenticatedRequest).agentContext?.modelOverride).toBe('gpt-4.1-mini');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should map modelSelectorEnabled from claims to req.agentContext', async function mapModelSelectorEnabled() {
      validateTokenMock.mockResolvedValue({
        valid: true,
        claims: { ...baseClaims, modelSelectorEnabled: true },
      });

      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as AuthenticatedRequest).agentContext?.modelSelectorEnabled).toBe(true);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should default missing model override claims (undefined / false)', async function defaultMissingModelClaims() {
      validateTokenMock.mockResolvedValue({
        valid: true,
        claims: { ...baseClaims },
      });

      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      const ctx = (mockReq as AuthenticatedRequest).agentContext;
      expect(ctx?.modelOverride).toBeUndefined();
      expect(ctx?.modelSelectorEnabled).toBe(false);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
