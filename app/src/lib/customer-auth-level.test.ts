import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isFeatureEnabled } from '@/lib/features';

const mockAuthenticate = vi.fn();
const mockExtractToken = vi.fn();
const mockExtractShopperId = vi.fn();
const mockExtractCustomerId = vi.fn();

vi.mock('@/lib/gd-auth-service', () => ({
  gdAuthService: {
    extractTokenFromRequest: (...args: unknown[]) => mockExtractToken(...args),
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  },
  extractTokenFromRequest: (...args: unknown[]) => mockExtractToken(...args),
}));

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn(() => false)
  }
}));

vi.mock('@/lib/gasket-config', () => ({
  
  authConfigs: {
    user: { realm: 'idp', risk: 'low', type: ['basic'], allowHeartbeat: false, use12HourExpiration: true }
  }
}));

vi.mock('@/lib/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/request-context')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    RequestContextService: {
      run: vi.fn((_ctx: unknown, fn: () => unknown) => fn())
    }
  };
});

vi.mock('@/lib/apm-context', () => ({
  startApmTransaction: vi.fn(() => null),
  addApmContext: vi.fn(),
  extractAppIdFromPath: vi.fn(() => null),
  setApmAppId: vi.fn(),
  setApmCustomerId: vi.fn(),
  setApmJobId: vi.fn(),
  setApmUserContext: vi.fn(),
}));

vi.mock('@/lib/utils/jwt-utils', () => ({
  extractShopperId: (...args: unknown[]) => mockExtractShopperId(...args),
  extractCustomerId: (...args: unknown[]) => mockExtractCustomerId(...args),
}));

const validPayload = {
  shopperId: 'shopper-123',
  cid: 'customer-456',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  authType: 'basic'
};

describe('authenticateCustomer level passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
    mockAuthenticate.mockResolvedValue({ valid: true, payload: validPayload });
  });

  it('should pass level 3 to gdAuthService.authenticate', async () => {
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await authenticateCustomer(request, 3);

    expect(mockAuthenticate).toHaveBeenCalledWith('test-token', 3);
  });

  it('should pass level 2 to gdAuthService.authenticate', async () => {
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await authenticateCustomer(request, 2);

    expect(mockAuthenticate).toHaveBeenCalledWith('test-token', 2);
  });

  it('should pass undefined level when not specified', async () => {
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await authenticateCustomer(request);

    expect(mockAuthenticate).toHaveBeenCalledWith('test-token', undefined);
  });
});

describe('authenticateCustomer authReason propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
  });

  it('should include authReason when gd-auth returns ssoCode', async () => {
    mockAuthenticate.mockResolvedValue({
      valid: false,
      reason: 'Token is expired (ssoCode: 2)',
      authReason: 2
    });

    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    const result = await authenticateCustomer(request, 3);

    expect(result.isAuthenticated).toBe(false);
    expect(result).toHaveProperty('authReason', 2);
  });

  it('should omit authReason when gd-auth does not return ssoCode', async () => {
    mockAuthenticate.mockResolvedValue({
      valid: false,
      reason: 'Invalid token'
    });

    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    const result = await authenticateCustomer(request, 2);

    expect(result.isAuthenticated).toBe(false);
    expect(result).not.toHaveProperty('authReason');
  });
});

describe('withCustomerAuth level option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
    mockAuthenticate.mockResolvedValue({ valid: true, payload: validPayload });
  });

  it('should pass level 3 from options through to authenticateCustomer', async () => {
    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const wrappedHandler = withCustomerAuth(handler, { level: 3 });
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    expect(mockAuthenticate).toHaveBeenCalledWith('test-token', 3);
  });

  it('should default to undefined level when no options provided', async () => {
    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const wrappedHandler = withCustomerAuth(handler);
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    expect(mockAuthenticate).toHaveBeenCalledWith('test-token', undefined);
  });
});

describe('withCustomerAuth 401 response with authReason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
  });

  it('should include authReason in 401 JSON when HBI expired', async () => {
    mockAuthenticate.mockResolvedValue({
      valid: false,
      reason: 'Token is expired (ssoCode: 2)',
      authReason: 2
    });

    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const wrappedHandler = withCustomerAuth(handler, { level: 3 });
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      error: 'Unauthorized',
      requiresAuth: true,
      authReason: 2
    });
  });

  it('should omit authReason from 401 JSON when not provided by gd-auth', async () => {
    mockAuthenticate.mockResolvedValue({
      valid: false,
      reason: 'No authentication token provided'
    });

    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const wrappedHandler = withCustomerAuth(handler);
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body).not.toHaveProperty('authReason');
  });
});

describe('withCustomerAuth request context initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
    mockAuthenticate.mockResolvedValue({ valid: true, payload: validPayload });
    mockExtractCustomerId.mockReturnValue('customer-456');
    mockExtractShopperId.mockReturnValue('shopper-123');
  });

  it('should initialize context with path, method, and userAgent before auth runs', async () => {
    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/sites/abc', {
      method: 'POST',
      headers: { 'user-agent': 'TestBrowser/1.0', cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    const runMock = vi.mocked(RequestContextService.run);
    expect(runMock).toHaveBeenCalledOnce();
    const ctx = runMock.mock.calls[0][0];
    expect(ctx.path).toBe('/api/sites/abc');
    expect(ctx.method).toBe('POST');
    expect(ctx.userAgent).toBe('TestBrowser/1.0');
  });

  it('should overwrite pre-decoded context with validated auth values after successful auth', async () => {
    // Use different pre-decoded values than validPayload to verify the overwrite actually happens
    mockExtractCustomerId.mockReturnValue('predecoded-customer');
    mockExtractShopperId.mockReturnValue('predecoded-shopper');

    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    // Should be the validated values from validPayload, not the pre-decoded ones
    expect(ctx.customerId).toBe('customer-456');
    expect(ctx.shopperId).toBe('shopper-123');
  });

  it('should retain pre-decoded customerId in context when auth fails (for log enrichment)', async () => {
    mockAuthenticate.mockResolvedValue({ valid: false, reason: 'Token expired' });
    mockExtractCustomerId.mockReturnValue('predecoded-customer');
    mockExtractShopperId.mockReturnValue('predecoded-shopper');

    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    // Best-effort pre-decoded values should be retained so auth-failure logs are enriched
    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    expect(ctx.customerId).toBe('predecoded-customer');
    expect(ctx.shopperId).toBe('predecoded-shopper');
  });

  it('should leave customerId undefined when neither pre-decode nor auth provides one', async () => {
    mockAuthenticate.mockResolvedValue({ valid: false, reason: 'Token expired' });
    mockExtractCustomerId.mockReturnValue(null);
    mockExtractShopperId.mockReturnValue(null);

    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    expect(ctx.customerId).toBeUndefined();
    expect(ctx.shopperId).toBeUndefined();
  });

  it('should truncate user-agent to 300 characters', async () => {
    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const longUserAgent = 'A'.repeat(500);
    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'user-agent': longUserAgent, cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    expect(ctx.userAgent).toHaveLength(300);
  });

  it('should skip pre-decode and leave customerId/shopperId undefined when no token is present', async () => {
    mockExtractToken.mockReturnValue(null);

    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/test');

    await wrappedHandler(request);

    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    expect(ctx.customerId).toBeUndefined();
    expect(ctx.shopperId).toBeUndefined();
    expect(mockExtractCustomerId).not.toHaveBeenCalled();
    expect(mockExtractShopperId).not.toHaveBeenCalled();
  });

  it('should set appId on context when extractAppIdFromPath returns a value', async () => {
    const { extractAppIdFromPath } = await import('@/lib/apm-context');
    vi.mocked(extractAppIdFromPath).mockReturnValue('app-xyz');

    const { RequestContextService } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const wrappedHandler = withCustomerAuth(vi.fn().mockResolvedValue(new Response('ok')));
    const request = new NextRequest('http://localhost/api/sites/app-xyz', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await wrappedHandler(request);

    const ctx = vi.mocked(RequestContextService.run).mock.calls[0][0];
    expect(ctx.appId).toBe('app-xyz');
  });
});

describe('authenticateCustomer mock login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureEnabled.mockLogin).mockReturnValue(true);
  });

  it('returns isAuthenticated: true with mock user ids', async () => {
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test');

    const result = await authenticateCustomer(request);

    expect(result.isAuthenticated).toBe(true);
    if (!result.isAuthenticated) return;
    expect(result.user.shopperId).toBe('dev-user-123');
    expect(result.user.customerId).toBe('dev-user-123');
  });

  it('returns a spec-compliant alg:none JWT with empty signature segment', async () => {
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test');

    const result = await authenticateCustomer(request);

    expect(result.isAuthenticated).toBe(true);
    if (!result.isAuthenticated) return;
    expect(result.jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.$/);
  });

  it('encodes cid, shopperId, iat, and exp in the JWT payload', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { authenticateCustomer } = await import('./customer-auth');
    const request = new NextRequest('http://localhost/api/test');

    const result = await authenticateCustomer(request);
    const after = Math.floor(Date.now() / 1000);

    expect(result.isAuthenticated).toBe(true);
    if (!result.isAuthenticated) return;
    const [, payloadB64] = result.jwt.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    expect(payload.cid).toBe('dev-user-123');
    expect(payload.shopperId).toBe('dev-user-123');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBe(payload.iat + 3600);
  });
});

describe('withCustomerAuth handler-throws path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractToken.mockReturnValue('test-token');
    mockAuthenticate.mockResolvedValue({ valid: true, payload: validPayload });
    mockExtractCustomerId.mockReturnValue('customer-456');
    mockExtractShopperId.mockReturnValue('shopper-123');
  });

  it('logs auth.handler.unhandled with context and rethrows when handler throws', async () => {
    const { logger } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');

    const handlerError = new Error('boom');
    const wrappedHandler = withCustomerAuth(vi.fn().mockRejectedValue(handlerError));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    await expect(wrappedHandler(request)).rejects.toThrow('boom');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'auth.handler.unhandled',
      expect.objectContaining({ errorMessage: 'boom' }),
      expect.objectContaining({ tags: ['security'] })
    );
  });

  it('converts uncaught mgmt-airo AiroHttpError(401) to authReason:2 without logging auth.handler.unhandled', async () => {
    const { logger } = await import('@/lib/request-context');
    const { withCustomerAuth } = await import('./customer-auth');
    const { AiroHttpError } = await import('@/lib/mgmt-airo/types');

    const handlerError = new AiroHttpError(401, 'Unauthorized', 'token expired');
    const wrappedHandler = withCustomerAuth(vi.fn().mockRejectedValue(handlerError));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { cookie: 'auth_idp=test-token' }
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized', authReason: 2 });
    expect(vi.mocked(logger.error)).not.toHaveBeenCalledWith(
      'auth.handler.unhandled',
      expect.anything(),
      expect.anything()
    );
  });
});
