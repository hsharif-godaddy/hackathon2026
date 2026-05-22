import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SAMPLE = {
  version: 1,
  generatedAt: '2026-05-18T01:30:31.751Z',
  kits: [{
    slug: 'modern-bento',
    whenToUse: 'Use for service businesses...',
    tags: ['modern', 'bright'],
    questions: ['What accent color?'],
    tarball: 'modern-bento-8b105e76c211.tar.gz',
    tarballHash: 'sha256-8b105e76c211',
  }],
}

describe('design-system/catalog', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'design-system-test-'))
    vi.resetModules()
    delete process.env.BRAND_KIT_BASE_URL
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('resolves prod URL by default', async () => {
    const { resolveDesignSystemBaseUrl } = await import('../catalog.js')
    expect(resolveDesignSystemBaseUrl()).toBe('https://blobby.wsimg.com/brand-kits')
  })

  it('BRAND_KIT_BASE_URL overrides default', async () => {
    process.env.BRAND_KIT_BASE_URL = 'http://localhost:9000/brand-kits'
    const { resolveDesignSystemBaseUrl } = await import('../catalog.js')
    expect(resolveDesignSystemBaseUrl()).toBe('http://localhost:9000/brand-kits')
  })

  it('fetchDesignSystemCatalog parses, caches in memory, persists to disk', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const first = await fetchDesignSystemCatalog({ cachePath, ttlMs: 1000 })
    expect(first.kits[0]?.slug).toBe('modern-bento')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(existsSync(cachePath)).toBe(true)

    const second = await fetchDesignSystemCatalog({ cachePath, ttlMs: 1000 })
    expect(second.kits[0]?.slug).toBe('modern-bento')
    expect(fetchMock).toHaveBeenCalledTimes(1) // cached
  })

  it('falls back to disk cache when network fails', async () => {
    const cachePath = join(tmp, 'cat.json')
    const fetchOk = vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE } as Response)
    vi.stubGlobal('fetch', fetchOk)
    const mod = await import('../catalog.js')
    mod._resetCacheForTest()
    await mod.fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })

    mod._resetCacheForTest()
    const fetchFail = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchFail)

    const result = await mod.fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits[0]?.slug).toBe('modern-bento')
  })

  it('rejects payload that fails zod validation', async () => {
    const fetchBad = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1 }) } as Response)
    vi.stubGlobal('fetch', fetchBad)
    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()
    await expect(fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })).rejects.toThrow()
  })
})
