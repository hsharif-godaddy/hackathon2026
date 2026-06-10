import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { refreshAccessToken } from '../oauth';
import { load, remove, resolve, save } from '../tokens';

const APP_ID = 'app-123';
const JWT = 'test-jwt';

function mockAdapter(secrets: Array<{ name: string; value: string }> = []) {
  const adapter = {
    getProtectedSecrets: vi.fn(function getProtectedSecrets() {
      return Promise.resolve({ secrets });
    }),
    updateProtectedSecrets: vi.fn(function updateProtectedSecrets() {
      return Promise.resolve();
    }),
  };
  vi.mocked(getControlPlaneAdapter).mockReturnValue(adapter as any);
  return adapter;
}

describe('github-tokens', function tokensTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  afterEach(function restore() {
    vi.useRealTimers();
  });

  describe('#load', function loadTests() {
    it('returns null when GITHUB_TOKEN secret is missing', async function missing() {
      mockAdapter([]);
      expect(await load(APP_ID, JWT)).toBeNull();
    });

    it('returns token data when secrets are present', async function present() {
      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_abc' },
        { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_xyz' },
        { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700000000' },
      ]);

      expect(await load(APP_ID, JWT)).toEqual({
        accessToken: 'gho_abc',
        refreshToken: 'ghr_xyz',
        expiresAt: 1700000000,
      });
    });

    it('returns null refreshToken and expiresAt when those secrets are absent', async function nullSentinels() {
      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_only' },
      ]);

      const result = await load(APP_ID, JWT);
      expect(result).toEqual({
        accessToken: 'gho_only',
        refreshToken: null,
        expiresAt: null,
      });
    });

    it('calls getProtectedSecrets with appId and jwt', async function callArgs() {
      const adapter = mockAdapter([]);
      await load(APP_ID, JWT);
      expect(adapter.getProtectedSecrets).toHaveBeenCalledWith(APP_ID, JWT);
    });
  });

  describe('#save', function saveTests() {
    it('calls updateProtectedSecrets with correct secret names and both variants', async function names() {
      const adapter = mockAdapter();
      await save(APP_ID, JWT, {
        accessToken: 'gho_new',
        refreshToken: 'ghr_new',
        expiresAt: 1700001000,
      });

      expect(adapter.updateProtectedSecrets).toHaveBeenCalledWith(
        APP_ID,
        ['preview', 'publish'],
        {
          additions: [
            { name: 'GITHUB_TOKEN', value: 'gho_new' },
            { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_new' },
            { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700001000' },
          ],
        },
        JWT,
      );
    });

    it('passes both preview and publish variants', async function variants() {
      const adapter = mockAdapter();
      await save(APP_ID, JWT, { accessToken: 'a', refreshToken: 'r', expiresAt: 100 });
      expect(adapter.updateProtectedSecrets.mock.calls[0][1]).toEqual(['preview', 'publish']);
    });

    it('omits refreshToken and expiresAt when null', async function nullFields() {
      const adapter = mockAdapter();
      await save(APP_ID, JWT, { accessToken: 'a', refreshToken: null, expiresAt: null });
      expect(adapter.updateProtectedSecrets).toHaveBeenCalledWith(
        APP_ID,
        ['preview', 'publish'],
        { additions: [{ name: 'GITHUB_TOKEN', value: 'a' }] },
        JWT,
      );
    });
  });

  describe('#remove', function removeTests() {
    it('calls updateProtectedSecrets with deletions across both variants', async function deletions() {
      const adapter = mockAdapter();
      await remove(APP_ID, JWT);

      expect(adapter.updateProtectedSecrets).toHaveBeenCalledWith(
        APP_ID,
        ['preview', 'publish'],
        {
          deletions: [
            'GITHUB_TOKEN',
            'GITHUB_REFRESH_TOKEN',
            'GITHUB_TOKEN_EXPIRES_AT',
          ],
        },
        JWT,
      );
    });
  });

  describe('#resolve', function resolveTests() {
    it('throws when no token found', async function noToken() {
      mockAdapter([]);
      await expect(resolve(APP_ID, JWT)).rejects.toThrow('No GitHub token found');
    });

    it('returns access token when not expired', async function notExpired() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1_700_000_000_000));

      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_valid' },
        { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_ref' },
        { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700001000' },
      ]);

      expect(await resolve(APP_ID, JWT)).toBe('gho_valid');
    });

    it('refreshes and persists when expired and refresh token available', async function refresh() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1_700_001_000_000));

      const adapter = mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_old' },
        { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_ref' },
        { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700001000' },
      ]);

      vi.mocked(refreshAccessToken).mockResolvedValue({
        access_token: 'gho_refreshed',
        refresh_token: 'ghr_new',
        expires_in: 28800,
        token_type: 'bearer',
      });

      expect(await resolve(APP_ID, JWT)).toBe('gho_refreshed');
      expect(adapter.updateProtectedSecrets).toHaveBeenCalled();
    });

    it('returns existing token when expiresAt is null', async function nullExpiry() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1_700_000_000_000));

      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_forever' },
        { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_ref' },
      ]);

      expect(await resolve(APP_ID, JWT)).toBe('gho_forever');
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('throws when refresh fails', async function refreshFailure() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1_700_001_000_000));

      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_old' },
        { name: 'GITHUB_REFRESH_TOKEN', value: 'ghr_ref' },
        { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700001000' },
      ]);

      vi.mocked(refreshAccessToken).mockRejectedValue(new Error('refresh denied'));

      await expect(resolve(APP_ID, JWT)).rejects.toThrow('refresh denied');
    });

    it('returns token without refresh when refreshToken is null', async function noRefreshToken() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1_700_001_000_000));

      mockAdapter([
        { name: 'GITHUB_TOKEN', value: 'gho_stale' },
        { name: 'GITHUB_TOKEN_EXPIRES_AT', value: '1700001000' },
      ]);

      expect(await resolve(APP_ID, JWT)).toBe('gho_stale');
      expect(refreshAccessToken).not.toHaveBeenCalled();
    });
  });
});
