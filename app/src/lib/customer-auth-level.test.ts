import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockExtractToken = vi.fn();

vi.mock('@/lib/gd-auth-service', () => ({
  gdAuthService: {
    extractTokenFromRequest: (...args: unknown[]) => mockExtractToken(...args),
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  }
}));

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn(() => false)
  }
}));

vi.mock('@/lib/gasket-config', () => ({
  isAuthDisabled: vi.fn(() => false),
  authConfigs: {
    user: { realm: 'idp', risk: 'low', type: ['basic'], allowHeartbeat: true, use12HourExpiration: true }
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

vi.mock('@/lib/apm', () => ({
  startApmTransaction: vi.fn(),
  setApmLabel: vi.fn()
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
