/**
 * Server Provider Tests
 *
 * Tests for server-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Feature flag behavior for plan validation
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
const mockGetEntitlements = vi.fn();
const mockGetSystems = vi.fn();
const mockGetAppsForSystem = vi.fn();
const mockGetAllAppsForCustomer = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(function () { return {
    getSubscriptions: mockGetSubscriptions,
    getEntitlements: mockGetEntitlements,
    getSystems: mockGetSystems,
    getAppsForSystem: mockGetAppsForSystem,
    getAllAppsForCustomer: mockGetAllAppsForCustomer,
  }; }),
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
  VentureService: vi.fn().mockImplementation(function () { return {
    getCustomerProjects: vi.fn().mockResolvedValue({ projects: { edges: [] } }),
  }; }),
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
    function stubFlags(map: Record<string, boolean>) {
      mockCheckSwitchboardFlag.mockImplementation(function (name: string) { return Promise.resolve(map[name] ?? false); });
    }

    it('returns bypassPublishLimit flag from switchboard', async () => {
      stubFlags({
        'app-builder-bypass-publish-limit': false,
      });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      await expect(provider.checkSwitchboardFlags('godaddy.com')).resolves.toEqual({
        bypassPublishLimit: false,
      });
      expect(mockCheckSwitchboardFlag).toHaveBeenCalledTimes(1);
      expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith('app-builder-bypass-publish-limit', { headers: mockHeaders });
    });

    it('should return bypass flag when enabled', async () => {
      stubFlags({
        'app-builder-bypass-publish-limit': true,
      });

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      await expect(provider.checkSwitchboardFlags('godaddy.com')).resolves.toEqual({
        bypassPublishLimit: true,
      });
    });

    it('should propagate a tree lookup error (fail-closed)', async () => {
      mockCheckSwitchboardFlag.mockRejectedValue(new Error('switchboard boom'));
      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow('switchboard boom');
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

      it('should return None plan for trial aab-v1 subscription when flag is OFF', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            isTrial: true, // Maps to None plan (legacy trial behavior)
          },
        ]);

        mockGetEntitlements.mockRejectedValue(new Error('Not found'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result?.plan).toBe(SubscriptionPlan.None);
      });

      it('should return airoPlus for non-trial aab-v1 subscription with hadAiroPlus', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            isTrial: false,
            hadAiroPlus: true,
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

      it('should return subscription with existing valid plan', async () => {
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

        expect(result?.plan).toBe(SubscriptionPlan.Starter);
      });

      it('should return None plan when subscription has no valid plan', async () => {
        const subscription = {
          id: 'sub-1',
          productId: 'unknown-product',
          status: 'active',
          isTrial: false,
        };

        mockGetSubscriptions.mockResolvedValue([subscription]);
        mockGetEntitlements.mockRejectedValue(new Error('Not found'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

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
      });

      it('should return undefined when no subscriptions exist (flag ON)', async () => {
        mockCheckSwitchboardFlag.mockResolvedValue(true);
        mockGetSubscriptions.mockResolvedValue([]);

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result).toBeUndefined();
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

    });

    describe('Cache bypass behavior', () => {
      it('should pass noCache: true to getSubscriptions', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            plan: SubscriptionPlan.Starter,
          },
        ]);

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-1',
          productId: 'aab-v1',
          customerId: 'customer-123',
          status: 'active',
          plan: SubscriptionPlan.Starter,
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        await provider.getAccountSubscription();

        expect(mockGetSubscriptions).toHaveBeenCalledWith(
          'AiroAppBuilder',
          { noCache: true }
        );
      });

      it('should pass noCache: true to getEntitlements', async () => {
        mockGetSubscriptions.mockResolvedValue([
          {
            id: 'sub-1',
            productId: 'aab-v1',
            status: 'active',
            plan: SubscriptionPlan.Starter,
          },
        ]);

        mockGetEntitlements.mockResolvedValue({
          id: 'sub-1',
          productId: 'aab-v1',
          customerId: 'customer-123',
          status: 'active',
          plan: SubscriptionPlan.Starter,
        });

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        await provider.getAccountSubscription();

        expect(mockGetEntitlements).toHaveBeenCalledWith(
          'sub-1',
          { noCache: true }
        );
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
        mockGetEntitlements.mockRejectedValue(new Error('API error'));

        const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
        const result = await provider.getAccountSubscription();

        expect(result?.id).toBe('sub-1');
        expect(result?.plan).toBe(SubscriptionPlan.AiroPlus);
      });
    });
  });

  describe('getPublishedApps', () => {
    it('should return published apps when API call succeeds', async () => {
      mockGetAllAppsForCustomer.mockResolvedValue([
        { id: 'app-1', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
        { id: 'app-2', variantsWithLifecycle: [{ variant: 'preview', status: 'active' }] },
        { id: 'app-3', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
      ]);

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      const result = await provider.getPublishedApps();

      expect(result.count).toBe(2);
      expect(result.publishedAppIds).toEqual(['app-1', 'app-3']);
    });

    it('should throw error when API call fails (fail-closed)', async () => {
      mockGetAllAppsForCustomer.mockRejectedValue(new Error('API error'));

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);

      await expect(provider.getPublishedApps()).rejects.toThrow('API error');
    });

    it('should throw error on network failure (fail-closed)', async () => {
      mockGetAllAppsForCustomer.mockRejectedValue(new Error('Network timeout'));

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);

      await expect(provider.getPublishedApps()).rejects.toThrow('Network timeout');
    });

    it('should return empty list when no apps have publish variant', async () => {
      mockGetAllAppsForCustomer.mockResolvedValue([
        { id: 'app-1', variantsWithLifecycle: [{ variant: 'preview', status: 'active' }] },
      ]);

      const provider = new ServerPaywallProvider('jwt-token', 'customer-123', mockHeaders);
      const result = await provider.getPublishedApps();

      expect(result.count).toBe(0);
      expect(result.publishedAppIds).toEqual([]);
    });
  });
});
