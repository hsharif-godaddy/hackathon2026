import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { usePaywallPrefetch } from './usePaywallPrefetch';
import { prefetchProjects } from './useProjects';
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

vi.mock('./useProjects', () => ({
  prefetchProjects: vi.fn(),
  useProjects: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
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
    it('prefetches feature flags, subscription, and projects', async function prefetchAll() {
      renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        // Verify feature flags were prefetched
        expect(prefetchSwitchboard).toHaveBeenCalledWith(queryClient, 'appbuilder-airoplus-paywall');
        expect(prefetchSwitchboard).toHaveBeenCalledWith(queryClient, 'appbuilder-paywall-markets');
        expect(prefetchSwitchboard).toHaveBeenCalledWith(queryClient, 'app-builder-grants');

        // Verify subscription was prefetched
        expect(prefetchSubscription).toHaveBeenCalledWith(queryClient);

        // Verify projects were prefetched (only when grants is disabled)
        expect(prefetchProjects).toHaveBeenCalledWith(queryClient);
      });
    });

    it('only runs prefetch once per mount', async function runOnce() {
      const { rerender } = renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        expect(prefetchSwitchboard).toHaveBeenCalledTimes(3); // Three flags: paywall, markets, grants
      });

      const initialCallCount = vi.mocked(prefetchSwitchboard).mock.calls.length;

      // Rerender should not trigger additional prefetch (useEffect with stable deps)
      rerender();
      rerender();

      expect(vi.mocked(prefetchSwitchboard).mock.calls.length).toBe(initialCallCount);
    });

    it('prefetches all data in parallel', async function parallel() {
      renderHook(() => usePaywallPrefetch(), { wrapper });

      await waitFor(() => {
        // All prefetches should be called (they run in parallel within the effect)
        expect(prefetchSwitchboard).toHaveBeenCalled();
        expect(prefetchSubscription).toHaveBeenCalled();
        expect(prefetchProjects).toHaveBeenCalled();
      });
    });
  });
});
