/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appFetch } = vi.hoisted(() => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useSiteStore } from './useSiteStore';

describe('useSiteStore', () => {
  beforeEach(() => {
    appFetch.mockReset();
    useSiteStore.getState().cleanup();
  });

  describe('#fetchSite', () => {
    it('does not set loading when silent is true', async function silentFetch() {
      const siteId = 'app-1';
      const sitePayload = { id: siteId, account_id: 'acc-1' };
      appFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => sitePayload,
      });

      await useSiteStore.getState().fetchSite(siteId, true, true);

      const state = useSiteStore.getState();
      expect(state.loading[siteId]).toBeUndefined();
      expect(state.sites[siteId]).toEqual(sitePayload);
    });

    it('does not set loading when silent fetch fails but records error', async function silentFetchFailure() {
      const siteId = 'app-1';
      appFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await useSiteStore.getState().fetchSite(siteId, true, true);

      const state = useSiteStore.getState();
      expect(result).toBeNull();
      expect(state.loading[siteId]).toBeUndefined();
      expect(state.error).toBe('network error');
    });
  });
});
