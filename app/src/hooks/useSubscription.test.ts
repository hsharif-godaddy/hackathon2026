import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import { useSubscription } from './useSubscription';

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';

describe('useSubscription', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
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
        expect(appFetch).toHaveBeenCalledWith('/api/subscriptions', { credentials: 'include' });
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
  });
});
