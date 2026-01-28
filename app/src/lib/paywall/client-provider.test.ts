/**
 * Client Provider Tests
 *
 * Tests for client-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Proper error throwing vs silent failures
 * - Browser-specific behavior (window.location, fetch with credentials)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    global.fetch = vi.fn();
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

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: true, markets: true });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://bff.pcx.godaddy.com/api/config/feature/appbuilder-airoplus-paywall?app=airo-app-builder',
        { credentials: 'include' }
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://bff.pcx.godaddy.com/api/config/feature/appbuilder-airoplus-markets?app=airo-app-builder',
        { credentials: 'include' }
      );
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

      const provider = new ClientPaywallProvider();

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

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-markets (status: 404)'
      );
    });

    it('should throw error when paywall flag JSON parsing fails', async () => {
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

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Failed to parse switchboard flag: appbuilder-airoplus-paywall - Invalid JSON'
      );
    });

    it('should throw error when markets flag JSON parsing fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('Invalid JSON');
          },
        });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Failed to parse switchboard flag: appbuilder-airoplus-markets - Invalid JSON'
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

      const provider = new ClientPaywallProvider();
      const result = await provider.checkSwitchboardFlags('godaddy.com');

      expect(result).toEqual({ paywall: false, markets: false });
    });

    it('should throw error on network failure', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow('Network error');
    });

    it('should handle 500 errors', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-paywall (status: 500)'
      );
    });

    it('should handle 401 unauthorized errors', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ setting: true }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

      const provider = new ClientPaywallProvider();

      await expect(provider.checkSwitchboardFlags('godaddy.com')).rejects.toThrow(
        'Switchboard flag fetch failed: appbuilder-airoplus-markets (status: 401)'
      );
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
});
