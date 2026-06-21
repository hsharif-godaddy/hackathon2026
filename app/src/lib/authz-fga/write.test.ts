import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthzFgaConfig } from '@/lib/authz-fga/config'
import { writeFgaTuples } from '@/lib/authz-fga/write'

const baseConfig: AuthzFgaConfig = {
  baseUrl: 'https://fga.example.test',
  storeId: 'store-1',
  oauthTokenUrl: 'https://oauth.example.test',
  clientId: 'c',
  clientSecret: 's',
}

const tuple = { user: 'customer:1', relation: 'airo_app_build', object: 'venture:v1' }

describe('authz-fga/write', function authzFgaWrite() {
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

  it('POSTs writes and deletes wrapped in tuple_keys to the store write endpoint', async function writesAndDeletes() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))

    await writeFgaTuples(baseConfig, 'tok', { writes: [tuple], deletes: [tuple] })

    expect(fetch).toHaveBeenCalledWith(
      'https://fga.example.test/stores/store-1/write',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          writes: { tuple_keys: [tuple] },
          deletes: { tuple_keys: [tuple] },
        }),
      })
    )
  })

  it('omits the deletes key when only writes are provided', async function writesOnly() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))

    await writeFgaTuples(baseConfig, 'tok', { writes: [tuple] })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toEqual({ writes: { tuple_keys: [tuple] } })
  })

  it('omits the writes key when only deletes are provided', async function deletesOnly() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))

    await writeFgaTuples(baseConfig, 'tok', { deletes: [tuple] })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toEqual({ deletes: { tuple_keys: [tuple] } })
  })

  it('forwards the model id header when configured', async function modelId() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }))

    await writeFgaTuples({ ...baseConfig, modelId: 'model-abc' }, 'tok', { writes: [tuple] })

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization-Model-Id': 'model-abc' }),
      })
    )
  })

  it('throws on a non-2xx response with a truncated body', async function failure() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'x'.repeat(700) })
    )

    await expect(writeFgaTuples(baseConfig, 'tok', { writes: [tuple] })).rejects.toThrow(
      /authz-fga\.write failed: 500 x+$/
    )
  })

  it('short-circuits without a fetch call when AUTHZ_FGA_LOCAL_MOCK=true', async function localMock() {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await writeFgaTuples(baseConfig, 'tok', { writes: [tuple], deletes: [tuple] })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
