import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockAuthRequiredError extends Error {
  code = 'AUTH_REQUIRED';
  redirectUrl: string;
  state: string;
  scopes: string[];

  constructor(redirectUrl: string, state: string, scopes: string[]) {
    super('Auth required');
    this.redirectUrl = redirectUrl;
    this.state = state;
    this.scopes = scopes;
  }
}

const mockGetAccessToken = vi.fn();
const mockDeleteToken = vi.fn();

vi.mock('../../../../services/auth-service.js', () => ({
  AuthService: { getAccessToken: mockGetAccessToken },
  AuthRequiredError: MockAuthRequiredError,
}));

vi.mock('../../../../services/token-store.js', () => ({
  TokenStore: { delete: mockDeleteToken },
}));

const { withCommerceAuth } = await import('../auth.js');

describe('withCommerceAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call fn with accessToken and customerId on success', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: 'customer:123',
    });

    const fn = vi.fn().mockResolvedValue({ storeId: 'store-1' });
    const result = await withCommerceAuth('app-123', fn);

    expect(fn).toHaveBeenCalledWith('test-token', '123');
    expect(result).toEqual({ success: true, data: { storeId: 'store-1' } });
  });

  it('should return needAuth response when AuthRequiredError is thrown', async () => {
    mockGetAccessToken.mockRejectedValue(
      new MockAuthRequiredError('https://auth.godaddy.com/oauth', 'state-abc', ['commerce.store:read'])
    );

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com/oauth',
      state: 'state-abc',
      scopes: ['commerce.store:read'],
    });
  });

  it('should return error when token has no sub claim', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: undefined,
    });

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('sub claim');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should return error when sub claim has wrong format', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: 'not-a-customer-id',
    });

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('expected sub format');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should force refresh and retry once when Commerce rejects a cached token', async () => {
    mockGetAccessToken
      .mockResolvedValueOnce({
        accessToken: 'stale-token',
        sub: 'customer:123',
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        sub: 'customer:123',
      });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Commerce onboarding API error (401): authorization failed'))
      .mockResolvedValueOnce({ storeId: 'store-1' });

    const result = await withCommerceAuth('app-123', fn);

    expect(fn).toHaveBeenNthCalledWith(1, 'stale-token', '123');
    expect(fn).toHaveBeenNthCalledWith(2, 'fresh-token', '123');
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(1, { appId: 'app-123', forceRefresh: false });
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(2, { appId: 'app-123', forceRefresh: true });
    expect(result).toEqual({ success: true, data: { storeId: 'store-1' } });
  });

  it('should force refresh when a GraphQL endpoint returns an HTTP 401 unauthorized error', async () => {
    mockGetAccessToken
      .mockResolvedValueOnce({
        accessToken: 'stale-token',
        sub: 'customer:123',
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        sub: 'customer:123',
      });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch catalog: GraphQL request failed: 401 Unauthorized - token expired'))
      .mockResolvedValueOnce({ storeId: 'store-1' });

    const result = await withCommerceAuth('app-123', fn);

    expect(fn).toHaveBeenNthCalledWith(1, 'stale-token', '123');
    expect(fn).toHaveBeenNthCalledWith(2, 'fresh-token', '123');
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(1, { appId: 'app-123', forceRefresh: false });
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(2, { appId: 'app-123', forceRefresh: true });
    expect(result).toEqual({ success: true, data: { storeId: 'store-1' } });
  });

  it('should return needsAuth when Commerce still rejects the token after a refresh retry', async () => {
    mockGetAccessToken
      .mockResolvedValueOnce({
        accessToken: 'stale-token',
        sub: 'customer:123',
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        sub: 'customer:123',
      })
      .mockRejectedValueOnce(
        new MockAuthRequiredError('https://auth.godaddy.com/oauth', 'state-abc', ['commerce.store:read'])
      );

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch catalog: Failed to authorize.'))
      .mockRejectedValueOnce(new Error('Commerce onboarding API error (401): authorization failed'));

    const result = await withCommerceAuth('app-123', fn);

    expect(mockDeleteToken).toHaveBeenCalledWith({ appId: 'app-123', provider: 'godaddy' });
    expect(result).toEqual({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com/oauth',
      state: 'state-abc',
      scopes: ['commerce.store:read'],
    });
  });

  it('should return error after clearing the token when Commerce still rejects the replacement token', async () => {
    mockGetAccessToken
      .mockResolvedValueOnce({
        accessToken: 'stale-token',
        sub: 'customer:123',
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        sub: 'customer:123',
      })
      .mockResolvedValueOnce({
        accessToken: 'replacement-token',
        sub: 'customer:123',
      });

    const finalError = new Error('Commerce onboarding API error (401): authorization failed');
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to authorize storefront request.'))
      .mockRejectedValueOnce(new Error('Commerce onboarding API error (401): authorization failed'))
      .mockRejectedValueOnce(finalError);

    const result = await withCommerceAuth('app-123', fn);

    expect(mockDeleteToken).toHaveBeenCalledWith({ appId: 'app-123', provider: 'godaddy' });
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(1, { appId: 'app-123', forceRefresh: false });
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(2, { appId: 'app-123', forceRefresh: true });
    expect(mockGetAccessToken).toHaveBeenNthCalledWith(3, { appId: 'app-123', forceRefresh: true });
    expect(fn).toHaveBeenNthCalledWith(1, 'stale-token', '123');
    expect(fn).toHaveBeenNthCalledWith(2, 'fresh-token', '123');
    expect(fn).toHaveBeenNthCalledWith(3, 'replacement-token', '123');
    expect(result).toEqual({ success: false, error: finalError.message });
  });

  it('should not retry for unrelated unauthorized messages', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: 'customer:123',
    });

    const fn = vi.fn().mockRejectedValue(new Error('Filesystem permission error: unauthorized write to /tmp/app'));

    const result = await withCommerceAuth('app-123', fn);

    expect(result).toEqual({ success: false, error: 'Filesystem permission error: unauthorized write to /tmp/app' });
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockDeleteToken).not.toHaveBeenCalled();
  });

  it('should return error for non-auth errors instead of throwing', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('Network failure'));

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(result).toEqual({ success: false, error: 'Network failure' });
  });
});
