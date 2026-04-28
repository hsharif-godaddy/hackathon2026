import { type NextFunction, type Request, type Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(function createMocks() {
  return {
    authMock: {
      getType: vi.fn(),
      getSiteId: vi.fn(() => 'local-site-id'),
    },
  };
});

vi.mock('../../../lib/jwt-validator.js', () => ({
  getJWTValidator: () => ({
    validateToken: vi.fn(),
  }),
}));

vi.mock('../../../lib/jwks-config.js', () => ({
  validateJWTAgentConfig: () => ({ valid: true, errors: [] }),
}));

vi.mock('../../../services/features.js', () => ({
  auth: authMock,
  AuthType: { JWT: 'jwt', MOCK: 'mock' },
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

describe('JWTAuthMiddleware local dev auth', function localDevSuite() {
  let middleware: JWTAuthMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(function setup() {
    vi.clearAllMocks();
    mockReq = { headers: {}, path: '/test', method: 'GET' };
    mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    mockNext = vi.fn();
  });

  describe('AuthType.MOCK', function mockSuite() {
    beforeEach(function setAuthMock() {
      authMock.getType.mockReturnValue('mock');
      middleware = new JWTAuthMiddleware();
    });

    it('sets modelSelectorEnabled to true', async function setsModelSelector() {
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as AuthenticatedRequest).agentContext?.modelSelectorEnabled).toBe(true);
      expect(mockNext).toHaveBeenCalled();
    });

    it('does not set modelOverride (relies on frontend selection)', async function noModelOverride() {
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as AuthenticatedRequest).agentContext?.modelOverride).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
