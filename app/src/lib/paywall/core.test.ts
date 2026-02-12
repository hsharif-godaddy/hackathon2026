import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import { checkPaywallEligibility } from './core';
import type { PaywallDataProvider } from './providers';

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
});