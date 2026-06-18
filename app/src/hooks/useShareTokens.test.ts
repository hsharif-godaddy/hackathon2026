/**
 * @vitest-environment jsdom
 *
 * Coverage for the BFF response-shape guards in useShareTokens. The
 * happy-path (`{ tokens: [...] }`) is exercised end-to-end via the
 * ShareMenu and SharePanel component tests; this file focuses on the
 * defensive branches that those higher-level tests can't easily
 * trigger:
 *   - non-JSON response body          → share-tokens.fetch.parseError
 *   - JSON body without `tokens` key  → share-tokens.fetch.schemaError
 *   - non-2xx response                → share-tokens.fetch.failure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthSessionExpiredError: class AuthSessionExpiredError extends Error {
    constructor() {
      super('Authentication session expired');
      this.name = 'AuthSessionExpiredError';
    }
  },
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

import { useCreateShareToken, useShareTokens } from './useShareTokens';

const APP_ID = 'app-123';

function mockResponse(body: unknown, { status = 200, parseable = true } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!parseable) {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      }
      return body;
    },
  };
}

describe('useShareTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns the tokens array on a well-shaped 200 response', async () => {
    const tokens = [
      {
        token: 'tok-abc',
        appId: APP_ID,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        createdAt: new Date().toISOString(),
      },
    ];
    mockAppFetch.mockResolvedValue(mockResponse({ tokens }));

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.data).toEqual(tokens));
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs schemaError and surfaces error when BFF returns 200 without tokens array', async () => {
    // Future schema drift, proxy returning {}, or any other path where the
    // body parses but the contract is violated. Without the guard,
    // result.tokens.length would throw a TypeError and React Query would
    // surface an untagged runtime error.
    mockAppFetch.mockResolvedValue(mockResponse({}));

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share-tokens.fetch.schemaError',
      expect.objectContaining({ appId: APP_ID, status: 200 }),
    );
  });

  it('logs schemaError when tokens key is present but not an array', async () => {
    // Stricter than the reviewer's example: also catch `{ tokens: null }`
    // and `{ tokens: 'oops' }`. Array.isArray(null) === false so the
    // same branch handles them.
    mockAppFetch.mockResolvedValue(mockResponse({ tokens: null }));

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share-tokens.fetch.schemaError',
      expect.objectContaining({ appId: APP_ID }),
    );
  });

  it('logs parseError when the 200 body is not JSON', async () => {
    mockAppFetch.mockResolvedValue(mockResponse(null, { parseable: false }));

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share-tokens.fetch.parseError',
      expect.objectContaining({ appId: APP_ID, status: 200 }),
    );
  });

  it('logs fetch.failure and surfaces the BFF error message on non-2xx', async () => {
    // The BFF returns structured JSON (`{ error: '...' }`) for known
    // failure modes — the hook should bubble that message up so the UI
    // can show "Feature not available" rather than a generic
    // "Failed to fetch share tokens: 403". Also confirms the non-2xx
    // branch hits its own log site (share-tokens.fetch.failure), not
    // schemaError or parseError.
    mockAppFetch.mockResolvedValue(
      mockResponse({ error: 'Feature not available' }, { status: 403 }),
    );

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share-tokens.fetch.failure',
      expect.objectContaining({ appId: APP_ID, status: 403 }),
    );
    expect(result.current.error?.message).toBe('Feature not available');
  });

  it('falls back to status-only error message when error body is non-JSON', async () => {
    // Inner try/catch in the !response.ok branch: a 502 with an HTML
    // gateway-timeout body would make response.json() throw. Without
    // the catch the SyntaxError would replace the real HTTP failure
    // and log nothing. Assert the fallback message + structured log
    // so a future "simplify the error handler" refactor can't silently
    // regress this case.
    mockAppFetch.mockResolvedValue(
      mockResponse(null, { status: 502, parseable: false }),
    );

    const { result } = renderHookWithProviders(() => useShareTokens(APP_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockLogger.error).toHaveBeenCalledWith(
      'share-tokens.fetch.failure',
      expect.objectContaining({ appId: APP_ID, status: 502 }),
    );
    expect(result.current.error?.message).toBe(
      'Failed to fetch share tokens: 502',
    );
  });

  it('create: routes a 401 through handle401 {level:3} and surfaces AuthSessionExpiredError', async () => {
    // The create route is level-3 (HBI). A session past the 12h window 401s;
    // the create must opt into appFetch's handle401 (which opens the SSO/HBI
    // re-auth modal and retries once on success) and, if re-auth still fails,
    // surface a typed AuthSessionExpiredError rather than a bare 401 the caller
    // would loop on. Regression for the dead-end-401 that fed the ShareLink loop.
    mockAppFetch.mockResolvedValue(
      mockResponse({ error: 'Unauthorized' }, { status: 401 }),
    );

    const { result } = renderHookWithProviders(() => useCreateShareToken());

    await expect(
      result.current.mutateAsync({ appId: APP_ID }),
    ).rejects.toMatchObject({ name: 'AuthSessionExpiredError' });

    expect(mockAppFetch).toHaveBeenCalledWith(
      `/api/apps/${APP_ID}/share`,
      expect.objectContaining({ method: 'POST' }),
      { handle401: { level: 3 } },
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'share-tokens.create.authExpired',
      expect.objectContaining({ appId: APP_ID }),
    );
  });
});
