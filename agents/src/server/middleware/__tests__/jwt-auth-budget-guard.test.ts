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
import { logger } from '../../../logging/index.js';

describe('jwt-auth budget service guard', () => {
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

  it('should preserve budgetServiceEnabled when subscriptionId is present', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, budgetServiceEnabled: true, subscriptionId: 'sub-123' },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.budgetServiceEnabled).toBe(true);
    expect(authReq.agentContext?.subscriptionId).toBe('sub-123');
    expect(logger.warn).not.toHaveBeenCalledWith(
      'jwt-auth.budget-service.missing-subscription-id',
      expect.anything(),
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('should coerce budgetServiceEnabled to false when subscriptionId is missing', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, budgetServiceEnabled: true },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.budgetServiceEnabled).toBe(false);
    expect(authReq.agentContext?.subscriptionId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'jwt-auth.budget-service.missing-subscription-id',
      { siteId: 'test-site' },
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('should not warn when budgetServiceEnabled is false and subscriptionId is missing', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, budgetServiceEnabled: false },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.budgetServiceEnabled).toBe(false);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'jwt-auth.budget-service.missing-subscription-id',
      expect.anything(),
    );
    expect(mockNext).toHaveBeenCalled();
  });
});
