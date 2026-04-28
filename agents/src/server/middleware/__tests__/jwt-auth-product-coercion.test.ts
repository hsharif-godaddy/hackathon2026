import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

const validateTokenMock = vi.fn();

// Mock dependencies before importing the module under test
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

import { JWTAuthMiddleware, coerceProductType } from '../jwt-auth.js';
import type { AuthenticatedRequest } from '../jwt-auth.js';

describe('coerceProductType', () => {
  it('should return PaaSNodeJS when given PaaSNodeJS', () => {
    expect(coerceProductType('PaaSNodeJS')).toBe('PaaSNodeJS');
  });

  it('should return AiroAppBuilder when given AiroAppBuilder', () => {
    expect(coerceProductType('AiroAppBuilder')).toBe('AiroAppBuilder');
  });

  it('should coerce unknown string to AiroAppBuilder', () => {
    expect(coerceProductType('UnknownProduct')).toBe('AiroAppBuilder');
  });

  it('should coerce undefined to AiroAppBuilder', () => {
    expect(coerceProductType(undefined)).toBe('AiroAppBuilder');
  });

  it('should coerce null to AiroAppBuilder', () => {
    expect(coerceProductType(null)).toBe('AiroAppBuilder');
  });

  it('should coerce empty string to AiroAppBuilder', () => {
    expect(coerceProductType('')).toBe('AiroAppBuilder');
  });

  it('should be case-sensitive (paas lowercase is not PaaSNodeJS)', () => {
    expect(coerceProductType('paasnodejs')).toBe('AiroAppBuilder');
  });
});

describe('jwt-auth product coercion', () => {
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

  it('should preserve PaaSNodeJS product claim', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, product: 'PaaSNodeJS' },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.product).toBe('PaaSNodeJS');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should preserve AiroAppBuilder product claim', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, product: 'AiroAppBuilder' },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.product).toBe('AiroAppBuilder');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should coerce unknown product claim to AiroAppBuilder', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, product: 'UnknownProduct' },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.product).toBe('AiroAppBuilder');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should coerce missing product claim to AiroAppBuilder', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims },  // no product field
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.product).toBe('AiroAppBuilder');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should coerce undefined product claim to AiroAppBuilder', async () => {
    validateTokenMock.mockResolvedValue({
      valid: true,
      claims: { ...baseClaims, product: undefined },
    });

    await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

    const authReq = mockReq as AuthenticatedRequest;
    expect(authReq.agentContext?.product).toBe('AiroAppBuilder');
    expect(mockNext).toHaveBeenCalled();
  });
});
