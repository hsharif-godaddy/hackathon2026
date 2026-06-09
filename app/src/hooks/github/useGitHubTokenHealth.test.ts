import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';
import { cacheSyncStrategy, ensureFreshToken } from './useGitHubTokenHealth';

describe('useGitHubTokenHealth', function tokenHealthTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheSyncStrategy('app-1', undefined);
    cacheSyncStrategy('app-dedup', undefined);
    cacheSyncStrategy('app-err', undefined);
  });

  describe('ensureFreshToken', function ensureTests() {
    it('skips when sync strategy is manual', async function skipManual() {
      cacheSyncStrategy('app-1', 'manual');

      await ensureFreshToken('app-1', 'commit');

      expect(appFetch).not.toHaveBeenCalled();
    });

    it('skips when no strategy is cached', async function noStrategy() {
      await ensureFreshToken('app-1', 'commit');

      expect(appFetch).not.toHaveBeenCalled();
    });

    it('skips when trigger does not match strategy', async function mismatch() {
      cacheSyncStrategy('app-1', 'on_publish');

      await ensureFreshToken('app-1', 'commit');

      expect(appFetch).not.toHaveBeenCalled();
    });

    it('skips when on_commit strategy receives publish trigger', async function reverseMismatch() {
      cacheSyncStrategy('app-1', 'on_commit');

      await ensureFreshToken('app-1', 'publish');

      expect(appFetch).not.toHaveBeenCalled();
    });

    it('skips refresh when token status returns valid', async function valid() {
      cacheSyncStrategy('app-1', 'on_commit');

      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true }),
      } as any);

      await ensureFreshToken('app-1', 'commit');

      expect(appFetch).toHaveBeenCalledTimes(1);
      expect(appFetch).toHaveBeenCalledWith('/api/apps/app-1/github/token/status');
    });

    it('triggers refresh when token is expired', async function expired() {
      cacheSyncStrategy('app-1', 'on_commit');

      vi.mocked(appFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ valid: false }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ refreshed: true }),
        } as any);

      await ensureFreshToken('app-1', 'commit');

      expect(appFetch).toHaveBeenCalledTimes(2);
      expect(appFetch).toHaveBeenNthCalledWith(2, '/api/apps/app-1/github/token/refresh', { method: 'POST' });
    });

    it('triggers refresh for on_publish with publish trigger', async function publishMatch() {
      cacheSyncStrategy('app-1', 'on_publish');

      vi.mocked(appFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true }),
      } as any);

      await ensureFreshToken('app-1', 'publish');

      expect(appFetch).toHaveBeenCalledTimes(1);
      expect(appFetch).toHaveBeenCalledWith('/api/apps/app-1/github/token/status');
    });

    it('deduplicates concurrent calls for the same appId', async function dedup() {
      cacheSyncStrategy('app-dedup', 'on_commit');

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      } as any);

      const [first, second] = await Promise.all([
        ensureFreshToken('app-dedup', 'commit'),
        ensureFreshToken('app-dedup', 'commit'),
      ]);

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(appFetch).toHaveBeenCalledTimes(1);
    });

    it('swallows errors silently', async function swallows() {
      cacheSyncStrategy('app-err', 'on_commit');

      vi.mocked(appFetch).mockRejectedValue(new Error('network error'));

      await expect(ensureFreshToken('app-err', 'commit')).resolves.toBeUndefined();
    });
  });
});
