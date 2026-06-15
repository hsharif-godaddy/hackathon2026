import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    mockLogin: vi.fn(function () { return false; })
  }
}));

vi.mock('@/lib/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/request-context')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    RequestContextService: {
      run: vi.fn(function (_ctx: unknown, fn: () => unknown) { return fn(); })
    }
  };
});

vi.mock('@/lib/apm-context', () => ({
  startApmTransaction: vi.fn(function () { return null; }),
  addApmContext: vi.fn(),
  extractAppIdFromPath: vi.fn(function () { return null; }),
  setApmAppId: vi.fn(),
  setApmCustomerId: vi.fn(),
  setApmJobId: vi.fn(),
  setApmUserContext: vi.fn(),
}));

vi.mock('@/lib/utils/jwt-utils', () => ({
  extractShopperId: (...args: unknown[]) => mockExtractShopperId(...args),
  extractCustomerId: (...args: unknown[]) => mockExtractCustomerId(...args),
}));

const ALLOWED_ORIGIN = 'https://local.cx.test-godaddy.com:8443';

describe('withCustomerAuth CORS on 401', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No token → unauthenticated, wrapper short-circuits before the handler.
    mockExtractToken.mockReturnValue(null);
    mockExtractCustomerId.mockReturnValue(null);
    mockExtractShopperId.mockReturnValue(null);
  });

  it('sets Access-Control-Allow-Origin on the 401 for an allowlisted origin', async () => {
    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withCustomerAuth(handler, { addCorsHeaders: true, corsRoute: 'GET_SUBSCRIPTIONS' });

    const request = new NextRequest('https://airo-builder.godaddy.com/api/subscriptions', {
      headers: { origin: ALLOWED_ORIGIN }
    });

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    // Proves the wrapper short-circuited before the handler ran.
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not set CORS headers for an origin that is allowed in GET_SITES but not QUICK_CREATE', async () => {
    const GET_SITES_ALLOWED_ORIGIN = 'https://account.godaddy.com';
    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withCustomerAuth(handler, { addCorsHeaders: true, corsRoute: 'QUICK_CREATE' });

    const request = new NextRequest('https://airo-builder.godaddy.com/api/sites/quick-create', {
      headers: { origin: GET_SITES_ALLOWED_ORIGIN }
    });

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not set CORS headers for an origin that is allowed in QUICK_CREATE but not GET_SITES', async () => {
    const QUICK_CREATE_ALLOWED_ORIGIN = 'https://start.godaddy.com';
    const { withCustomerAuth } = await import('./customer-auth');
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withCustomerAuth(handler, { addCorsHeaders: true, corsRoute: 'GET_SITES' });

    const request = new NextRequest('https://airo-builder.godaddy.com/api/sites', {
      headers: { origin: QUICK_CREATE_ALLOWED_ORIGIN }
    });

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not set CORS headers on the 401 for a non-allowlisted origin', async () => {
    const { withCustomerAuth } = await import('./customer-auth');
    const wrapped = withCustomerAuth(async () => NextResponse.json({ ok: true }));

    const request = new NextRequest('https://airo-builder.godaddy.com/api/subscriptions', {
      headers: { origin: 'https://evil.example.com' }
    });

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not set CORS headers on the 401 for a same-origin request (no Origin header)', async () => {
    const { withCustomerAuth } = await import('./customer-auth');
    const wrapped = withCustomerAuth(async () => NextResponse.json({ ok: true }));

    const request = new NextRequest('https://airo-builder.godaddy.com/api/subscriptions');

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});
