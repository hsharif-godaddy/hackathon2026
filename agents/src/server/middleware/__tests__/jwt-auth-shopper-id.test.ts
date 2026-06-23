import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

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
  AuthType: { JWT: 'jwt', MOCK: 'mock' },
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

describe('jwt-auth shopperId extraction', () => {
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

  beforeEach(() => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should extract shopperId from JWT claims into agentContext', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, shopperId: '4367373' },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.shopperId).toBe('4367373');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should set shopperId to undefined when not present in claims', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.shopperId).toBeUndefined();
    expect(mockNext).toHaveBeenCalled();
  });

  it('should preserve shopperId alongside customerId', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: {
        ...baseClaims,
        customerId: '26c33e83-c9a9-4812-b64b-22c45bcaa075',
        shopperId: '4367373',
      },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.customerId).toBe('26c33e83-c9a9-4812-b64b-22c45bcaa075');
    expect(authReq.agentContext?.shopperId).toBe('4367373');
    expect(mockNext).toHaveBeenCalled();
  });
});
