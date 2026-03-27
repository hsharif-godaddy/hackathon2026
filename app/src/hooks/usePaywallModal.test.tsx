import React from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

import { usePaywallModal } from './usePaywallModal';

// Mock dependencies
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector) => {
    const state = {
      isPollingEntitlements: false,
      setIsPollingEntitlements: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector) => {
    const state = {
      getSite: vi.fn(() => ({ name: 'Test Site' })),
    };
    return selector ? selector(state) : state;
  }),
}));
vi.mock('./useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true })),
}));
vi.mock('./usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({
    showPaywall: false,
    isLoading: false,
    isError: false,
    error: null,
  })),
}));
vi.mock('@/services/EntitlementPollingService', () => ({
  entitlementPollingService: {
    pollForAccountEntitlements: vi.fn(() =>
      Promise.resolve({
        success: true,
        data: {
          subscriptionId: 'sub-123',
          entitlementId: 'ent-456',
        },
      })
    ),
  },
}));
vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn(() => Promise.resolve()),
}));

describe('usePaywallModal', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  describe('Loading state', () => {
    it('should expose isPaywallLoading from usePaywallEligibility', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: false,
        isLoading: true, // Set loading to true
        isError: false,
        error: null,
      });

      const { result } = renderHook(
        () =>
          usePaywallModal({
            appId: 'app-123',
            source: 'test',
          }),
        { wrapper }
      );

      expect(result.current.isPaywallLoading).toBe(true);
    });

    it('should return false for isPaywallLoading when not loading', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: false,
        isLoading: false, // Not loading
        isError: false,
        error: null,
      });

      const { result } = renderHook(
        () =>
          usePaywallModal({
            appId: 'app-123',
            source: 'test',
          }),
        { wrapper }
      );

      expect(result.current.isPaywallLoading).toBe(false);
    });
  });

  describe('Return values', () => {
    it('should return all expected properties', async () => {
      const { result } = renderHook(
        () =>
          usePaywallModal({
            appId: 'app-123',
            source: 'test',
          }),
        { wrapper }
      );

      expect(result.current).toHaveProperty('checkAndShowPaywall');
      expect(result.current).toHaveProperty('PaywallModal');
      expect(result.current).toHaveProperty('isPolling');
      expect(result.current).toHaveProperty('shouldShowPaywall');
      expect(result.current).toHaveProperty('isPaywallLoading');

      expect(typeof result.current.checkAndShowPaywall).toBe('function');
      expect(typeof result.current.PaywallModal).toBe('function');
      expect(typeof result.current.isPolling).toBe('boolean');
      expect(typeof result.current.shouldShowPaywall).toBe('boolean');
      expect(typeof result.current.isPaywallLoading).toBe('boolean');
    });
  });

  describe('Integration with usePaywallEligibility', () => {
    it('should pass appId to usePaywallEligibility', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      const spy = vi.mocked(mockUsePaywallEligibility.usePaywallEligibility);

      renderHook(
        () =>
          usePaywallModal({
            appId: 'app-456',
            source: 'test',
          }),
        { wrapper }
      );

      expect(spy).toHaveBeenCalledWith('app-456');
    });

    it('should work without appId', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      const spy = vi.mocked(mockUsePaywallEligibility.usePaywallEligibility);

      renderHook(
        () =>
          usePaywallModal({
            source: 'test',
          }),
        { wrapper }
      );

      expect(spy).toHaveBeenCalledWith(undefined);
    });
  });
});
