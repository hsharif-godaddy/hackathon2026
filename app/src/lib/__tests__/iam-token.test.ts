import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetToken = vi.fn();
const mockOnce = vi.fn();

vi.mock('gd-auth-client', () => ({
  IamTokenClient: vi.fn().mockImplementation(function () { return {
    getToken: mockGetToken,
    once: mockOnce,
  }; }),
}));

vi.mock('@/lib/gasket-config', () => ({
  getSsoHostSync: vi.fn().mockReturnValue('sso.test-godaddy.com'),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('getIamToken', () => {
  let getIamToken: typeof import('../iam-token').getIamToken;
  let clearIamTokenCache: typeof import('../iam-token').clearIamTokenCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Fresh import each test to reset module state
    const mod = await import('../iam-token');
    getIamToken = mod.getIamToken;
    clearIamTokenCache = mod.clearIamTokenCache;
    clearIamTokenCache();
  });

  afterEach(() => {
    clearIamTokenCache();
  });

  it('fetches token from IamTokenClient on first call', async () => {
    mockGetToken.mockResolvedValue('test-jwt-token');

    const token = await getIamToken();

    expect(token).toBe('test-jwt-token');
    expect(mockGetToken).toHaveBeenCalledOnce();
  });

  it('returns cached token on subsequent calls within TTL', async () => {
    mockGetToken.mockResolvedValue('cached-jwt');

    const first = await getIamToken();
    const second = await getIamToken();

    expect(first).toBe('cached-jwt');
    expect(second).toBe('cached-jwt');
    expect(mockGetToken).toHaveBeenCalledOnce();
  });

  it('refreshes token after cache expires', async () => {
    mockGetToken.mockResolvedValueOnce('old-jwt').mockResolvedValueOnce('new-jwt');

    const first = await getIamToken();
    expect(first).toBe('old-jwt');

    // Expire the cache by advancing time past 30min TTL
    const baseTime = Date.now()
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(baseTime + 31 * 60 * 1000) // expired check
      .mockReturnValue(baseTime + 31 * 60 * 1000); // new cache entry

    const second = await getIamToken();
    expect(second).toBe('new-jwt');
    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent calls via mutex', async () => {
    let resolveToken: (v: string) => void;
    mockGetToken.mockReturnValue(new Promise<string>((r) => { resolveToken = r; }));

    const p1 = getIamToken();
    const p2 = getIamToken();
    const p3 = getIamToken();

    resolveToken!('shared-jwt');

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe('shared-jwt');
    expect(t2).toBe('shared-jwt');
    expect(t3).toBe('shared-jwt');
    expect(mockGetToken).toHaveBeenCalledOnce();
  });

  it('clears refreshPromise after successful fetch', async () => {
    mockGetToken.mockResolvedValueOnce('jwt-1').mockResolvedValueOnce('jwt-2');

    await getIamToken();
    // Clear cache to force re-fetch (but refreshPromise should be null)
    clearIamTokenCache();
    const second = await getIamToken();

    expect(second).toBe('jwt-2');
    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });

  it('clears refreshPromise after failed fetch', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('IAM down'));

    await expect(getIamToken()).rejects.toThrow('Failed to retrieve IAM S2S token: IAM down');

    // Subsequent call should retry (refreshPromise cleared by finally block)
    mockGetToken.mockResolvedValueOnce('recovered-jwt');
    const token = await getIamToken();
    expect(token).toBe('recovered-jwt');
  });

  it('wraps IamTokenClient errors with descriptive message', async () => {
    mockGetToken.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getIamToken()).rejects.toThrow('Failed to retrieve IAM S2S token: ECONNREFUSED');
  });

  it('handles non-Error throws', async () => {
    mockGetToken.mockRejectedValue('string error');

    await expect(getIamToken()).rejects.toThrow('Failed to retrieve IAM S2S token: string error');
  });

  it('registers background_error listener on IamTokenClient', async () => {
    mockGetToken.mockResolvedValue('jwt');

    await getIamToken();

    expect(mockOnce).toHaveBeenCalledWith('background_error', expect.any(Function));
  });

  it('logs primary region failure via background_error handler', async () => {
    mockGetToken.mockResolvedValue('jwt');
    const { logger } = await import('@/lib/request-context');

    await getIamToken();

    // Simulate background_error event
    const handler = mockOnce.mock.calls[0][1];
    handler({ message: 'timeout', code: 'ETIMEDOUT' });

    expect(logger.error).toHaveBeenCalledWith('iam.token.primaryRegionFailure', {
      message: 'timeout',
      code: 'ETIMEDOUT',
      ssoHost: 'sso.test-godaddy.com',
    });
  });

  it('passes ssoHost from getSsoHostSync to IamTokenClient', async () => {
    const { IamTokenClient } = await import('gd-auth-client');
    mockGetToken.mockResolvedValue('jwt');

    await getIamToken();

    expect(IamTokenClient).toHaveBeenCalledWith('sso.test-godaddy.com');
  });

  it('clearIamTokenCache resets both cache and promise', async () => {
    mockGetToken.mockResolvedValue('jwt-a');
    await getIamToken();

    clearIamTokenCache();

    mockGetToken.mockResolvedValue('jwt-b');
    const token = await getIamToken();
    expect(token).toBe('jwt-b');
    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });
});
