import { afterEach, describe, expect, it, vi } from 'vitest';

import { regenerateToken } from './jwt-regeneration';

const mockAppFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/gasket-config', () => ({
  appFetch: mockAppFetch,
}));

vi.mock('@/lib/quick-create', () => ({
  getStoredStartProfile: () => undefined,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function okTokenResponse(): Response {
  return new Response(
    JSON.stringify({ token: 'jwt', expires: 'later', siteId: 'abc', type: 'agent' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('regenerateToken handle401 routing', function regenerateTokenHandle401Tests() {
  afterEach(function reset() {
    vi.clearAllMocks();
  });

  it('routes 401s through resolveAuth at level 2 by default (handle401: true)', async function defaultsToLevel2() {
    mockAppFetch.mockResolvedValueOnce(okTokenResponse());

    await regenerateToken({ siteId: 'abc', force: true });

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/auth/agent-token',
      expect.objectContaining({ method: 'POST' }),
      { handle401: true },
    );
  });

  it('routes 401s at the requested level when authLevel is set (sensitive ops)', async function usesAuthLevel() {
    mockAppFetch.mockResolvedValueOnce(okTokenResponse());

    await regenerateToken({ siteId: 'abc', force: true, authLevel: 3 });

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/auth/agent-token',
      expect.objectContaining({ method: 'POST' }),
      { handle401: { level: 3 } },
    );
  });

  it('still throws when auth recovery does not resolve the 401', async function throwsOnUnrecovered401() {
    mockAppFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(regenerateToken({ siteId: 'abc', force: true })).rejects.toThrow('Failed to regenerate token');
  });
});
