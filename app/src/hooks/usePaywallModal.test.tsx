import React from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { shipAnalyticsLog } from '@/lib/logging';
import { SubscriptionPlan } from '@/types/credits';
import { usePaywallModal } from './usePaywallModal';
import { usePublishLimitCheck } from './usePublishLimitCheck';

// Stable mock references to avoid destabilizing useMemo dependencies
const mockOpenUpgradeModal = vi.fn();
const mockGetSite = vi.fn(function (): { name?: string; sharedWithMe?: boolean } | null { return { name: 'Test Site' }; });
const mockConfirmCanPublish = vi.fn();

// Mock dependencies
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));
vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: vi.fn(function (selector) {
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
vi.mock('./usePublishLimitCheck', () => ({
  usePublishLimitCheck: vi.fn(function () {
    return {
      canPublish: true,
      currentCount: 0,
      limit: null,
      plan: undefined,
      publishedApps: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      confirmCanPublish: mockConfirmCanPublish,
    };
  }),
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

  describe('Owner-pays bypass for shared apps', () => {
    it('runs the action and shows no paywall for a shared app even when showPaywall is true', async () => {
      // Invited collaborator: app is shared, caller has no/own subscription so
      // usePaywallEligibility would normally gate them.
      mockGetSite.mockReturnValue({ name: 'Shared Site', sharedWithMe: true });
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: true,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result } = renderHook(
        () => usePaywallModal({ appId: 'app-shared', source: 'publish' }),
        { wrapper }
      );

      const action = vi.fn(async () => {});
      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(result.current.paywallModal).toBeNull();
      expect(result.current.shouldShowPaywall).toBe(false);
    });

    it('still gates a non-shared app (control)', async () => {
      mockGetSite.mockReturnValue({ name: 'Owned Site' }); // no sharedWithMe
      const mockUsePaywallEligibility = await import('./usePaywallEligibility');
      vi.mocked(mockUsePaywallEligibility.usePaywallEligibility).mockReturnValue({
        showPaywall: true,
        isLoading: false,
        isError: false,
        error: null,
      });

      const { result } = renderHook(
        () => usePaywallModal({ appId: 'app-owned', source: 'download' }),
        { wrapper }
      );

      const action = vi.fn(async () => {});
      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      // Paywall engaged: action is NOT executed and the modal renders.
      expect(action).not.toHaveBeenCalled();
      expect(result.current.paywallModal).not.toBeNull();
      expect(result.current.shouldShowPaywall).toBe(true);
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

  describe('Publish path confirms fresh data before paywalling', () => {
    // Cached publish-limit state that denies (e.g. cold-load 403→null left the
    // subscription cache empty). The decision is then re-confirmed against fresh data.
    const cachedDeny = {
      canPublish: false,
      currentCount: 0,
      limit: 0,
      plan: undefined,
      publishedApps: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      confirmCanPublish: mockConfirmCanPublish,
    };

    const renderPublish = () =>
      renderHook(
        () => usePaywallModal({ appId: 'app-123', source: 'publish' }),
        { wrapper }
      );

    it('executes the action without paywall when fresh data confirms a paid plan with capacity', async () => {
      vi.mocked(usePublishLimitCheck).mockReturnValue(cachedDeny);
      mockConfirmCanPublish.mockResolvedValue({
        canPublish: true,
        hasPaidPlan: true,
        currentCount: 1,
        limit: 50,
        plan: SubscriptionPlan.Ultimate,
        publishedApps: [],
        isError: false,
      });

      const { result } = renderPublish();
      const action = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(mockConfirmCanPublish).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledTimes(1);
      expect(result.current.paywallModal).toBeNull();
    });

    it('shows the upgrade paywall when fresh data still has no paid plan', async () => {
      vi.mocked(usePublishLimitCheck).mockReturnValue(cachedDeny);
      mockConfirmCanPublish.mockResolvedValue({
        canPublish: false,
        hasPaidPlan: false,
        currentCount: 0,
        limit: 0,
        plan: undefined,
        publishedApps: [],
        isError: false,
      });

      const { result } = renderPublish();
      const action = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(action).not.toHaveBeenCalled();
      expect(result.current.paywallModal).not.toBeNull();
      expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
        'builder.paywall.shown',
        expect.objectContaining({ source: 'publish' })
      );
    });

    it('fails open (runs the action, no paywall) when the forced refetch errored with no paid signal', async () => {
      vi.mocked(usePublishLimitCheck).mockReturnValue(cachedDeny);
      // Cold cache + transient fetch error: no positive paid signal, but the deny
      // is unconfirmed, so we must not false-paywall a (possibly paid) user.
      mockConfirmCanPublish.mockResolvedValue({
        canPublish: false,
        hasPaidPlan: false,
        currentCount: 0,
        limit: 0,
        plan: undefined,
        publishedApps: [],
        isError: true,
      });

      const { result } = renderPublish();
      const action = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(result.current.paywallModal).toBeNull();
      expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
        'builder.paywall.bypassed',
        expect.objectContaining({ source: 'publish', reason: 'confirm_error' })
      );
      expect(vi.mocked(shipAnalyticsLog)).not.toHaveBeenCalledWith(
        'builder.paywall.shown',
        expect.anything()
      );
    });

    it('shows the publish-limit modal when fresh data confirms a paid plan at the limit', async () => {
      vi.mocked(usePublishLimitCheck).mockReturnValue(cachedDeny);
      mockConfirmCanPublish.mockResolvedValue({
        canPublish: false,
        hasPaidPlan: true,
        currentCount: 1,
        limit: 1,
        plan: SubscriptionPlan.Starter,
        publishedApps: [],
        isError: false,
      });

      const { result } = renderPublish();
      const action = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(action).not.toHaveBeenCalled();
      expect(result.current.paywallModal).not.toBeNull();
      expect(vi.mocked(shipAnalyticsLog)).toHaveBeenCalledWith(
        'publish.limit.modal.shown',
        expect.objectContaining({ limit: 1 })
      );
    });

    it('does not confirm or run the action while the publish limit is still loading', async () => {
      vi.mocked(usePublishLimitCheck).mockReturnValue({ ...cachedDeny, isLoading: true });

      const { result } = renderPublish();
      const action = vi.fn().mockResolvedValue(undefined);

      await act(async () => {
        await result.current.checkAndShowPaywall(action);
      });

      expect(mockConfirmCanPublish).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(result.current.paywallModal).toBeNull();
    });
  });
});
