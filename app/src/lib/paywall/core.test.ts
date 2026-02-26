import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import { checkPaywallEligibility, PaywallAction } from './core';
import type { PaywallDataProvider } from './providers';
import { PaywallDenialReason } from './shared';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('checkPaywallEligibility', () => {
  let mockProvider: Mocked<PaywallDataProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      getRootDomain: vi.fn(),
      checkSwitchboardFlags: vi.fn(),
      getAccountSubscription: vi.fn(),
      getSubscription: vi.fn(),
      getEntitlements: vi.fn(),
      getProjects: vi.fn(),
      isGrantsEnabled: vi.fn().mockResolvedValue(false), // Default to legacy behavior
      getPublishedApps: vi.fn().mockResolvedValue({ count: 0, publishedAppIds: [] }),
    } as any;
  });

  describe('Account-level subscription checks', () => {
    it('should grant access for airoPlus plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-123',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-123');
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled(); // Should not check entitlements for paid plans
    });

    it('should grant access for starter plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-starter');
    });

    it('should deny access for free plan (legacy - grants disabled)', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });
      mockProvider.getEntitlements.mockResolvedValue(undefined);
      mockProvider.getProjects.mockResolvedValue([]);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Airo Plus subscription required');
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-free');
    });

    it('should deny access for none plan (legacy - grants disabled)', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-none',
        plan: SubscriptionPlan.None,
        status: 'active',
      });
      mockProvider.getEntitlements.mockResolvedValue(undefined);
      mockProvider.getProjects.mockResolvedValue([]);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Airo Plus subscription required');
    });

    it('should pass appId for logging when provided', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-123',
        plan: SubscriptionPlan.AiroPlus,
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-456');

      expect(result.hasAccess).toBe(true);
      // AppId should be used for logging but not affect the logic
      expect(mockProvider.getAccountSubscription).toHaveBeenCalled();
    });
  });

  describe('Legacy entitlement checks for free plans (grants disabled)', () => {
    it('should check entitlements for free plan and grant access if found', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });
      mockProvider.getEntitlements.mockResolvedValue('ent-123');

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasEntitlements).toBe(true);
      expect(result.details.entitlementId).toBe('ent-123');
      expect(mockProvider.getEntitlements).toHaveBeenCalledWith('sub-free');
    });

    it('should check matching project as fallback for free plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });
      mockProvider.getEntitlements.mockResolvedValue(undefined);
      mockProvider.getProjects.mockResolvedValue([
        {
          node: {
            group: 'aigeneratedmedia',
            status: 'ACTIVE',
            billing: {
              id: 'billing-456',
              plan: 'logoImage',
            },
          },
        },
      ]);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasMatchingProject).toBe(true);
      expect(result.details.billingId).toBe('billing-456');
    });
  });

  describe('Grants enabled behavior (app-builder-grants ON)', () => {
    it('should deny access for free plan without checking entitlements/projects', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });

    it('should deny access for none plan without checking entitlements/projects', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-none',
        plan: SubscriptionPlan.None,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });

    it('should grant access for Starter plan when grants enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
      // Grants flag is checked to determine which plans are paid
      expect(mockProvider.isGrantsEnabled).toHaveBeenCalled();
      // Should not check entitlements or projects for paid plans
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });

    it('should deny access for AiroPlus plan when grants enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-airoplus',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      // When grants is ON, AiroPlus is NOT a paid plan
      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });
  });

  describe('Switchboard flag checks', () => {
    it('should allow access when paywall is disabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: false,
        markets: true,
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('Paywall not enabled');
      expect(mockProvider.getAccountSubscription).not.toHaveBeenCalled();
    });

    it('should allow access when markets flag is disabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: false,
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('Paywall not enabled');
    });

    it('should fail closed when switchboard check fails', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockRejectedValue(
        new Error('Network error')
      );

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe(
        'Unable to verify subscription status (switchboard check failed)'
      );
    });

    it('should fail closed when no root domain available', async () => {
      mockProvider.getRootDomain.mockReturnValue(null);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe(
        'Unable to verify subscription status (no root domain)'
      );
    });
  });

  describe('No subscription scenarios', () => {
    it('should deny access when no subscription found', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.getAccountSubscription.mockResolvedValue(undefined);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('No active subscription found');
      expect(result.details.hasSubscription).toBe(false);
    });
  });

  describe('Error handling (legacy - grants disabled)', () => {
    it('should continue to entitlement check if error fetching subscription details', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });
      mockProvider.getEntitlements.mockRejectedValue(new Error('API error'));
      mockProvider.getProjects.mockResolvedValue([]);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.hasEntitlements).toBe(false);
    });

    it('should continue to denial if projects check fails', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });
      mockProvider.getEntitlements.mockResolvedValue(undefined);
      mockProvider.getProjects.mockRejectedValue(new Error('API error'));

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.details.hasMatchingProject).toBe(false);
    });

    it('should fail closed on unexpected errors', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.getAccountSubscription.mockRejectedValue(
        new Error('Unexpected error')
      );

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Unable to verify subscription status');
    });
  });

  describe('Complete flow integration', () => {
    it('should check all steps in order for free plan (legacy - grants disabled)', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });
      mockProvider.getEntitlements.mockResolvedValue(undefined);
      mockProvider.getProjects.mockResolvedValue([]);

      await checkPaywallEligibility(mockProvider);

      // Verify call order
      expect(mockProvider.getRootDomain).toHaveBeenCalledBefore(
        mockProvider.checkSwitchboardFlags as any
      );
      expect(mockProvider.checkSwitchboardFlags).toHaveBeenCalledBefore(
        mockProvider.getAccountSubscription as any
      );
      expect(mockProvider.getAccountSubscription).toHaveBeenCalledBefore(
        mockProvider.isGrantsEnabled as any
      );
      expect(mockProvider.isGrantsEnabled).toHaveBeenCalledBefore(
        mockProvider.getEntitlements as any
      );
    });

    it('should skip entitlement checks for paid plans (legacy - grants disabled)', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-plus',
        plan: SubscriptionPlan.AiroPlus,
      });

      await checkPaywallEligibility(mockProvider);

      // With grants disabled, AiroPlus is a paid plan - skip entitlements/projects
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });

    it('should skip entitlement/project checks for free plan when grants enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(mockProvider.isGrantsEnabled).toHaveBeenCalled();
      expect(mockProvider.getEntitlements).not.toHaveBeenCalled();
      expect(mockProvider.getProjects).not.toHaveBeenCalled();
    });
  });

  describe('Professional and Ultimate plans (grants enabled)', () => {
    it('should grant access for Professional plan when grants enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-professional',
        plan: SubscriptionPlan.Professional,
        status: 'active',
      });
      mockProvider.getPublishedApps.mockResolvedValue({
        count: 0,
        publishedAppIds: [],
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
    });

    it('should grant access for Ultimate plan when grants enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-ultimate',
        plan: SubscriptionPlan.Ultimate,
        status: 'active',
      });
      mockProvider.getPublishedApps.mockResolvedValue({
        count: 0,
        publishedAppIds: [],
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
    });
  });

  describe('Publish limits (grants enabled, bypassPublishLimit OFF)', () => {
    beforeEach(() => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
    });

    describe('Starter plan (limit: 1 app)', () => {
      it('should allow publish when under limit (0 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 0,
          publishedAppIds: [],
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should deny publish when at limit (1 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 1,
          publishedAppIds: ['app-existing'],
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(1);
        expect(result.details.publishedCount).toBe(1);
      });

      it('should allow re-publish of existing app even at limit', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 1,
          publishedAppIds: ['app-existing'],
        });

        // Re-publishing the same app that's already published
        const result = await checkPaywallEligibility(mockProvider, 'app-existing', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });
    });

    describe('Professional plan (limit: 3 apps)', () => {
      it('should allow publish when under limit (2 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-professional',
          plan: SubscriptionPlan.Professional,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 2,
          publishedAppIds: ['app-1', 'app-2'],
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should deny publish when at limit (3 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-professional',
          plan: SubscriptionPlan.Professional,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 3,
          publishedAppIds: ['app-1', 'app-2', 'app-3'],
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(3);
        expect(result.details.publishedCount).toBe(3);
      });
    });

    describe('Ultimate plan (limit: 10 apps)', () => {
      it('should allow publish when under limit (9 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-ultimate',
          plan: SubscriptionPlan.Ultimate,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 9,
          publishedAppIds: Array.from({ length: 9 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should deny publish when at limit (10 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-ultimate',
          plan: SubscriptionPlan.Ultimate,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 10,
          publishedAppIds: Array.from({ length: 10 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(10);
        expect(result.details.publishedCount).toBe(10);
      });
    });

    describe('Legacy AiroPlus users (Starter + entitlementId, limit: 9 apps)', () => {
      it('should allow publish for legacy AiroPlus user under limit', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          entitlementId: 'ent-legacy-airoplus', // Legacy AiroPlus entitlement
          builderEntitlementId: 'ent-builder',
        });
        // User has 5 apps published (under AiroPlus limit of 9)
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 5,
          publishedAppIds: Array.from({ length: 5 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
        expect(mockProvider.getPublishedApps).toHaveBeenCalled();
      });

      it('should use AiroPlus limit (9) instead of Starter limit (1) for legacy users', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          entitlementId: 'ent-legacy-airoplus', // Has entitlementId = legacy AiroPlus
          builderEntitlementId: 'ent-builder',
        });
        // User has 8 apps published - would be denied with Starter limit (1), allowed with AiroPlus limit (9)
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 8,
          publishedAppIds: Array.from({ length: 8 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true); // Uses AiroPlus limit (9), not Starter (1)
      });

      it('should deny publish for legacy AiroPlus user at limit (9 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          entitlementId: 'ent-legacy-airoplus',
          builderEntitlementId: 'ent-builder',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 9,
          publishedAppIds: Array.from({ length: 9 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(9); // AiroPlus limit
        expect(result.details.publishedCount).toBe(9);
      });

      it('should allow re-publishing existing app for legacy AiroPlus user at limit', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          entitlementId: 'ent-legacy-airoplus',
          builderEntitlementId: 'ent-builder',
        });
        const publishedAppIds = Array.from({ length: 9 }, (_, i) => `app-${i}`);
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 9,
          publishedAppIds,
        });

        // Re-publishing an existing app
        const result = await checkPaywallEligibility(mockProvider, 'app-5', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should use Starter limit for Starter user WITHOUT entitlementId', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          // No entitlementId = new Starter user, not legacy AiroPlus
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 1,
          publishedAppIds: ['app-0'],
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(1); // Starter limit, not AiroPlus
      });

    });
  });

  describe('Bypass publish limit flag (bypassPublishLimit ON)', () => {
    it('should bypass publish limits when bypassPublishLimit flag is enabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
        bypassPublishLimit: true, // Bypass enabled
      });
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

      expect(result.hasAccess).toBe(true);
      // Should not check published apps when bypass is enabled
      expect(mockProvider.getPublishedApps).not.toHaveBeenCalled();
    });
  });

  describe('PaywallAction.Download (bypasses publish limits)', () => {
    beforeEach(() => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.isGrantsEnabled.mockResolvedValue(true);
    });

    it('should allow download for paid plan even at publish limit', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });
      // User is at publish limit
      mockProvider.getPublishedApps.mockResolvedValue({
        count: 1,
        publishedAppIds: ['app-1'],
      });

      // Download action should bypass publish limits
      const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Download);

      expect(result.hasAccess).toBe(true);
      // Should not check published apps for download
      expect(mockProvider.getPublishedApps).not.toHaveBeenCalled();
    });

    it('should deny download for free plan (still requires paid plan)', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-1', PaywallAction.Download);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should deny download for AiroPlus when grants enabled (not a paid plan)', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-airoplus',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-1', PaywallAction.Download);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should allow download for all new paid plans (Starter, Professional, Ultimate)', async () => {
      const paidPlans = [
        SubscriptionPlan.Starter,
        SubscriptionPlan.Professional,
        SubscriptionPlan.Ultimate,
      ];

      for (const plan of paidPlans) {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
          grants: true,
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: `sub-${plan}`,
          plan,
          status: 'active',
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-1', PaywallAction.Download);

        expect(result.hasAccess).toBe(true);
      }
    });
  });

  describe('Legacy behavior (grants disabled)', () => {
    beforeEach(() => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.isGrantsEnabled.mockResolvedValue(false);
    });

    it('should allow download for AiroPlus when grants disabled', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-airoplus',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-1', PaywallAction.Download);

      expect(result.hasAccess).toBe(true);
    });

    it('should allow publish for AiroPlus when grants disabled (no limit check)', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-airoplus',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

      expect(result.hasAccess).toBe(true);
      // Should not check published apps when grants is disabled
      expect(mockProvider.getPublishedApps).not.toHaveBeenCalled();
    });

    it('should use legacy entitlement fallback for free plan when grants disabled', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        grants: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });
      mockProvider.getEntitlements.mockResolvedValue('ent-123');

      const result = await checkPaywallEligibility(mockProvider, 'app-1');

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasEntitlements).toBe(true);
      expect(mockProvider.getEntitlements).toHaveBeenCalled();
    });
  });
});