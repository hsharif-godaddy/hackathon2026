import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AuthRequiredError
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

vi.mock('../../../../services/auth-service.js', () => ({
  AuthService: { getAccessToken: mockGetAccessToken },
  AuthRequiredError: MockAuthRequiredError,
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
    expect(result.success).toBe(true);
  });

  it('should return needAuth response when AuthRequiredError is thrown', async () => {
    mockGetAccessToken.mockRejectedValue(
      new MockAuthRequiredError('https://auth.godaddy.com/oauth', 'state-abc', ['commerce.store:read'])
    );

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.needsAuth).toBe(true);
  });

  it('should throw when token has no sub claim', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: undefined,
    });

    const fn = vi.fn();
    await expect(withCommerceAuth('app-123', fn)).rejects.toThrow('Access token missing sub claim');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should throw when sub claim has wrong format', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'test-token',
      sub: 'not-a-customer-id',
    });

    const fn = vi.fn();
    await expect(withCommerceAuth('app-123', fn)).rejects.toThrow('Access token missing expected sub format');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should propagate non-auth errors', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('Network failure'));

    const fn = vi.fn();
    await expect(withCommerceAuth('app-123', fn)).rejects.toThrow('Network failure');
  });
});
