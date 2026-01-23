/**
 * Server Provider Tests
 *
 * Tests for server-side paywall data provider, particularly focusing on:
 * - Switchboard flag fetch error handling
 * - Proper error throwing vs silent failures
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerPaywallProvider } from '../server-provider';

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock mgmt-airo client
vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn(),
  AIRO_OWNER_PRODUCTS: {
    AIRO_APP_BUILDER: 'airo-app-builder',
  },
}));

// Mock venture service
vi.mock('@/lib/venture-service', () => ({
  VentureService: vi.fn(),
}));

describe('ServerPaywallProvider', () => {
  let mockHeaders: Headers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = new Headers({ host: 'builder.godaddy.com' });
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
});
