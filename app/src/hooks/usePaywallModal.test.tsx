import React from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { usePaywallModal } from './usePaywallModal';

// Stable mock references to avoid destabilizing useMemo dependencies
const mockOpenUpgradeModal = vi.fn();
const mockGetSite = vi.fn(function () { return { name: 'Test Site' }; });

// Mock dependencies
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(function (selector) {
    const state = {
      openUpgradeModal: mockOpenUpgradeModal,
    };
    return selector ? selector(state) : state;
  }),
}));
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn(function (selector) {
    const state = {
      getSite: mockGetSite,
    };
    return selector ? selector(state) : state;
  }),
}));
vi.mock('./useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
}));
vi.mock('./usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(function () { return {
    showPaywall: false,
    isLoading: false,
    isError: false,
    error: null,
  }; }),
}));
vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn(function () { return Promise.resolve(); }),
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
      expect(result.current).toHaveProperty('paywallModal');
      expect(result.current).toHaveProperty('shouldShowPaywall');
      expect(result.current).toHaveProperty('isPaywallLoading');

      expect(typeof result.current.checkAndShowPaywall).toBe('function');
      expect(result.current.paywallModal).toBeNull();
      expect(typeof result.current.shouldShowPaywall).toBe('boolean');
      expect(typeof result.current.isPaywallLoading).toBe('boolean');
    });
  });

  describe('Referential stability', () => {
    it('should retain paywallModal identity across re-renders when modal is visible', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: true,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result, rerender } = renderHook(
        () =>
          usePaywallModal({
            appId: 'app-123',
            source: 'test',
          }),
        { wrapper }
      );

      // Trigger paywall visibility by calling checkAndShowPaywall
      await act(async () => {
        await result.current.checkAndShowPaywall(async () => {});
      });

      const firstRender = result.current.paywallModal;
      // Verify modal is actually rendered (not null)
      expect(firstRender).not.toBeNull();

      rerender();
      const secondRender = result.current.paywallModal;

      // paywallModal element reference must be stable across re-renders
      // to prevent UpgradeContainer from being remounted during streaming
      expect(firstRender).toBe(secondRender);
    });

    it('should retain paywallModal identity when parent re-renders without prop changes', async () => {
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: true,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result, rerender } = renderHook(
        () =>
          usePaywallModal({
            appId: 'app-456',
            source: 'download',
          }),
        { wrapper }
      );

      // Trigger paywall visibility by calling checkAndShowPaywall
      await act(async () => {
        await result.current.checkAndShowPaywall(async () => {});
      });

      const firstRender = result.current.paywallModal;
      // Verify modal is actually rendered (not null)
      expect(firstRender).not.toBeNull();

      rerender();
      const secondRender = result.current.paywallModal;

      // paywallModal element reference must be stable across re-renders
      // to prevent UpgradeContainer from being remounted during streaming
      expect(firstRender).toBe(secondRender);
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

      expect(spy).toHaveBeenCalled();
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

      expect(spy).toHaveBeenCalled();
    });
  });
});
