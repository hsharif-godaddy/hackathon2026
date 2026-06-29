import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import { prefetchSubscription, SUBSCRIPTIONS_QUERY_KEY, useSubscription } from './useSubscription';

// Mock appFetch. The auth error classes must be real constructors — the hook's
// retry predicate does `error instanceof AuthDismissedError`, which throws if
// the mock leaves them undefined.
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  AuthDismissedError: class AuthDismissedError extends Error {},
}));

import { appFetch, AuthDismissedError } from '@/lib/gasket-config';

// The handle401 path is gated by the appbuilder-subscriptions-handle401 flag.
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}));

import { useSwitchboard } from '@/hooks/useSwitchboard';

describe('useSubscription', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    // Default the gate ON so the existing handle401:true assertions hold; the
    // off-case test overrides this per-test.
    vi.mocked(useSwitchboard).mockReturnValue(true);
  });

  describe('#useSubscription', function main() {
    it('returns subscription data when API succeeds', async function success() {
      const mockSubscription = {
        id: 'sub-123',
        plan: SubscriptionPlan.AiroPlus,
        productId: 'AiroPlusAppBuilderProduct',
        isTrial: false,
      };

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [mockSubscription],
            active: mockSubscription
          }
        }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSubscription);
      expect(result.current.subscriptions).toEqual([mockSubscription]);
    });

    it('returns undefined and sets error when API returns not ok', async function notOk() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeUndefined();
      expect(result.current.isError).toBe(true);
    });

    it('returns undefined when subscription is missing from response', async function missing() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [],
            active: null
          }
        }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeUndefined();
      expect(result.current.subscriptions).toEqual([]);
    });

    it('calls API with correct endpoint and credentials', async function endpoint() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [{ id: 'sub-123' }],
            active: { id: 'sub-123' }
          }
        }),
      } as Response);

      renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/subscriptions',
          { credentials: 'include' },
          { handle401: true },
        );
      });
    });

    it('passes handle401:false when the switchboard flag is off', async function flagOff() {
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [{ id: 'sub-123' }],
            active: { id: 'sub-123' }
          }
        }),
      } as Response);

      renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/subscriptions',
          { credentials: 'include' },
          { handle401: false },
        );
      });
    });

    it('handles free plan subscription', async function freePlan() {
      const mockSubscription = {
        id: 'sub-456',
        plan: SubscriptionPlan.Free,
        productId: 'FreeAppBuilderProduct',
        isTrial: true,
      };

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [mockSubscription],
            active: mockSubscription
          }
        }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data?.plan).toBe(SubscriptionPlan.Free);
      expect(result.current.data?.isTrial).toBe(true);
      expect(result.current.subscriptions).toEqual([mockSubscription]);
    });
  });

  describe('retry behavior', function retryBehavior() {
    // Use a QueryClient without global retry:false so the hook's own retry config is exercised
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

      const { result } = renderHookWithProviders(() => useSubscription(), {
        queryClient: createRetryAwareClient(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 5xx errors', async function retriesOn5xx() {
      vi.useFakeTimers();
      try {
        vi.mocked(appFetch).mockResolvedValue({
          ok: false,
          status: 500,
        } as Response);

        renderHookWithProviders(() => useSubscription(), {
          queryClient: createRetryAwareClient(),
        });

        // Flush initial call + all retries (exponential backoff: 1s, 2s, 4s)
        for (let i = 0; i < 3; i++) {
          await vi.advanceTimersByTimeAsync(30_000);
        }

        // Initial call + up to 3 retries
        expect(appFetch).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry when the SSO prompt is dismissed', async function noRetryOnDismiss() {
      vi.mocked(appFetch).mockRejectedValue(new AuthDismissedError());

      const { result } = renderHookWithProviders(() => useSubscription(), {
        queryClient: createRetryAwareClient(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('stops the refetchInterval poll once the SSO prompt is dismissed', async function noPollAfterDismiss() {
      vi.useFakeTimers();
      try {
        // retry and refetchInterval are independent: a dismissed prompt must stop
        // the 5s poll too, or it would re-open the SSO modal on every tick.
        vi.mocked(appFetch).mockRejectedValue(new AuthDismissedError());

        renderHookWithProviders(() => useSubscription({ refetchInterval: 50 }), {
          queryClient: createRetryAwareClient(),
        });

        // Initial fetch settles in error (no retry), then 10 interval ticks elapse.
        await vi.advanceTimersByTimeAsync(500);

        // Guarded: the poll did not re-fire after the dismiss.
        expect(appFetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('switchboard flag edge cases', function flagEdgeCases() {
    it('passes handle401:false when useSwitchboard returns undefined', async function flagUndefined() {
      vi.mocked(useSwitchboard).mockReturnValue(undefined as unknown as boolean);
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            subscriptions: [{ id: 'sub-123' }],
            active: { id: 'sub-123' }
          }
        }),
      } as Response);

      renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/subscriptions',
          { credentials: 'include' },
          { handle401: false },
        );
      });
    });
  });

  describe('prefetchSubscription', function prefetch() {
    it('calls appFetch with handle401:false', async function prefetchHandle401() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { subscriptions: [], active: null }
        }),
      } as Response);

      const queryClient: QueryClient = new QueryClient();
      await prefetchSubscription(queryClient);

      expect(appFetch).toHaveBeenCalledWith(
        '/api/subscriptions',
        { credentials: 'include' },
        { handle401: false },
      );

      const cached = queryClient.getQueryData(SUBSCRIPTIONS_QUERY_KEY);
      expect(cached).toEqual({ subscriptions: [], active: null });
    });
  });
});
