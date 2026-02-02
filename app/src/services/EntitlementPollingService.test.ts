import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import { EntitlementPollingService } from './EntitlementPollingService';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

describe('EntitlementPollingService', () => {
  let service: EntitlementPollingService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new EntitlementPollingService({
      maxAttempts: 3,
      pollInterval: 100, // Use short interval for tests
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('pollForAccountEntitlements', () => {
    it('should return success when subscription has airoPlus plan', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            active: {
              id: 'sub-123',
              plan: SubscriptionPlan.AiroPlus,
              builderEntitlementId: 'builder-ent-456',
              entitlementId: 'ent-789',
            },
          },
        }),
      } as Response);

      const resultPromise = service.pollForAccountEntitlements();

      // No need to advance timers since it should resolve immediately
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data?.subscriptionId).toBe('sub-123');
      expect(result.data?.entitlementId).toBe('builder-ent-456');
      expect(mockFetch).toHaveBeenCalledWith('/api/subscriptions', {
        credentials: 'include',
      });
    });

    it('should return success when subscription has starter plan', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            active: {
              id: 'sub-starter',
              plan: SubscriptionPlan.Starter,
              builderEntitlementId: 'builder-starter-123',
            },
          },
        }),
      } as Response);

      const result = await service.pollForAccountEntitlements();

      expect(result.success).toBe(true);
      expect(result.data?.subscriptionId).toBe('sub-starter');
      expect(result.data?.entitlementId).toBe('builder-starter-123');
    });

    it('should poll until entitlements are found for free plan', async () => {
      const mockFetch = vi.mocked(global.fetch);
      let entitlementCallCount = 0;

      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/subscriptions') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                active: {
                  id: 'sub-free',
                  plan: SubscriptionPlan.Free,
                },
              },
            }),
          } as Response;
        }

        // /api/entitlements call
        entitlementCallCount++;
        if (entitlementCallCount === 1) {
          // First attempt: no entitlements
          return {
            ok: true,
            json: async () => ({
              success: false,
            }),
          } as Response;
        } else {
          // Second attempt: entitlements found
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                subscription: {
                  entitlementId: 'ent-found',
                },
                subscriptionId: 'sub-free',
              },
            }),
          } as Response;
        }
      });

      const resultPromise = service.pollForAccountEntitlements();

      // Advance timer for first polling attempt
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data?.entitlementId).toBe('ent-found');
      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 subscription calls + 2 entitlements calls
    });

    it('should handle subscription API errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      // Mock all attempts to fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Internal server error',
        }),
      } as Response);

      const resultPromise = service.pollForAccountEntitlements();

      // Advance through all polling attempts
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal server error');
    });

    it('should timeout after max attempts', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/subscriptions') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                active: {
                  id: 'sub-free',
                  plan: SubscriptionPlan.Free,
                },
              },
            }),
          } as Response;
        }
        // /api/entitlements - always return no entitlements to force timeout
        return {
          ok: true,
          json: async () => ({
            success: false,
          }),
        } as Response;
      });

      const resultPromise = service.pollForAccountEntitlements();

      // Advance through all polling attempts
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should notify status updates via callback', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const statusCallback = vi.fn();

      mockFetch.mockImplementation(async (url) => {
        if (url === '/api/subscriptions') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                active: {
                  id: 'sub-free',
                  plan: SubscriptionPlan.Free,
                },
              },
            }),
          } as Response;
        }
        // /api/entitlements - return no entitlements to force polling
        return {
          ok: true,
          json: async () => ({
            success: false,
          }),
        } as Response;
      });

      const resultPromise = service.pollForAccountEntitlements(statusCallback);

      // Advance through multiple polling attempts
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      await resultPromise;

      expect(statusCallback).toHaveBeenCalledWith(1, 3);
      expect(statusCallback).toHaveBeenCalledWith(2, 3);
      expect(statusCallback).toHaveBeenCalledWith(3, 3);
    });

    it('should use builderEntitlementId as primary entitlement', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            active: {
              id: 'sub-123',
              plan: SubscriptionPlan.AiroPlus,
              builderEntitlementId: 'builder-primary',
              entitlementId: 'legacy-ent',
            },
          },
        }),
      } as Response);

      const result = await service.pollForAccountEntitlements();

      expect(result.data?.entitlementId).toBe('builder-primary');
    });

    it('should fallback to entitlementId if no builderEntitlementId', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            active: {
              id: 'sub-123',
              plan: SubscriptionPlan.AiroPlus,
              entitlementId: 'legacy-ent',
            },
          },
        }),
      } as Response);

      const result = await service.pollForAccountEntitlements();

      expect(result.data?.entitlementId).toBe('legacy-ent');
    });

    it('should use subscription id as last fallback', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            active: {
              id: 'sub-123',
              plan: SubscriptionPlan.AiroPlus,
            },
          },
        }),
      } as Response);

      const result = await service.pollForAccountEntitlements();

      expect(result.data?.entitlementId).toBe('sub-123');
    });
  });

  describe('Legacy pollForEntitlements (deprecated)', () => {
    it('should still work for backward compatibility', async () => {
      const mockFetch = vi.mocked(global.fetch);

      // First call: /api/apps/{appId}/subscription
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            subscription: {
              id: 'sub-legacy',
            },
          },
        }),
      } as Response);

      // Second call: /api/entitlements
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            subscription: {
              entitlementId: 'ent-legacy',
            },
            subscriptionId: 'sub-legacy',
          },
        }),
      } as Response);

      const result = await service.pollForEntitlements('app-456');

      expect(result.success).toBe(true);
      expect(result.data?.subscriptionId).toBe('sub-legacy');
      expect(result.data?.entitlementId).toBe('ent-legacy');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/apps/app-456/subscription',
        { credentials: 'include' }
      );
    });
  });

  describe('checkEntitlementsOnce', () => {
    it('should check once without polling', async () => {
      const mockFetch = vi.mocked(global.fetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            subscription: {
              id: 'sub-check',
            },
          },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            subscription: {
              entitlementId: 'ent-check',
            },
            subscriptionId: 'sub-check',
          },
        }),
      } as Response);

      const result = await service.checkEntitlementsOnce('app-789');

      expect(result.success).toBe(true);
      expect(result.data?.entitlementId).toBe('ent-check');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return error if no entitlements found', async () => {
      const mockFetch = vi.mocked(global.fetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            subscription: {
              id: 'sub-check',
            },
          },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
        }),
      } as Response);

      const result = await service.checkEntitlementsOnce('app-no-ent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No entitlements found');
    });
  });
});