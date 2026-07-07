import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetS2STokenV2 = vi.fn();
const mockRefreshS2STokenV2 = vi.fn();
const mockIsS2SAuthV2Enabled = vi.fn();

vi.mock('@airo/ai-lib', () => ({
  getS2STokenV2: (...args: unknown[]) => mockGetS2STokenV2(...args),
  refreshS2STokenV2: (...args: unknown[]) => mockRefreshS2STokenV2(...args),
  isS2SAuthV2Enabled: () => mockIsS2SAuthV2Enabled(),
}));

import { getCareS2SToken, refreshCareS2SToken } from './careAuth.js';

describe('careAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.S2S_AWS_PROFILE;
    delete process.env.SSO_HOST;
    delete process.env.SSO_JWT;
  });

  afterEach(() => {
    delete process.env.S2S_AWS_PROFILE;
    delete process.env.SSO_HOST;
    delete process.env.SSO_JWT;
  });

  describe('#getCareS2SToken', () => {
    it('fetches via getS2STokenV2 with default config when s2s auth is enabled', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockGetS2STokenV2.mockResolvedValue('raw.jwt.token');

      const token = await getCareS2SToken();

      expect(token).toBe('raw.jwt.token');
      expect(token).not.toMatch(/^sso-jwt /);
      expect(mockGetS2STokenV2).toHaveBeenCalledWith({
        awsProfile: 'gocode',
        ssoHost: 'sso.test-godaddy.com',
      });
    });

    it('honors S2S_AWS_PROFILE and SSO_HOST overrides', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockGetS2STokenV2.mockResolvedValue('raw.jwt.token');
      process.env.S2S_AWS_PROFILE = 'care-profile';
      process.env.SSO_HOST = 'sso.dev-godaddy.com';

      await getCareS2SToken();

      expect(mockGetS2STokenV2).toHaveBeenCalledWith({
        awsProfile: 'care-profile',
        ssoHost: 'sso.dev-godaddy.com',
      });
    });

    it('prefers s2s auth over SSO_JWT when both are available', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockGetS2STokenV2.mockResolvedValue('s2s.jwt.token');
      process.env.SSO_JWT = 'local.dev.jwt';

      const token = await getCareS2SToken();

      expect(token).toBe('s2s.jwt.token');
      expect(mockGetS2STokenV2).toHaveBeenCalledTimes(1);
    });

    it('throws on empty-string SSO_JWT when s2s auth is disabled', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(false);
      process.env.SSO_JWT = '';

      await expect(getCareS2SToken()).rejects.toThrow(/USE_S2S_AUTH|SSO_JWT/);
      expect(mockGetS2STokenV2).not.toHaveBeenCalled();
    });

    it('returns SSO_JWT verbatim as local-dev fallback when s2s auth is disabled', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(false);
      process.env.SSO_JWT = 'local.dev.jwt';

      const token = await getCareS2SToken();

      expect(token).toBe('local.dev.jwt');
      expect(mockGetS2STokenV2).not.toHaveBeenCalled();
    });

    it('throws when neither s2s auth nor SSO_JWT is configured', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(false);

      await expect(getCareS2SToken()).rejects.toThrow(/USE_S2S_AUTH|SSO_JWT/);
      expect(mockGetS2STokenV2).not.toHaveBeenCalled();
    });

    it('propagates a getS2STokenV2 rejection', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockGetS2STokenV2.mockRejectedValue(new Error('IAM unavailable'));

      await expect(getCareS2SToken()).rejects.toThrow('IAM unavailable');
    });
  });

  describe('#refreshCareS2SToken', () => {
    it('delegates to refreshS2STokenV2 with default config when s2s auth is enabled', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockRefreshS2STokenV2.mockResolvedValue('fresh.jwt.token');

      const token = await refreshCareS2SToken();

      expect(token).toBe('fresh.jwt.token');
      expect(mockRefreshS2STokenV2).toHaveBeenCalledWith({
        awsProfile: 'gocode',
        ssoHost: 'sso.test-godaddy.com',
      });
    });

    it('honors S2S_AWS_PROFILE and SSO_HOST overrides', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(true);
      mockRefreshS2STokenV2.mockResolvedValue('fresh.jwt.token');
      process.env.S2S_AWS_PROFILE = 'care-profile';
      process.env.SSO_HOST = 'sso.dev-godaddy.com';

      await refreshCareS2SToken();

      expect(mockRefreshS2STokenV2).toHaveBeenCalledWith({
        awsProfile: 'care-profile',
        ssoHost: 'sso.dev-godaddy.com',
      });
    });

    it('throws without falling back to SSO_JWT when s2s auth is disabled', async () => {
      mockIsS2SAuthV2Enabled.mockReturnValue(false);
      process.env.SSO_JWT = 'local.dev.jwt';

      await expect(refreshCareS2SToken()).rejects.toThrow(/USE_S2S_AUTH|SSO_JWT/);
      expect(mockRefreshS2STokenV2).not.toHaveBeenCalled();
    });
  });
});
