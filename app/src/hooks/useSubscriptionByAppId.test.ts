import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { logger } from '@/lib/request-context';

describe('useSubscriptionByAppId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('should be defined', async () => {
    const { useSubscriptionByAppId } = await import('./useSubscriptionByAppId');
    expect(useSubscriptionByAppId).toBeDefined();
  });

  describe('fetchSubscriptionByAppId', () => {
    it('throws a status-coded subscription error when an error response has a non-JSON body', async () => {
      const { fetchSubscriptionByAppId } = await import('./useSubscriptionByAppId');
      const json = vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'"));

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json,
      }));

      await expect(fetchSubscriptionByAppId('app-123')).rejects.toMatchObject({
        name: 'SubscriptionQueryError',
        message: 'Failed to fetch subscription data: 403',
        statusCode: 403,
      });
      expect(logger.error).toHaveBeenCalledWith('subscription.query.error', {
        appId: 'app-123',
        statusCode: 403,
        error: 'Failed to fetch subscription data: 403',
      });
    });

    it('uses the server error message when an error response has a JSON body', async () => {
      const { fetchSubscriptionByAppId } = await import('./useSubscriptionByAppId');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ error: 'Forbidden' }),
      }));

      await expect(fetchSubscriptionByAppId('app-123')).rejects.toMatchObject({
        name: 'SubscriptionQueryError',
        message: 'Forbidden',
        statusCode: 403,
      });
    });
  });

  describe('shouldRetrySubscriptionQuery', () => {
    it('does not retry 4xx subscription errors', async () => {
      const { shouldRetrySubscriptionQuery, SubscriptionQueryError } = await import('./useSubscriptionByAppId');

      expect(shouldRetrySubscriptionQuery(0, new SubscriptionQueryError('Forbidden', 403))).toBe(false);
      expect(shouldRetrySubscriptionQuery(0, new SubscriptionQueryError('Not found', 404))).toBe(false);
    });

    it('retries 5xx subscription errors within the retry budget', async () => {
      const { shouldRetrySubscriptionQuery, SubscriptionQueryError } = await import('./useSubscriptionByAppId');

      expect(shouldRetrySubscriptionQuery(0, new SubscriptionQueryError('Gateway timeout', 504))).toBe(true);
      expect(shouldRetrySubscriptionQuery(2, new SubscriptionQueryError('Gateway timeout', 504))).toBe(true);
      expect(shouldRetrySubscriptionQuery(3, new SubscriptionQueryError('Gateway timeout', 504))).toBe(false);
    });

    it('retries non-status errors within the retry budget', async () => {
      const { shouldRetrySubscriptionQuery } = await import('./useSubscriptionByAppId');

      expect(shouldRetrySubscriptionQuery(0, new Error('network'))).toBe(true);
      expect(shouldRetrySubscriptionQuery(2, new Error('network'))).toBe(true);
      expect(shouldRetrySubscriptionQuery(3, new Error('network'))).toBe(false);
    });

    it('retries subscription errors without a status code within the retry budget', async () => {
      const { shouldRetrySubscriptionQuery, SubscriptionQueryError } = await import('./useSubscriptionByAppId');

      expect(shouldRetrySubscriptionQuery(0, new SubscriptionQueryError('unknown'))).toBe(true);
      expect(shouldRetrySubscriptionQuery(3, new SubscriptionQueryError('unknown'))).toBe(false);
    });
  });
});
