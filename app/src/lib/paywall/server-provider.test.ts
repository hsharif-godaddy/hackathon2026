/**
 * Server Provider Tests
 *
 * Tests for server-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Feature flag behavior for plan validation
 * - Auto-creation of free plans
 * - Backwards compatibility
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import { ServerPaywallProvider } from './server-provider';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock switchboard server
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn(),
}));

// Mock mgmt-airo client
const mockGetSubscriptions = vi.fn();
const mockGetSubscription = vi.fn();
const mockGetEntitlements = vi.fn();
const mockCreateBuilderPlan = vi.fn();
const mockGetSystems = vi.fn();
const mockGetAppsForSystem = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(() => ({
    getSubscriptions: mockGetSubscriptions,
    getSubscription: mockGetSubscription,
    getEntitlements: mockGetEntitlements,
    createBuilderPlan: mockCreateBuilderPlan,
    getSystems: mockGetSystems,
    getAppsForSystem: mockGetAppsForSystem,
  })),
  AIRO_OWNER_PRODUCTS: {
    AIRO_APP_BUILDER: 'AiroAppBuilder',
  },
  AiroHttpError: class AiroHttpError extends Error {
    constructor(message: string, public status: number) {
      super(message);
      this.name = 'AiroHttpError';
    }
  },
}));

// Mock venture service
vi.mock('@/lib/venture-service', () => ({
  VentureService: vi.fn().mockImplementation(() => ({
    getCustomerProjects: vi.fn().mockResolvedValue({ projects: { edges: [] } }),
  })),
}));

describe('ServerPaywallProvider', () => {
  let mockHeaders: Headers;
  let mockCheckSwitchboardFlag: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHeaders = new Headers({ host: 'builder.godaddy.com' });
    global.fetch = vi.fn();

    // Get mock for switchboard flag
    const switchboardModule = await import('@/lib/switchboard/server');
    mockCheckSwitchboardFlag = vi.mocked(switchboardModule.checkSwitchboardFlag);
    mockCheckSwitchboardFlag.mockResolvedValue(false);
  });

  describe('checkSwitchboardFlags', () => {
    it('should return flags when API calls succeed', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: true, markets: true });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when paywall flag fetch fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-paywall (status: 503)'
      );
    });

    it('should throw error when markets flag fetch fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-markets (status: 404)'
      );
    });

    it('should throw error when flag JSON parsing fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Failed to parse switchboard flag: appbuilder-airoplus-paywall'
      );
    });

    it('should default to false when flag setting is missing', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}), // No setting field
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: null }), // Null setting
        });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: false, markets: false });
    });
  });

  describe('getRootDomain', () => {
    it('should extract root domain from host header', () => {
      const headers = new Headers({ host: 'builder.godaddy.com' });
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBe('godaddy.com');
    });

    it('should transform ote to stg for staging environments', () => {
      const headers = new Headers({ host: 'builder.ote-godaddy.com' });
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBe('stg-godaddy.com');
    });

    it('should return null when host header is missing', () => {
      const headers = new Headers();
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBeNull();
    });

    it('should return fallback domain for localhost', () => {
      const headers = new Headers({ host: 'localhost:3000' });
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should return fallback domain for local.gasket.dev-godaddy.com', () => {
      const headers = new Headers({ host: 'local.gasket.dev-godaddy.com:8443' });
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should return null when host does not match domain pattern and is not localhost', () => {
      const headers = new Headers({ host: 'invalid-host' });
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', headers);

      expect(provider.getRootDomain()).toBeNull();
    });
  });

  describe('getAccountSubscription', () => {
    describe('Feature flag OFF (legacy behavior)', () => {
      beforeEach(() => {
        mockCheckSwitchboardFlag.mockResolvedValue(false);
      });

      it('should NOT auto-create free plan when flag is OFF', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            isTrial: true, // Maps to Free plan
          },
        ]);

        mockGetEntitlements.mockRejectedValue(new Error('Not found'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(mockCreateBuilderPlan).not.toHaveBeenCalled();
        expect(result?.plan).toBe(SubscriptionPlan.None);
      });

      it('should return airoPlus for non-trial aab-v1 subscription', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            isTrial: false,
          },
        ]);

        mockGetEntitlements.mockRejectedValue(new Error('Not found'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result?.plan).toBe(SubscriptionPlan.AiroPlus);
      });
    });

    describe('Feature flag ON (new behavior)', () => {
      beforeEach(() => {
        mockCheckSwitchboardFlag.mockResolvedValue(true);
      });

      it('should auto-create free plan when subscription exists but has no valid plan', async () => {
        // Use unknown productId to get SubscriptionPlan.None from getPlanFromSubscription
        const subscriptionWithoutPlan = {
          id: 'sub-1',
          productId: 'unknown-product',
          status: 'active',
          isTrial: false,
          // No plan field - returns None
        };

        const subscriptionWithPlan = {
          id: 'sub-1',
          productId: 'unknown-product',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Free,
        };

        mockGetSubscriptions
          .mockResolvedValueOnce([subscriptionWithoutPlan])
          .mockResolvedValueOnce([subscriptionWithPlan]);

        // Idempotency check: return subscription without plan
        mockGetSubscription.mockResolvedValue(subscriptionWithoutPlan);

        mockCreateBuilderPlan.mockResolvedValue({
          subscriptionId: 'sub-1',
          plan: SubscriptionPlan.Free,
          builderEntitlementId: 'builder-ent-123',
        });

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-1',
          productId: 'unknown-product',
          customerId: 'customer-123',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Free,
          builderEntitlementId: 'builder-ent-123',
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(mockCreateBuilderPlan).toHaveBeenCalledWith('sub-1', { plan: SubscriptionPlan.Free });
        expect(result?.plan).toBe(SubscriptionPlan.Free);
      });

      it('should NOT auto-create plan if subscription already has valid plan', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            isTrial: false,
            plan: SubscriptionPlan.Starter,
          },
        ]);

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-1',
          productId: 'aab-v1',
          customerId: 'customer-123',
          status: 'active',
          isTrial: false,
          plan: SubscriptionPlan.Starter,
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(mockCreateBuilderPlan).not.toHaveBeenCalled();
        expect(result?.plan).toBe(SubscriptionPlan.Starter);
      });

      it('should handle createBuilderPlan failure gracefully', async () => {
        // Use unknown productId to trigger auto-creation
        const subscription = {
          id: 'sub-1',
          productId: 'unknown-product',
          status: 'active',
          isTrial: false,
        };

        mockGetSubscriptions.mockResolvedValue([subscription]);
        mockGetSubscription.mockResolvedValue(subscription);
        mockCreateBuilderPlan.mockRejectedValue(new Error('Plan creation failed'));
        mockGetEntitlements.mockRejectedValue(new Error('Not found'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        // Should return the subscription with mapped plan (None)
        expect(result?.plan).toBe(SubscriptionPlan.None);
      });
    });

    describe('No subscription scenarios', () => {
      it('should return undefined when no subscriptions exist (flag OFF)', async () => {
        mockCheckSwitchboardFlag.mockResolvedValue(false);
        mockGetSubscriptions.mockResolvedValue([]);

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result).toBeUndefined();
        expect(mockCreateBuilderPlan).not.toHaveBeenCalled();
      });

      it('should return undefined when no subscriptions exist (flag ON)', async () => {
        mockCheckSwitchboardFlag.mockResolvedValue(true);
        mockGetSubscriptions.mockResolvedValue([]);

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result).toBeUndefined();
        expect(mockCreateBuilderPlan).not.toHaveBeenCalled();
      });
    });

    describe('Subscription prioritization', () => {
      beforeEach(() => {
        mockCheckSwitchboardFlag.mockResolvedValue(true);
      });

      it('should prioritize airoPlus over starter over free', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-free',
            productId: 'aab-v1',
            status: 'active',
            plan: SubscriptionPlan.Free,
          },
          {
            id: 'sub-plus',
            productId: 'aab-v1',
            status: 'active',
            plan: SubscriptionPlan.AiroPlus,
          },
          {
            id: 'sub-starter',
            productId: 'aab-v1',
            status: 'active',
            plan: SubscriptionPlan.Starter,
          },
        ]);

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-plus',
          productId: 'aab-v1',
          customerId: 'customer-123',
          status: 'active',
          plan: SubscriptionPlan.AiroPlus,
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result?.id).toBe('sub-plus');
        expect(result?.plan).toBe(SubscriptionPlan.AiroPlus);
      });

      it('should prefer active subscription for auto-plan creation', async () => {
        // Use unknown productId to trigger auto-creation
        const inactiveSubscription = {
          id: 'sub-inactive',
          productId: 'unknown-product',
          status: 'inactive',
        };

        const activeSubscriptionWithoutPlan = {
          id: 'sub-active',
          productId: 'unknown-product',
          status: 'active',
        };

        const activeSubscriptionWithPlan = {
          id: 'sub-active',
          productId: 'unknown-product',
          status: 'active',
          plan: SubscriptionPlan.Free,
        };

        mockGetSubscriptions
          .mockResolvedValueOnce([inactiveSubscription, activeSubscriptionWithoutPlan])
          .mockResolvedValueOnce([inactiveSubscription, activeSubscriptionWithPlan]);

        // Idempotency check: return active subscription without plan
        mockGetSubscription.mockResolvedValue(activeSubscriptionWithoutPlan);

        mockCreateBuilderPlan.mockResolvedValue({
          subscriptionId: 'sub-active',
          plan: SubscriptionPlan.Free,
        });

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-active',
          productId: 'unknown-product',
          customerId: 'customer-123',
          status: 'active',
          plan: SubscriptionPlan.Free,
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        await provider.getAccountSubscription();

        expect(mockCreateBuilderPlan).toHaveBeenCalledWith('sub-active', { plan: SubscriptionPlan.Free });
      });
    });

    describe('Error handling', () => {
      it('should return subscription without full details if getEntitlements fails', async () => {
        mockCheckSwitchboardFlag.mockResolvedValue(true);

        const subscription = {
          id: 'sub-1',
          productId: 'aab-v1',
          status: 'active',
          plan: SubscriptionPlan.AiroPlus,
        };

        mockGetSubscriptions.mockResolvedValue([subscription]);
        mockGetSubscription.mockResolvedValue(subscription);
        mockGetEntitlements.mockRejectedValue(new Error('API error'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result?.id).toBe('sub-1');
        expect(result?.plan).toBe(SubscriptionPlan.AiroPlus);
      });
    });
  });
});
