import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  config: { MGMT_CERT: 'cert', MGMT_KEY: 'key' },
  getSsoHost: () => 'sso.test-godaddy.com',
}));
vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetTokenFromCertificate = vi.fn();
vi.mock('gd-auth-client', () => ({ getTokenFromCertificate: mockGetTokenFromCertificate }));

beforeEach(() => {
  vi.resetModules();
  mockGetTokenFromCertificate.mockReset();
});

describe('notification-service', () => {
  describe('#getCertSsoToken', () => {
    it('returns cached token without calling SSO again', async () => {
      mockGetTokenFromCertificate.mockResolvedValueOnce('tok-1');
      const { getCertSsoToken } = await import('../cert-sso.js');

      await getCertSsoToken();
      const second = await getCertSsoToken();

      expect(second).toBe('tok-1');
      expect(mockGetTokenFromCertificate).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent calls onto a single in-flight refresh', async () => {
      let resolve: (t: string) => void;
      mockGetTokenFromCertificate.mockReturnValueOnce(
        new Promise<string>(r => { resolve = r; }),
      );
      const { getCertSsoToken } = await import('../cert-sso.js');

      const p1 = getCertSsoToken();
      const p2 = getCertSsoToken();
      const p3 = getCertSsoToken();

      resolve!('tok-concurrent');
      const results = await Promise.all([p1, p2, p3]);

      expect(results).toEqual(['tok-concurrent', 'tok-concurrent', 'tok-concurrent']);
      expect(mockGetTokenFromCertificate).toHaveBeenCalledTimes(1);
    });

    it('clearCertSsoCache does not break in-flight single-flight invariant', async () => {
      let resolveFirst: (t: string) => void;
      mockGetTokenFromCertificate
        .mockReturnValueOnce(new Promise<string>(r => { resolveFirst = r; }))
        .mockResolvedValueOnce('tok-second');

      const { getCertSsoToken, clearCertSsoCache } = await import('../cert-sso.js');

      const p1 = getCertSsoToken();

      // Simulate 401 handler calling clear while refresh is in-flight
      clearCertSsoCache();

      // This call should coalesce onto the existing in-flight promise, not start a new one
      const p2 = getCertSsoToken();

      resolveFirst!('tok-first');
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe('tok-first');
      expect(r2).toBe('tok-first');
      expect(mockGetTokenFromCertificate).toHaveBeenCalledTimes(1);
    });
  });
});
