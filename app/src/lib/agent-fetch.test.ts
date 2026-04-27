/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock gasket-config so appFetch delegates to global.fetch.
// This lets existing test mocks continue to work for getAgentToken.
vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => (global.fetch as any)(...args),
}));

describe('agent-fetch', function packageTests() {
  let agentFetch: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Dynamically import to get fresh module with reset caches
    const module = await import('./agent-fetch'); // eslint-disable-line @next/next/no-assign-module-variable
    agentFetch = module.agentFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('token caching', function caching() {
    it('should cache tokens and reuse them', async function cacheTokens() {
      const mockToken = 'test-token-123';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken, expires: mockExpires.toISOString() }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      // First call - should fetch token
      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(2); // 1 for token, 1 for actual request

      // Second call - should use cached token
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test2', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(3); // No new token call, just the actual request
    });

    it('should refresh token when it expires soon', async function refreshExpiredToken() {
      const mockToken1 = 'test-token-1';
      const mockToken2 = 'test-token-2';
      const expiresSoon = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now
      const expiresLater = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now

      // First token request (expires soon)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken1, expires: expiresSoon.toISOString() }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(2);

      // Second call - should fetch new token because old one expires soon
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken2, expires: expiresLater.toISOString() }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test2', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(4); // New token call + actual request
    });
  });

  describe('concurrent request deduplication', function deduplication() {
    it('should deduplicate concurrent token requests', async function deduplicateRequests() {
      const mockToken = 'test-token-123';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      // Mock token endpoint
      vi.mocked(fetch).mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('agent-token')) {
          // Add delay to simulate slow token request
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            ok: true,
            json: async () => ({ token: mockToken, expires: mockExpires.toISOString() }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
        } as Response;
      });

      // Make 5 concurrent requests
      const requests = Promise.all([
        agentFetch('http://localhost:4000/test1', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test2', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test3', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test4', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test5', { siteId: 'test-site' }),
      ]);

      await requests;

      // Count token requests
      const tokenCalls = vi.mocked(fetch).mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('agent-token')
      );

      // Should only make 1 token request despite 5 concurrent calls
      expect(tokenCalls.length).toBe(1);

      // Total calls should be 6 (1 token + 5 actual requests)
      expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('should handle different siteIds independently', async function handleDifferentSites() {
      const mockToken1 = 'token-site-1';
      const mockToken2 = 'token-site-2';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockImplementation(async (url, options) => {
        if (typeof url === 'string' && url.includes('agent-token')) {
          const body = JSON.parse(options?.body as string);
          const token = body.siteId === 'site-1' ? mockToken1 : mockToken2;
          return {
            ok: true,
            json: async () => ({ token, expires: mockExpires.toISOString() }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
        } as Response;
      });

      // Make concurrent requests for different sites
      await Promise.all([
        agentFetch('http://localhost:4000/test1', { siteId: 'site-1' }),
        agentFetch('http://localhost:4000/test2', { siteId: 'site-2' }),
      ]);

      // Should make 2 token requests (one per site)
      const tokenCalls = vi.mocked(fetch).mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('agent-token')
      );
      expect(tokenCalls.length).toBe(2);
    });
  });

  describe('401 retry', function retry() {
    it('should retry with fresh token on 401', async function retryOn401() {
      const mockToken1 = 'expired-token';
      const mockToken2 = 'fresh-token';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      // First token request
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken1, expires: mockExpires.toISOString() }),
      } as Response);

      // First request fails with 401
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      // Second token request (after 401)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken2, expires: mockExpires.toISOString() }),
      } as Response);

      // Retry succeeds
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(4); // 2 token calls + 2 actual requests
    });
  });

});
