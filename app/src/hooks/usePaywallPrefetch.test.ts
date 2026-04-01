import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { usePaywallPrefetch } from './usePaywallPrefetch';
import { prefetchSubscription } from './useSubscription';
import { prefetchSwitchboard } from './useSwitchboard';

// Mock the prefetch functions
vi.mock('./useSwitchboard', () => ({
  prefetchSwitchboard: vi.fn(),
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false, isError: false })),
}));

vi.mock('./useSubscription', () => ({
  prefetchSubscription: vi.fn(),
  useSubscription: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}));

describe('usePaywallPrefetch', function hooks() {
  let queryClient: QueryClient;

  beforeEach(function setup() {
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  describe('#usePaywallPrefetch', function main() {
    it('prefetches feature flags and subscription', async function prefetchAll() {
      renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        expect(prefetchSwitchboard).toHaveBeenCalledWith(queryClient, 'appbuilder-airoplus-paywall');
        expect(prefetchSwitchboard).toHaveBeenCalledWith(queryClient, 'appbuilder-paywall-markets');

        expect(prefetchSubscription).toHaveBeenCalledWith(queryClient);
      });
    });

    it('only runs prefetch once per mount', async function runOnce() {
      const { rerender } = renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        expect(prefetchSwitchboard).toHaveBeenCalledTimes(2);
      });

      const initialCallCount = vi.mocked(prefetchSwitchboard).mock.calls.length;

      rerender();
      rerender();

      expect(vi.mocked(prefetchSwitchboard).mock.calls.length).toBe(initialCallCount);
    });

    it('prefetches all data in parallel', async function parallel() {
      renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        expect(prefetchSwitchboard).toHaveBeenCalled();
        expect(prefetchSubscription).toHaveBeenCalled();
      });
    });
  });
});
