import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';

// Mock dependencies
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('./usePaywallFeatureFlags', () => ({
  usePaywallFeatureFlags: vi.fn(),
}));

vi.mock('./useSubscription', () => ({
  useSubscription: vi.fn(),
}));

vi.mock('./useEntitlements', () => ({
  useEntitlements: vi.fn(),
}));

vi.mock('./useProjects', () => ({
  useProjects: vi.fn(),
}));

vi.mock('./useUpdateEntitlement', () => ({
  useUpdateEntitlement: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));

vi.mock('./useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}));

import { useEntitlements } from './useEntitlements';
import { usePaywallEligibility } from './usePaywallEligibility';
import { usePaywallFeatureFlags } from './usePaywallFeatureFlags';
import { useProjects } from './useProjects';
import { useSubscription } from './useSubscription';
import { useSwitchboard } from './useSwitchboard';

describe('usePaywallEligibility', function hook() {
  beforeEach(function setup() {
    vi.clearAllMocks();

    // Default mock for grants flag - disabled (legacy behavior for most tests)
    vi.mocked(useSwitchboard).mockReturnValue({
      data: false,
      isLoading: false,
      isError: false,
    } as any);

    // Default mocks - paywall enabled, free plan, no entitlements, no projects
    vi.mocked(usePaywallFeatureFlags).mockReturnValue({
      data: { paywall: true, markets: true },
      isLoading: false,
      isError: false,
    });

    vi.mocked(useSubscription).mockReturnValue({
      data: { id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' },
      subscriptions: [{ id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    vi.mocked(useEntitlements).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    } as any);

    vi.mocked(useProjects).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
  });

  describe('Account-level subscription checks', function accountLevel() {
    it('should not show paywall when feature flags are disabled', function flagsDisabled() {
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: { paywall: false, markets: false },
        isLoading: false,
        isError: false,
      });

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it('should not show paywall for active AiroPlus plan', function airoPlus() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'active' },
        subscriptions: [{ id: 'sub-plus', plan: SubscriptionPlan.AiroPlus, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(false);
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

    it('should show paywall for Free plan without entitlements', function freePlan() {
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
      // Explicitly set paywall enabled to test the exact bug scenario:
      // paywallEnabled (true) && subscription (undefined) && !hasPaidPlan
      // Without !! coercion, this evaluates to undefined instead of false
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: { paywall: true, markets: true }, // Explicitly true
        isLoading: false,
        isError: false,
      });

      // Simulate a brand new GoDaddy account with no mgmt-airo subscription yet
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined, // No subscription exists yet
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      // This test verifies that the hook doesn't crash with React Query error:
      // "Expected enabled to be a boolean or a callback that returns a boolean"
      // The bug occurred because: true && undefined && true → undefined (not false)
      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      // Should show paywall (no subscription = no access) without crashing
      expect(result.current.showPaywall).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isError).toBe(false);

      // Verify that useEntitlements and useProjects were called with enabled: false (not undefined)
      // This is the critical check - React Query requires boolean, not undefined
      expect(useEntitlements).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false, // Must be boolean, not undefined
        })
      );
      expect(useProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false, // Must be boolean, not undefined
        })
      );
    });
  });

  describe('Paywall display logic', function displayLogic() {
    it('should not show paywall when user has entitlements', function hasEntitlements() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' },
        subscriptions: [{ id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      vi.mocked(useEntitlements).mockReturnValue({
        data: 'ent-123',
        isLoading: false,
        isError: false,
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(false);
    });

    it('should not show paywall when user has matching Airo Plus project', function matchingProject() {
      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' },
        subscriptions: [{ id: 'sub-free', plan: SubscriptionPlan.Free, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      vi.mocked(useProjects).mockReturnValue({
        data: [
          {
            node: {
              group: 'aigeneratedmedia',
              status: 'ACTIVE',
              billing: {
                id: 'billing-123',
                plan: 'logoImage',
              },
            },
          },
        ],
        isLoading: false,
        isError: false,
      } as any);

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(false);
    });
  });

  describe('Loading states', function loadingStates() {
    it('should show loading when feature flags are loading', function flagsLoading() {
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.isLoading).toBe(true);
    });

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
    it('should show paywall when feature flags have error', function flagsError() {
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      const { result } = renderHookWithProviders(() => usePaywallEligibility());

      expect(result.current.showPaywall).toBe(true);
      expect(result.current.isError).toBe(true);
    });

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

  describe('React Query boolean type safety (regression tests)', function regressionTests() {
    it('should pass boolean to enabled when feature flags are undefined', function flagsUndefined() {
      // Regression test: Previously, paywallEnabled would be undefined when featureFlags was undefined,
      // causing needsAdditionalChecks to be undefined, which React Query rejects
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' },
        subscriptions: [{ id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      // Verify useEntitlements and useProjects are called with boolean enabled
      renderHookWithProviders(() => usePaywallEligibility());

      // When featureFlags is undefined, paywallEnabled should be false (not undefined)
      // This means needsAdditionalChecks should be false, and queries should be disabled
      expect(useEntitlements).toHaveBeenCalledWith(expect.objectContaining({
        enabled: false,  // Should be boolean false, not undefined
      }));

      expect(useProjects).toHaveBeenCalledWith(expect.objectContaining({
        enabled: false,  // Should be boolean false, not undefined
      }));
    });

    it('should pass boolean to enabled when subscription is undefined', function subscriptionUndefined() {
      // Regression test: When subscription is undefined, needsAdditionalChecks should still be boolean
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: { paywall: true, markets: true },
        isLoading: false,
        isError: false,
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      renderHookWithProviders(() => usePaywallEligibility());

      // When subscription is undefined, needsAdditionalChecks should be false
      expect(useEntitlements).toHaveBeenCalledWith(expect.objectContaining({
        enabled: false,  // Should be boolean false, not undefined
      }));

      expect(useProjects).toHaveBeenCalledWith(expect.objectContaining({
        enabled: false,  // Should be boolean false, not undefined
      }));
    });

    it('should pass true to enabled when on free plan (actual conditional checks needed)', function freePlan() {
      // Verify that when all conditions are met, enabled is true (boolean), not a truthy object
      vi.mocked(usePaywallFeatureFlags).mockReturnValue({
        data: { paywall: true, markets: true },
        isLoading: false,
        isError: false,
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: { id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' },
        subscriptions: [{ id: 'sub-123', plan: SubscriptionPlan.Free, status: 'active' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      renderHookWithProviders(() => usePaywallEligibility());

      // When on free plan with paywall enabled, additional checks are needed
      expect(useEntitlements).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,  // Should be boolean true
      }));

      expect(useProjects).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,  // Should be boolean true
      }));
    });
  });
});
