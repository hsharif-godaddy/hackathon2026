import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }))
vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() },
}))

const SAMPLE = {
  version: 1,
  generatedAt: '2026-05-18T01:30:31.751Z',
  kits: [{
    slug: 'modern-bento',
    id: '3e4848a8-912b-44e9-81ba-1cfaf058d458',
    displayName: 'Modern Bento',
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
    warnSpy.mockClear()
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

  it('preserves id/displayName/kitId through parse, and tolerates a missing kitId', async () => {
    const withIds = {
      version: 1,
      generatedAt: '2026-06-13T06:28:21.764Z',
      kits: [
        {
          ...SAMPLE.kits[0],
          slug: 'Bordeaux',
          id: '98f856d5-5851-4d96-ac29-7e4f65273540',
          displayName: 'Bordeaux',
          kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
        },
        SAMPLE.kits[0], // slug-style kit with id + displayName but no kitId
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => withIds } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const result = await fetchDesignSystemCatalog({ cachePath, ttlMs: 1000 })
    expect(result.kits[0]?.id).toBe('98f856d5-5851-4d96-ac29-7e4f65273540')
    expect(result.kits[0]?.displayName).toBe('Bordeaux')
    expect(result.kits[0]?.kitId).toBe('1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9')
    expect(result.kits[1]?.id).toBe('3e4848a8-912b-44e9-81ba-1cfaf058d458')
    expect(result.kits[1]?.kitId).toBeUndefined()
  })

  it('drops a malformed kit (missing required id) but keeps valid ones', async () => {
    const { id: _omit, ...noId } = SAMPLE.kits[0]
    const good = { ...SAMPLE.kits[0], slug: 'keeper', id: 'keeper-id', displayName: 'Keeper' }
    const fetchMixed = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, generatedAt: 'x', kits: [noId, good] }),
    } as Response)
    vi.stubGlobal('fetch', fetchMixed)
    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const result = await fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits).toHaveLength(1)
    expect(result.kits[0]?.slug).toBe('keeper')
    // the dropped entry is logged with its slug so the bad kit is traceable
    expect(warnSpy).toHaveBeenCalledWith(
      'design_system.catalog.entry_dropped',
      expect.objectContaining({ slug: 'modern-bento' })
    )
  })

  it('drops a kit with an empty-string displayName, keeping the valid one', async () => {
    const noName = { ...SAMPLE.kits[0], slug: 'nameless', displayName: '' }
    const fetchMixed = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, generatedAt: 'x', kits: [noName, SAMPLE.kits[0]] }),
    } as Response)
    vi.stubGlobal('fetch', fetchMixed)
    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const result = await fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits.map(k => k.slug)).toEqual(['modern-bento'])
    expect(warnSpy).toHaveBeenCalledWith(
      'design_system.catalog.entry_dropped',
      expect.objectContaining({ slug: 'nameless' })
    )
  })

  it('drops a kit with an empty-string id (.min(1)), keeping the valid one', async () => {
    const empty = { ...SAMPLE.kits[0], slug: 'empty', id: '', displayName: 'Empty' }
    const fetchMixed = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 1, generatedAt: 'x', kits: [empty, SAMPLE.kits[0]] }),
    } as Response)
    vi.stubGlobal('fetch', fetchMixed)
    const cachePath = join(tmp, 'cat.json')
    const { fetchDesignSystemCatalog, _resetCacheForTest } = await import('../catalog.js')
    _resetCacheForTest()

    const result = await fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits.map(k => k.slug)).toEqual(['modern-bento'])
  })

  it('id/kitId survive the disk-cache write → read → reparse round-trip', async () => {
    const withIds = {
      version: 1,
      generatedAt: 'x',
      kits: [{
        ...SAMPLE.kits[0],
        id: '98f856d5-5851-4d96-ac29-7e4f65273540',
        kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
      }],
    }
    const cachePath = join(tmp, 'cat.json')
    const fetchOk = vi.fn().mockResolvedValue({ ok: true, json: async () => withIds } as Response)
    vi.stubGlobal('fetch', fetchOk)
    const mod = await import('../catalog.js')
    mod._resetCacheForTest()
    await mod.fetchDesignSystemCatalog({ cachePath, ttlMs: 0 }) // persists to disk

    // network fails → forces the disk-cache reparse path
    mod._resetCacheForTest()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await mod.fetchDesignSystemCatalog({ cachePath, ttlMs: 0 })
    expect(result.kits[0]?.id).toBe('98f856d5-5851-4d96-ac29-7e4f65273540')
    expect(result.kits[0]?.kitId).toBe('1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9')
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
