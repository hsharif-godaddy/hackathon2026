/**
 * Core Paywall Eligibility Tests
 *
 * Tests for the main paywall eligibility algorithm, particularly focusing on:
 * - Production vs development environment behavior
 * - Switchboard flag bypass logic
 * - Fail-closed behavior when checks fail
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPaywallEligibility } from '../core';
import type { PaywallDataProvider } from '../providers';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Create mock provider with customizable behavior
 */
function createMockProvider(overrides?: Partial<PaywallDataProvider>): PaywallDataProvider {
  return {
    getRootDomain: vi.fn().mockReturnValue('godaddy.com'),
    checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: true, markets: true }),
    getSubscription: vi.fn().mockResolvedValue('sub-123'),
    getEntitlements: vi.fn().mockResolvedValue('ent-456'),
    getProjects: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('checkPaywallEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Switchboard Flags', () => {
    it('should bypass paywall when switchboard flags are disabled', async () => {
      const provider = createMockProvider({
        checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: false, markets: false }),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      // Should bypass without checking subscription
      expect(provider.getSubscription).not.toHaveBeenCalled();
      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('Paywall not enabled');
      expect(result.details.hasSubscription).toBe(false);
    });

    it('should enforce paywall when flags are enabled', async () => {
      const provider = createMockProvider({
        checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: true, markets: true }),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.hasEntitlements).toBe(true);
    });

    it('should enforce paywall when only paywall flag is disabled', async () => {
      const provider = createMockProvider({
        checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: false, markets: true }),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('Paywall not enabled');
    });

    it('should enforce paywall when only markets flag is disabled', async () => {
      const provider = createMockProvider({
        checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: true, markets: false }),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('Paywall not enabled');
    });
  });

  describe('Fail-Closed Behavior', () => {
    it('should deny access when root domain is missing', async () => {
      const provider = createMockProvider({
        getRootDomain: vi.fn().mockReturnValue(null),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toContain('no root domain');
      expect(provider.checkSwitchboardFlags).not.toHaveBeenCalled();
    });

    it('should deny access when switchboard check throws error', async () => {
      const provider = createMockProvider({
        checkSwitchboardFlags: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toContain('switchboard check failed');
      expect(provider.getSubscription).not.toHaveBeenCalled();
    });

    it('should deny access when overall check fails', async () => {
      const provider = createMockProvider({
        getSubscription: vi.fn().mockRejectedValue(new Error('API error')),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Unable to verify subscription status');
    });
  });

  describe('Subscription and Entitlements', () => {
    it('should grant access with valid entitlements', async () => {
      const provider = createMockProvider();

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasSubscription).toBe(true);
      expect(result.details.hasEntitlements).toBe(true);
      expect(result.details.subscriptionId).toBe('sub-123');
      expect(result.details.entitlementId).toBe('ent-456');
    });

    it('should deny access without subscription', async () => {
      const provider = createMockProvider({
        getSubscription: vi.fn().mockResolvedValue(undefined),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('No active subscription found');
      expect(result.details.hasSubscription).toBe(false);
    });

    it('should check matching project when no entitlements', async () => {
      const provider = createMockProvider({
        getEntitlements: vi.fn().mockResolvedValue(undefined),
        getProjects: vi.fn().mockResolvedValue([
          {
            node: {
              group: 'aigeneratedmedia',
              status: 'ACTIVE',
              billing: {
                id: 'billing-789',
                plan: 'logoImage',
              },
            },
          },
        ]),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(true);
      expect(result.details.hasMatchingProject).toBe(true);
      expect(result.details.billingId).toBe('billing-789');
    });

    it('should deny access without entitlements or matching project', async () => {
      const provider = createMockProvider({
        getEntitlements: vi.fn().mockResolvedValue(undefined),
        getProjects: vi.fn().mockResolvedValue([]),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Airo Plus subscription required');
      expect(result.details.hasEntitlements).toBe(false);
      expect(result.details.hasMatchingProject).toBe(false);
    });

    it('should handle entitlements check errors gracefully', async () => {
      const provider = createMockProvider({
        getEntitlements: vi.fn().mockRejectedValue(new Error('Entitlements API error')),
        getProjects: vi.fn().mockResolvedValue([]),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Airo Plus subscription required');
      expect(result.details.hasSubscription).toBe(true);
    });

    it('should handle projects check errors gracefully', async () => {
      const provider = createMockProvider({
        getEntitlements: vi.fn().mockResolvedValue(undefined),
        getProjects: vi.fn().mockRejectedValue(new Error('Projects API error')),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Airo Plus subscription required');
      expect(result.details.hasSubscription).toBe(true);
    });

    it('should handle complete check failure', async () => {
      const provider = createMockProvider({
        getSubscription: vi.fn().mockRejectedValue(new Error('Complete API failure')),
      });

      const result = await checkPaywallEligibility('app-123', provider);

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('Unable to verify subscription status');
    });
  });
});
