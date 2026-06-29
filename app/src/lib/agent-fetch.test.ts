/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthDismissedError } from '@/lib/gasket-config';

const mockAppFetch = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

global.fetch = vi.fn();

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthDismissedError: class MockAuthDismissedError extends Error {
    constructor() {
      super('Authentication dismissed');
      this.name = 'AuthDismissedError';
    }
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/stores/useBillingModeStore', () => ({
  useBillingModeStore: {
    getState: () => ({
      setMode: vi.fn(),
      clearMode: vi.fn(),
    }),
  },
}));

describe('agent-fetch', function packageTests() {
  let agentFetch: typeof import('./agent-fetch').agentFetch;
  let getAgentToken: typeof import('./agent-fetch').getAgentToken;
  let AgentTokenAcquisitionError: typeof import('./agent-fetch').AgentTokenAcquisitionError;
  let CACHE_BUFFER_MS: number;

  beforeEach(async function setup() {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    mockAppFetch.mockImplementation((url: unknown, init?: unknown) =>
      (global.fetch as typeof fetch)(url as RequestInfo, init as RequestInit)
    );
    const agentFetchModule = await import('./agent-fetch');
    agentFetch = agentFetchModule.agentFetch;
    getAgentToken = agentFetchModule.getAgentToken;
    AgentTokenAcquisitionError = agentFetchModule.AgentTokenAcquisitionError;
    CACHE_BUFFER_MS = agentFetchModule.CACHE_BUFFER_MS;
  });

  afterEach(function teardown() {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('token caching', function caching() {
    it('should cache tokens and reuse them', async function cacheTokens() {
      const mockToken = 'test-token-123';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken, expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/auth/agent-token',
        expect.objectContaining({ method: 'POST' }),
        { handle401: true },
      );
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test2', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should refresh token when it expires soon', async function refreshExpiredToken() {
      const mockToken1 = 'test-token-1';
      const mockToken2 = 'test-token-2';
      const expiresSoon = new Date(Date.now() + 10 * 60 * 1000);
      const expiresLater = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken1, expires: expiresSoon.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(2);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken2, expires: expiresLater.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test2', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('agent-token auth recovery', function authRecovery() {
    it('passes handle401 to appFetch for agent-token acquisition', async function handle401Option() {
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'token', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      await getAgentToken('site-auth');

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/auth/agent-token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ siteId: 'site-auth' }),
        }),
        { handle401: true },
      );
    });

    it('throws AgentTokenAcquisitionError when SSO is dismissed', async function dismissed() {
      mockAppFetch.mockRejectedValueOnce(new AuthDismissedError());

      await expect(getAgentToken('site-dismiss')).rejects.toMatchObject({
        name: 'AgentTokenAcquisitionError',
        reason: 'auth_dismissed',
      });
    });

    it('throws AgentTokenAcquisitionError when agent-token still returns 401', async function unauthorized() {
      mockAppFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

      await expect(getAgentToken('site-401')).rejects.toMatchObject({
        name: 'AgentTokenAcquisitionError',
        reason: 'auth_failed',
      });
    });
  });

  describe('proactive refresh', function proactiveRefresh() {
    it('prefetches a fresh token before the cache buffer expires', async function prefetchBeforeExpiry() {
      vi.useFakeTimers();
      const mockExpires = new Date(Date.now() + 20 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'token-v1', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      await getAgentToken('site-proactive');
      expect(mockAppFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20 * 60 * 1000 - CACHE_BUFFER_MS + 1);
      await vi.runAllTimersAsync();

      expect(mockAppFetch).toHaveBeenCalledTimes(2);
    });

    it('warns with auth reason when proactive refresh fails', async function prefetchAuthFailure() {
      vi.useFakeTimers();
      const mockExpires = new Date(Date.now() + 20 * 60 * 1000);

      mockAppFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'token-v1', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
        } as Response)
        .mockResolvedValueOnce({ ok: false, status: 401 } as Response);

      await getAgentToken('site-proactive-fail');
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000 - CACHE_BUFFER_MS + 1);
      await vi.runAllTimersAsync();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'agent-token.proactive-refresh.failed',
        expect.objectContaining({ siteId: 'site-proactive-fail', reason: 'auth_failed' }),
      );
    });

    it('refreshes on visibilitychange when token is within the buffer window', async function visibilityRefresh() {
      const mockExpires = new Date(Date.now() + 4 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'token-v1', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      await getAgentToken('site-visibility');
      expect(mockAppFetch).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(mockAppFetch).toHaveBeenCalledTimes(2));
    });
  });

  describe('concurrent request deduplication', function deduplication() {
    it('should deduplicate concurrent token requests', async function deduplicateRequests() {
      const mockToken = 'test-token-123';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockImplementation(async function (url) {
        if (typeof url === 'string' && url.includes('agent-token')) {
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            ok: true,
            json: async () => ({ token: mockToken, expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
        } as Response;
      });

      await Promise.all([
        agentFetch('http://localhost:4000/test1', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test2', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test3', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test4', { siteId: 'test-site' }),
        agentFetch('http://localhost:4000/test5', { siteId: 'test-site' }),
      ]);

      const tokenCalls = mockAppFetch.mock.calls.filter(
        call => call[0] === '/api/auth/agent-token'
      );

      expect(tokenCalls.length).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('should handle different siteIds independently', async function handleDifferentSites() {
      const mockToken1 = 'token-site-1';
      const mockToken2 = 'token-site-2';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockImplementation(async function (url, options) {
        if (typeof url === 'string' && url.includes('agent-token')) {
          const body = JSON.parse((options as RequestInit)?.body as string);
          const token = body.siteId === 'site-1' ? mockToken1 : mockToken2;
          return {
            ok: true,
            json: async () => ({ token, expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
        } as Response;
      });

      await Promise.all([
        agentFetch('http://localhost:4000/test1', { siteId: 'site-1' }),
        agentFetch('http://localhost:4000/test2', { siteId: 'site-2' }),
      ]);

      const tokenCalls = mockAppFetch.mock.calls.filter(
        call => call[0] === '/api/auth/agent-token'
      );
      expect(tokenCalls.length).toBe(2);
    });
  });

  describe('401 retry', function retry() {
    it('should retry with fresh token on 401', async function retryOn401() {
      const mockToken1 = 'expired-token';
      const mockToken2 = 'fresh-token';
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken1, expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: mockToken2, expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('warns when the retry is still unauthorized', async function retryStill401() {
      const mockExpires = new Date(Date.now() + 12 * 60 * 60 * 1000);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'token-1', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'token-2', expires: mockExpires.toISOString(), budgetServiceEnabled: false }),
      } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);

      const response = await agentFetch('http://localhost:4000/test', { siteId: 'test-site' });

      expect(response.status).toBe(401);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'agent-fetch.retry.still-unauthorized',
        expect.objectContaining({ siteId: 'test-site' }),
      );
    });
  });

  describe('CACHE_BUFFER_MS', function bufferConstant() {
    it('is 15 minutes (10-minute request timeout + 5-minute margin)', function fifteenMinutes() {
      expect(CACHE_BUFFER_MS).toBe(15 * 60 * 1000);
    });
  });

  describe('isAgentTokenAuthError', function authErrorHelper() {
    it('detects AgentTokenAcquisitionError', async function typedError() {
      const { isAgentTokenAuthError } = await import('./agent-fetch');
      expect(isAgentTokenAuthError(new AgentTokenAcquisitionError('auth_failed', 'Failed to get agent token: 401'))).toBe(true);
    });

    it('detects AuthDismissedError', async function dismissedError() {
      const { isAgentTokenAuthError } = await import('./agent-fetch');
      expect(isAgentTokenAuthError(new AuthDismissedError())).toBe(true);
    });

    it('returns false for generic errors', async function genericError() {
      const { isAgentTokenAuthError, getAgentTokenAuthFailureReason } = await import('./agent-fetch');
      expect(isAgentTokenAuthError(new Error('Failed to get agent token: 403'))).toBe(false);
      expect(getAgentTokenAuthFailureReason(new Error('network'))).toBeNull();
    });
  });
});
