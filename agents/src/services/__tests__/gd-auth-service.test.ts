import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@godaddy/gd-auth-lib', () => ({
  GdAuth: vi.fn().mockImplementation(() => ({
    setAppConfig: vi.fn(),
    parseToken: vi.fn(),
    getShopperId: vi.fn(),
    getCustomerId: vi.fn(),
    getPayload: vi.fn()
  })),
  SecurityLevel: { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 }
}));

describe('GdAuthService', () => {
  const originalEnv = process.env.SSO_HOST;

  afterEach(() => {
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
