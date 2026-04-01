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
      getPublishedApps: vi.fn().mockResolvedValue({ count: 0, publishedAppIds: [] }),
    } as any;
  });

  describe('Account-level subscription checks', () => {
    it('should deny access for airoPlus plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-123',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should grant access for starter plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
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

    it('should deny access for free plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-free');
    });

    it('should deny access for none plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-none',
        plan: SubscriptionPlan.None,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should pass appId for logging when provided', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-123',
        plan: SubscriptionPlan.Starter,
      });

      const result = await checkPaywallEligibility(mockProvider, 'app-456');

      expect(result.hasAccess).toBe(true);
      expect(mockProvider.getAccountSubscription).toHaveBeenCalled();
    });
  });

  describe('Grants behavior', () => {
    it('should deny access for free plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should deny access for none plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-none',
        plan: SubscriptionPlan.None,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });

    it('should grant access for Starter plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
    });

    it('should deny access for AiroPlus plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-airoplus',
        plan: SubscriptionPlan.AiroPlus,
        status: 'active',
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });
  });

  describe('Switchboard flag checks', () => {
    it('should allow access when paywall is disabled', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: false,
        markets: true,
        bypassPublishLimit: false,
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
        bypassPublishLimit: false,
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
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue(undefined);

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('No active subscription found');
      expect(result.details.hasSubscription).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should fail closed on unexpected errors', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
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
    it('should check steps in order', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });

      await checkPaywallEligibility(mockProvider);

      expect(mockProvider.getRootDomain).toHaveBeenCalledBefore(
        mockProvider.checkSwitchboardFlags as any
      );
      expect(mockProvider.checkSwitchboardFlags).toHaveBeenCalledBefore(
        mockProvider.getAccountSubscription as any
      );
    });

    it('should deny free plan with subscription upgrade required', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-free',
        plan: SubscriptionPlan.Free,
      });

      const result = await checkPaywallEligibility(mockProvider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Subscription upgrade required');
    });
  });

  describe('Professional and Ultimate plans', () => {
    it('should grant access for Professional plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

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

    it('should grant access for Ultimate plan', async () => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });

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

    });

    describe('Starter plan (limit: 1 app)', () => {
      it('should allow publish when under limit (0 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
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

    describe('Professional plan (limit: 10 apps)', () => {
      it('should allow publish when under limit (9 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-professional',
          plan: SubscriptionPlan.Professional,
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
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-professional',
          plan: SubscriptionPlan.Professional,
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

    describe('Ultimate plan (limit: 50 apps)', () => {
      it('should allow publish when under limit (49 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-ultimate',
          plan: SubscriptionPlan.Ultimate,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 49,
          publishedAppIds: Array.from({ length: 49 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should deny publish when at limit (50 published)', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-ultimate',
          plan: SubscriptionPlan.Ultimate,
          status: 'active',
        });
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 50,
          publishedAppIds: Array.from({ length: 50 }, (_, i) => `app-${i}`),
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe(PaywallDenialReason.PublishLimitReached);
        expect(result.details.publishLimit).toBe(50);
        expect(result.details.publishedCount).toBe(50);
      });
    });

    describe('Legacy AiroPlus users (Starter + hadAiroPlus, limit: 9 apps)', () => {
      it('should allow publish for legacy AiroPlus user under limit', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          hadAiroPlus: true,
          builderEntitlementId: 'ent-builder',
        });
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
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          hadAiroPlus: true,
          builderEntitlementId: 'ent-builder',
        });
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
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          hadAiroPlus: true,
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
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
          hadAiroPlus: true,
          builderEntitlementId: 'ent-builder',
        });
        const publishedAppIds = Array.from({ length: 9 }, (_, i) => `app-${i}`);
        mockProvider.getPublishedApps.mockResolvedValue({
          count: 9,
          publishedAppIds,
        });

        const result = await checkPaywallEligibility(mockProvider, 'app-5', PaywallAction.Publish);

        expect(result.hasAccess).toBe(true);
      });

      it('should use Starter limit for Starter user WITHOUT hadAiroPlus', async () => {
        mockProvider.checkSwitchboardFlags.mockResolvedValue({
          paywall: true,
          markets: true,
  
          bypassPublishLimit: false,
        });
        mockProvider.getAccountSubscription.mockResolvedValue({
          id: 'sub-starter',
          plan: SubscriptionPlan.Starter,
          status: 'active',
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
        bypassPublishLimit: true, // Bypass enabled
      });

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

  describe('getPublishedApps error handling (fail-closed)', () => {
    beforeEach(() => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');

    });

    it('should fail closed with specific message when getPublishedApps throws an error', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });
      mockProvider.getPublishedApps.mockRejectedValue(new Error('Failed to fetch published apps: 500'));

      const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Unable to verify publish limit');
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-starter');
    });

    it('should fail closed with specific message when getPublishedApps throws a network error', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-professional',
        plan: SubscriptionPlan.Professional,
        status: 'active',
      });
      mockProvider.getPublishedApps.mockRejectedValue(new Error('Network timeout'));

      const result = await checkPaywallEligibility(mockProvider, 'app-new', PaywallAction.Publish);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Unable to verify publish limit');
      expect(result.details.hasSubscription).toBe(true);
    });

    it('should not affect download action when getPublishedApps would fail', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
        bypassPublishLimit: false,
      });
      mockProvider.getAccountSubscription.mockResolvedValue({
        id: 'sub-starter',
        plan: SubscriptionPlan.Starter,
        status: 'active',
      });
      // getPublishedApps would throw, but shouldn't be called for download
      mockProvider.getPublishedApps.mockRejectedValue(new Error('API error'));

      const result = await checkPaywallEligibility(mockProvider, 'app-1', PaywallAction.Download);

      expect(result.hasAccess).toBe(true);
      expect(mockProvider.getPublishedApps).not.toHaveBeenCalled();
    });
  });

  describe('PaywallAction.Download (bypasses publish limits)', () => {
    beforeEach(() => {
      mockProvider.getRootDomain.mockReturnValue('test-godaddy.com');

    });

    it('should allow download for paid plan even at publish limit', async () => {
      mockProvider.checkSwitchboardFlags.mockResolvedValue({
        paywall: true,
        markets: true,
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

});