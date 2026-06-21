import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthzFgaConfig } from '@/lib/authz-fga/config'
import { listObjects } from '@/lib/authz-fga/list-objects'

const baseConfig: AuthzFgaConfig = {
  baseUrl: 'https://fga.example.test',
  storeId: 'store-1',
  oauthTokenUrl: 'https://oauth.example.test',
  clientId: 'c',
  clientSecret: 's',
}

describe('authz-fga/list-objects', function authzFgaListObjects() {
  const originalLocalMock = process.env.AUTHZ_FGA_LOCAL_MOCK

  beforeEach(function reset() {
    delete process.env.AUTHZ_FGA_LOCAL_MOCK
  })

  afterEach(function restore() {
    if (originalLocalMock === undefined) {
      delete process.env.AUTHZ_FGA_LOCAL_MOCK
    } else {
      process.env.AUTHZ_FGA_LOCAL_MOCK = originalLocalMock
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the bare object ids stripped of the type prefix', async function strips() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ objects: ['venture:abc-1', 'venture:abc-2', 'venture:abc-3'] }),
      })
    )

    const ids = await listObjects(baseConfig, 'tok', {
      user: 'customer:42',
      relation: 'airo_app_view',
      type: 'venture',
    })

    expect(ids).toEqual(['abc-1', 'abc-2', 'abc-3'])
    expect(fetch).toHaveBeenCalledWith(
      'https://fga.example.test/stores/store-1/list-objects',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          user: 'customer:42',
          relation: 'airo_app_view',
          type: 'venture',
        }),
      })
    )
  })

  it('passes object ids through unchanged when they lack the expected prefix', async function passthrough() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ objects: ['no-prefix-here'] }),
      })
    )

    const ids = await listObjects(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_view',
      type: 'venture',
    })

    expect(ids).toEqual(['no-prefix-here'])
  })

  it('returns [] when API returns an empty objects array', async function empty() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ objects: [] }),
      })
    )

    const ids = await listObjects(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_view',
      type: 'venture',
    })

    expect(ids).toEqual([])
  })

  it('returns [] when API response is missing the objects field', async function missing() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({}),
      })
    )

    const ids = await listObjects(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_view',
      type: 'venture',
    })

    expect(ids).toEqual([])
  })

  it('throws on non-2xx response with truncated body', async function failure() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'a'.repeat(700),
      })
    )

    await expect(
      listObjects(baseConfig, 'tok', {
        user: 'customer:1',
        relation: 'airo_app_view',
        type: 'venture',
      })
    ).rejects.toThrow(/authz-fga\.list-objects failed: 500 a+$/)
  })

  it('short-circuits to [] when AUTHZ_FGA_LOCAL_MOCK=true (no fetch call)', async function localMock() {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const ids = await listObjects(baseConfig, 'tok', {
      user: 'customer:1',
      relation: 'airo_app_view',
      type: 'venture',
    })

    expect(ids).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards the model id header when configured', async function modelId() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ objects: [] }),
      })
    )

    await listObjects(
      { ...baseConfig, modelId: 'model-abc' },
      'tok',
      { user: 'customer:1', relation: 'airo_app_view', type: 'venture' }
    )

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization-Model-Id': 'model-abc' }),
      })
    )
  })
})
