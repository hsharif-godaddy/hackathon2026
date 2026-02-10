import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GdAuthService', () => {
  const originalEnv = process.env.SSO_HOST;

  afterEach(() => {
    // Restore original SSO_HOST
    if (originalEnv !== undefined) {
      process.env.SSO_HOST = originalEnv;
    } else {
      delete process.env.SSO_HOST;
    }
    vi.resetModules();
  });

  describe('initialization', () => {
    it('should throw error when SSO_HOST is not set', async () => {
      delete process.env.SSO_HOST;

      // Need to dynamically import to get fresh module after env change
      await expect(async () => {
        const { getGdAuthService } = await import('../gd-auth-service.js');
        getGdAuthService();
      }).rejects.toThrow('SSO_HOST environment variable not configured');
    });

    it('should initialize successfully when SSO_HOST is set', async () => {
      process.env.SSO_HOST = 'sso.test-godaddy.com';

      const { getGdAuthService } = await import('../gd-auth-service.js');
      const service = getGdAuthService();

      expect(service).toBeDefined();
    });

    it('should accept valid SSO hosts', async () => {
      const validHosts = [
        'sso.dev-godaddy.com',
        'sso.test-godaddy.com',
        'sso.godaddy.com',
      ];

      for (const host of validHosts) {
        process.env.SSO_HOST = host;
        vi.resetModules();

        const { getGdAuthService } = await import('../gd-auth-service.js');
        const service = getGdAuthService();

        expect(service).toBeDefined();
      }
    });
  });
});
