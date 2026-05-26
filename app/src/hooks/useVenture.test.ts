import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useVenture } from './useVenture';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

describe('useVenture', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('returns ventureId when API succeeds', async function success() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, ventureId: 'venture-abc' }),
    } as Response);

    const { result } = renderHookWithProviders(() => useVenture());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.ventureId).toBe('venture-abc');
    expect(result.current.isError).toBe(false);
  });

  it('calls /api/venture with credentials', async function endpoint() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, ventureId: 'venture-abc' }),
    } as Response);

    renderHookWithProviders(() => useVenture());

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/venture', { credentials: 'include' });
    });
  });

  it('flags error and skips ventureId when API returns 4xx', async function notOk() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHookWithProviders(() => useVenture());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.ventureId).toBeUndefined();
  });

  it('does not fetch when enabled is false', async function disabled() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, ventureId: 'venture-abc' }),
    } as Response);

    const { result } = renderHookWithProviders(() => useVenture({ enabled: false }));

    expect(appFetch).not.toHaveBeenCalled();
    expect(result.current.ventureId).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('logs once when fetch errors', async function logsError() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    const { result } = renderHookWithProviders(() => useVenture());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'use-venture.fetch-error',
      expect.objectContaining({ status: 403 }),
    );
  });

  describe('retry behavior', function retryBehavior() {
    function createRetryAwareClient() {
      return new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity } },
      });
    }

    it('does not retry on 4xx errors', async function noRetryOn4xx() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      const { result } = renderHookWithProviders(() => useVenture(), {
        queryClient: createRetryAwareClient(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 5xx errors with exponential backoff', async function retriesOn5xx() {
      vi.useFakeTimers();
      try {
        vi.mocked(appFetch).mockResolvedValue({
          ok: false,
          status: 500,
        } as Response);

        renderHookWithProviders(() => useVenture(), {
          queryClient: createRetryAwareClient(),
        });

        for (let i = 0; i < 3; i++) {
          await vi.advanceTimersByTimeAsync(30_000);
        }

        expect(appFetch).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries when response shape is invalid (success: false / missing ventureId)', async function retriesOnShape() {
      vi.useFakeTimers();
      try {
        vi.mocked(appFetch).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: false, error: 'nope' }),
        } as Response);

        renderHookWithProviders(() => useVenture(), {
          queryClient: createRetryAwareClient(),
        });

        for (let i = 0; i < 3; i++) {
          await vi.advanceTimersByTimeAsync(30_000);
        }

        expect(appFetch).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
