/**
 * @vitest-environment jsdom
 */
/**
 * Client Provider Tests
 *
 * Tests for client-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Proper error throwing vs silent failures
 * - Browser-specific behavior (window.location, fetch with credentials)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    function stubGasketData(tree: Record<string, unknown> | undefined) {
      if (tree === undefined) {
        // @ts-expect-error allow delete
        delete (window as any).gasketData;
        return;
      }
      (window as any).gasketData = { switchboard: tree };
    }

    afterEach(() => {
      stubGasketData(undefined);
    });

    it('returns bypassPublishLimit flag from gasket-data', async () => {
      stubGasketData({
        'app-builder-bypass-publish-limit': false,
      });

      const provider = new ClientPaywallProvider();
      await expect(provider.checkSwitchboardFlags('godaddy.com')).resolves.toEqual({
        bypassPublishLimit: false,
      });
    });

    it('returns bypass=true when the flag is enabled', async () => {
      stubGasketData({
        'app-builder-bypass-publish-limit': true,
      });

      const provider = new ClientPaywallProvider();
      await expect(provider.checkSwitchboardFlags('godaddy.com')).resolves.toEqual({
        bypassPublishLimit: true,
      });
    });

    it('defaults bypass to false when missing (fail-closed optional flag)', async () => {
      stubGasketData({});

      const provider = new ClientPaywallProvider();
      await expect(provider.checkSwitchboardFlags('godaddy.com')).resolves.toEqual({
        bypassPublishLimit: false,
      });
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
