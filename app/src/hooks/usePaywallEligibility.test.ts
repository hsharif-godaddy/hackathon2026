import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('./useSubscription', () => ({
  useSubscription: vi.fn(),
}));

import { usePaywallEligibility } from './usePaywallEligibility';
import { useSubscription } from './useSubscription';

describe('usePaywallEligibility', function hook() {
  beforeEach(function setup() {
    vi.clearAllMocks();

    vi.mocked(useSubscription).mockReturnValue({
      data: { id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' },
      subscriptions: [{ id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
  });

  describe('Account-level subscription checks', function accountLevel() {
    it('should show paywall for active AiroPlus plan', function airoPlus() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'active' },
        subscriptions: [{ id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
    });

    it('should not show paywall for active Starter plan', function starter() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-starter', plan: SubscriptionPlan.Starter, status: 'active' },
        subscriptions: [{ id: 'sub-starter', plan: SubscriptionPlan.Starter, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(false);
    });

    it('should show paywall for inactive AiroPlus plan', function inactiveAiroPlus() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'cancelled' },
        subscriptions: [{ id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'cancelled' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
    });

    it('should show paywall for Free plan', function freePlan() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' },
        subscriptions: [{ id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
    });

    it('should handle undefined subscription for brand new accounts (AIROBUILD-720)', function newAccount() {
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);
    });
  });

  describe('Loading states', function loadingStates() {
    it('should show loading when subscription is loading', function subscriptionLoading() {
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Error handling', function errorHandling() {
    it('should show paywall when subscription has error', function subscriptionError() {
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: false,
        isError: true,
        error: new Error('Subscription fetch failed'),
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
      expect(result.current.isError).toBe(true);
    });
  });
});
