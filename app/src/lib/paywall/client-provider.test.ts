/**
 * Client Provider Tests
 *
 * Tests for client-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Proper error throwing vs silent failures
 * - Browser-specific behavior (window.location, fetch with credentials)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appFetch } from '@/lib/gasket-config';
import { ClientPaywallProvider } from './client-provider';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock getRootDomain utility
vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: vi.fn().mockReturnValue('godaddy.com'),
}));

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

describe('ClientPaywallProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSwitchboardFlags', () => {
    // Helper to create mock responses for all 4 switchboard flags
    function mockSwitchboardFlags(options: {
      paywall?: { ok: boolean; status?: number; setting?: boolean; json?: () => Promise<any> };
      markets?: { ok: boolean; status?: number; setting?: boolean; json?: () => Promise<any> };
      grants?: { ok: boolean; status?: number; setting?: boolean };
      bypass?: { ok: boolean; status?: number; setting?: boolean };
    }) {
      const createResponse = (opt?: { ok: boolean; status?: number; setting?: boolean; json?: () => Promise<any> }) => ({
        ok: opt?.ok ?? true,
        status: opt?.status ?? 200,
        json: opt?.json ?? (async () => (opt?.setting !== undefined ? { setting: opt.setting } : {})),
      });

      vi.mocked(appFetch)
        .mockResolvedValueOnce(createResponse(options.paywall) as any)
        .mockResolvedValueOnce(createResponse(options.markets) as any)
        .mockResolvedValueOnce(createResponse(options.grants) as any)
        .mockResolvedValueOnce(createResponse(options.bypass) as any);
    }

    it('should return flags when API calls succeed', async () => {
      mockSwitchboardFlags({
        paywall: { ok: true, setting: true },
        markets: { ok: true, setting: true },
        grants: { ok: true, setting: false },
        bypass: { ok: true, setting: false },
      });

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: true, markets: true, grants: false, bypassPublishLimit: false });
      expect(appFetch).toHaveBeenCalledTimes(4);
      expect(appFetch).toHaveBeenCalledWith(
        'https://bff.pcx.godaddy.com/api/config/feature/appbuilder-airoplus-paywall?app=airo-app-builder',
        {},
        { setAuthState: false }
      );
      expect(appFetch).toHaveBeenCalledWith(
        'https://bff.pcx.godaddy.com/api/config/feature/appbuilder-airoplus-markets?app=airo-app-builder',
        {},
        { setAuthState: false }
      );
    });

    it('should return grants and bypass flags when enabled', async () => {
      mockSwitchboardFlags({
        paywall: { ok: true, setting: true },
        markets: { ok: true, setting: true },
        grants: { ok: true, setting: true },
        bypass: { ok: true, setting: true },
      });

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: true, markets: true, grants: true, bypassPublishLimit: true });
    });

    it('should throw error when paywall flag fetch fails', async () => {
      mockSwitchboardFlags({
        paywall: { ok: false, status: 503 },
        markets: { ok: true, setting: true },
        grants: { ok: true, setting: false },
        bypass: { ok: true, setting: false },
      });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-paywall (status: 503)'
      );
    });

    it('should throw error when markets flag fetch fails', async () => {
      mockSwitchboardFlags({
        paywall: { ok: true, setting: true },
        markets: { ok: false, status: 404 },
        grants: { ok: true, setting: false },
        bypass: { ok: true, setting: false },
      });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-markets (status: 404)'
      );
    });

    it('should throw error when paywall flag JSON parsing fails', async () => {
      vi.mocked(appFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Failed to parse switchboard flag: appbuilder-airoplus-paywall - Invalid JSON'
      );
    });

    it('should throw error when markets flag JSON parsing fails', async () => {
      vi.mocked(appFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Failed to parse switchboard flag: appbuilder-airoplus-markets - Invalid JSON'
      );
    });

    it('should default to false when flag setting is missing', async () => {
      vi.mocked(appFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}), // No setting field
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: null }), // Null setting
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: false, markets: false, grants: false, bypassPublishLimit: false });
    });

    it('should throw error on network failure', async () => {
      vi.mocked(appFetch)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: false }),
        } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow('Network error');
    });

    it('should handle 500 errors', async () => {
      mockSwitchboardFlags({
        paywall: { ok: false, status: 500 },
        markets: { ok: true, setting: true },
        grants: { ok: true, setting: false },
        bypass: { ok: true, setting: false },
      });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-paywall (status: 500)'
      );
    });

    it('should handle 401 unauthorized errors', async () => {
      mockSwitchboardFlags({
        paywall: { ok: true, setting: true },
        markets: { ok: false, status: 401 },
        grants: { ok: true, setting: false },
        bypass: { ok: true, setting: false },
      });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-markets (status: 401)'
      );
    });

    it('should handle grants/bypass flag fetch failures with fail-closed defaults', async () => {
      // grants and bypass use .catch(() => null) so failures are handled gracefully
      // Network failures return true for grants (enforce limits) and false for bypass (no bypass)
      vi.mocked(appFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        } as any)
        .mockRejectedValueOnce(new Error('Network error')) // grants fails
        .mockRejectedValueOnce(new Error('Network error')); // bypass fails

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      // Should still succeed with fail-closed defaults: grants=true (enforce limits), bypass=false
      expect(result.paywall).toBe(true);
      expect(result.markets).toBe(true);
      expect(result.grants).toBe(true); // fail-closed: assume grants enabled
      expect(result.bypassPublishLimit).toBe(false); // fail-closed: assume bypass disabled
    });
  });

  describe('getRootDomain', () => {
    it('should return root domain from getRootDomain utility', () => {
      const provider = new ClientPaywallProvider();
      expect(provider.getRootDomain()).toBe('godaddy.com');
    });

    it('should return null when getRootDomain returns null', async () => {
      const { getRootDomain } = await import('@/utils/getRootDomain');
      vi.mocked(getRootDomain).mockReturnValueOnce(null);

      const provider = new ClientPaywallProvider();
      expect(provider.getRootDomain()).toBeNull();
    });
  });

  describe('getAccountSubscription', () => {
    it('should return subscription data when API call succeeds', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            active: {
              id: 'sub-123',
              plan: 'starter',
              status: 'active',
            },
          },
        }),
      } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.getAccountSubscription();

      expect(result).toEqual({
        id: 'sub-123',
        plan: 'starter',
        status: 'active',
      });
    });

    it('should return undefined when subscription not found (404)', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.getAccountSubscription();

      expect(result).toBeUndefined();
    });

    it('should throw error on server error (500) - fail-closed', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.getAccountSubscription()).rejects.toThrow(
        'Failed to fetch subscription: 500'
      );
    });

    it('should throw error on service unavailable (503) - fail-closed', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.getAccountSubscription()).rejects.toThrow(
        'Failed to fetch subscription: 503'
      );
    });

    it('should throw error on unauthorized (401) - fail-closed', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.getAccountSubscription()).rejects.toThrow(
        'Failed to fetch subscription: 401'
      );
    });

    it('should throw error on network failure - fail-closed', async () => {
      vi.mocked(appFetch).mockRejectedValueOnce(new Error('Network error'));

      const provider = new ClientPaywallProvider();

      await expect(provider.getAccountSubscription()).rejects.toThrow('Network error');
    });

    it('should return undefined when data.active is missing', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.getAccountSubscription();

      expect(result).toBeUndefined();
    });
  });

  describe('getPublishedApps', () => {
    it('should return published apps when API call succeeds', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'app-1', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
          { id: 'app-2', variantsWithLifecycle: [{ variant: 'preview', status: 'active' }] },
          { id: 'app-3', variantsWithLifecycle: [{ variant: 'publish', status: 'active' }] },
        ],
      } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.getPublishedApps();

      expect(result.count).toBe(2);
      expect(result.publishedAppIds).toEqual(['app-1', 'app-3']);
      expect(result.apps).toHaveLength(2);
    });

    it('should throw error when API returns non-ok response (fail-closed)', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.getPublishedApps()).rejects.toThrow(
        'Failed to fetch published apps: 500'
      );
    });

    it('should throw error when API returns 401 unauthorized (fail-closed)', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any);

      const provider = new ClientPaywallProvider();

      await expect(provider.getPublishedApps()).rejects.toThrow(
        'Failed to fetch published apps: 401'
      );
    });

    it('should throw error when network request fails (fail-closed)', async () => {
      vi.mocked(appFetch).mockRejectedValueOnce(new Error('Network error'));

      const provider = new ClientPaywallProvider();

      await expect(provider.getPublishedApps()).rejects.toThrow('Network error');
    });

    it('should return empty list when no apps have publish variant', async () => {
      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'app-1', variantsWithLifecycle: [{ variant: 'preview', status: 'active' }] },
        ],
      } as any);

      const provider = new ClientPaywallProvider();
      const result = await provider.getPublishedApps();

      expect(result.count).toBe(0);
      expect(result.publishedAppIds).toEqual([]);
    });
  });
});
