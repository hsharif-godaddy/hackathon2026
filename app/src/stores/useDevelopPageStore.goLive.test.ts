/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDevelopPageStore } from './useDevelopPageStore';

// saveGoLiveStatus is module-private and reached only via the markAsGoneLive
// store action; it dynamically imports these three modules. Mock them so the
// action runs offline and we can assert the token regen requests level-3
// recovery (go-live is a sensitive op).
const mockRegenerateToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: mockRegenerateToken,
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'http://agent.test' }),
  },
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ hasGoneLive: true, wentLiveAt: '2026-07-03T00:00:00Z' }),
  }),
}));

describe('useDevelopPageStore markAsGoneLive', function markAsGoneLiveTests() {
  afterEach(function reset() {
    vi.clearAllMocks();
  });

  it('regenerates the go-live token at auth level 3 (sensitive op)', async function goLiveUsesLevel3() {
    mockRegenerateToken.mockResolvedValueOnce({
      token: 'jwt', expires: 'later', siteId: 'app-123', type: 'agent',
    });

    await useDevelopPageStore.getState().markAsGoneLive('app-123');

    expect(mockRegenerateToken).toHaveBeenCalledWith({ siteId: 'app-123', force: true, authLevel: 3 });
  });
});
