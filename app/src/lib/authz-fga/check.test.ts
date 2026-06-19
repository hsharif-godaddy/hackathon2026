import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkPermission } from '@/lib/authz-fga/check';
import type { AuthzFgaConfig } from '@/lib/authz-fga/config';

const baseConfig: AuthzFgaConfig = {
  baseUrl: 'https://fga.example.test',
  storeId: 'store-1',
  oauthTokenUrl: 'https://oauth.example.test',
  clientId: 'c',
  clientSecret: 's',
};

describe('authz-fga/check', function authzFgaCheck() {
  afterEach(function reset() {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns true when API allows', async function allows() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ allowed: true }),
      })
    );

    const ok = await checkPermission(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_build',
      object: 'venture:v1',
    });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://fga.example.test/stores/store-1/check',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          tuple_key: {
            user: 'customer:1',
            relation: 'airo_app_build',
            object: 'venture:v1',
          },
        }),
      })
    );
  });

  it('returns false when API denies', async function denies() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ allowed: false }),
      })
    );

    const ok = await checkPermission(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_build',
      object: 'venture:v1',
    });
    expect(ok).toBe(false);
  });

  it('throws on non-OK response', async function httpError() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'nope',
      })
    );

    await expect(
      checkPermission(baseConfig, 'bad', {
        user: 'customer:1',
        relation: 'airo_app_build',
        object: 'venture:v1',
      })
    ).rejects.toThrow(/401/);
  });
});
