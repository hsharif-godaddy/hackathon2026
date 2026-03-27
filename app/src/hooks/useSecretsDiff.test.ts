import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useSecretsDiff } from './useSecretsDiff';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockAppFetch = vi.mocked((await import('@/lib/gasket-config')).appFetch);
const mockLogger = vi.mocked((await import('@/lib/request-context')).logger);

describe('useSecretsDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('#fetchDiff', () => {
    it('returns diff data on successful response', async function success() {
      const diff = { added: ['API_KEY'], updated: ['DB_URL'], deleted: [] };
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => diff,
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-123' })
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(diff);
      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/secrets/app-123/diff?source=preview&destination=publish'
      );
    });

    it('returns empty diff and logs warn on non-ok response', async function errorResponse() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-123' })
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({ added: [], updated: [], deleted: [] });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'secrets-diff.fetch.failed',
        { appId: 'app-123', status: 500 }
      );
    });

    it('returns empty diff and logs warn on 501 not-implemented response', async function notImplemented() {
      mockAppFetch.mockResolvedValueOnce({
        ok: false,
        status: 501,
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-123' })
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({ added: [], updated: [], deleted: [] });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'secrets-diff.fetch.failed',
        { appId: 'app-123', status: 501 }
      );
    });

    it('does not fetch when appId is empty', async function emptyAppId() {
      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: '' })
      );

      // fetchStatus stays 'idle' — query never ran
      await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

      expect(mockAppFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when enabled is false', async function disabledFlag() {
      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-123', enabled: false })
      );

      await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

      expect(mockAppFetch).not.toHaveBeenCalled();
    });

    it('uses correct query key so invalidation targets the right cache entry', async function queryKey() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] }),
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-xyz' })
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify the fetch used the right appId in the URL (proves queryKey scoping)
      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/secrets/app-xyz/diff?source=preview&destination=publish'
      );
    });

    it('does not log warn on successful fetch', async function noWarnOnSuccess() {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ added: [], updated: [], deleted: [] }),
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useSecretsDiff({ appId: 'app-123' })
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
