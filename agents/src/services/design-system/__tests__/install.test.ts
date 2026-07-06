import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { create as createTar } from 'tar'
import type { WorkspaceClient } from '../../../workspace/index.js'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { logger } from '../../../logging/index.js'

// --- installDesignKitForApp unit tests ---
// These mock the catalog + workspace deps at module level so we don't need real network/fs.
const mockFetchCatalog = vi.hoisted(() => vi.fn())
const mockCreateForWorkspace = vi.hoisted(() => vi.fn())
const mockInstallDesignSystem = vi.hoisted(() => vi.fn())
const mockResolveBaseUrl = vi.hoisted(() => vi.fn(() => 'https://blobby.wsimg.com/brand-kits'))
const mockMerge = vi.hoisted(() => vi.fn())
const mockUpdateCssRadius = vi.hoisted(() => vi.fn())

vi.mock('../catalog.js', () => ({
  fetchDesignSystemCatalog: mockFetchCatalog,
  resolveDesignSystemBaseUrl: mockResolveBaseUrl,
}))
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}))
vi.mock('../../../database/index.js', () => ({
  AppMetadataRepository: class { merge = mockMerge },
}))
vi.mock('../radius-css.js', () => ({
  updateCssRadius: mockUpdateCssRadius,
}))

const ENTRY = {
  slug: 'modern-bento',
  id: '3e4848a8-912b-44e9-81ba-1cfaf058d458',
  displayName: 'Modern Bento',
  whenToUse: '',
  tags: [],
  questions: [],
  tarball: 'kit.tar.gz',
  tarballHash: 'sha256-abcdef',
}
const mockWorkspaceObj = { workspaceId: 'w', variant: 'preview' as const, files: createStubWorkspaceFiles() }

describe('installDesignKitForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [ENTRY] })
    mockCreateForWorkspace.mockReturnValue(mockWorkspaceObj)
    mockInstallDesignSystem.mockResolvedValue({ slug: 'modern-bento', written: 3 })
  })

  it('returns slug_not_found when slug is absent from catalog', async () => {
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'nonexistent')
    expect(result).toEqual({ error: 'slug_not_found' })
  })

  it('returns workspace_unavailable when workspace cannot be resolved', async () => {
    mockCreateForWorkspace.mockReturnValue(null)
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect(result).toEqual({ error: 'workspace_unavailable' })
  })

  // --- AIROBUILD-2976: deterministic kit radius → --radius ---
  it('writes the kit radius into globals.css when anchor.json carries radius.base', async () => {
    await primeRealInstallWithFiles({
      'colors.md': '# palette',
      'anchor.json': JSON.stringify({ radius: { base: 18 } }),
    })
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(mockUpdateCssRadius).toHaveBeenCalledWith(mockWorkspaceObj.files, 18)
  })

  it('writes radius for a flat kit (radius.base 0) — the guard is !== undefined, not truthiness', async () => {
    await primeRealInstallWithFiles({
      'colors.md': '# palette',
      'anchor.json': JSON.stringify({ radius: { base: 0 } }),
    })
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(mockUpdateCssRadius).toHaveBeenCalledWith(mockWorkspaceObj.files, 0)
  })

  it('does not write radius when the kit ships no anchor radius', async () => {
    await primeRealInstall() // tarball has no anchor.json
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'modern-bento')
    expect(mockUpdateCssRadius).not.toHaveBeenCalled()
  })

  // --- AIROBUILD-2845 I2: bounded retry for TRANSIENT install failures ---
  it('retries once when the workspace is briefly unavailable, then succeeds (transient race)', async () => {
    await primeRealInstall()
    // First bind returns null (supervisor not registered yet); the retry binds successfully.
    mockCreateForWorkspace.mockReturnValueOnce(null)
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(mockCreateForWorkspace).toHaveBeenCalledTimes(2)
    // Side effects must run exactly once across the retry (no double metadata stamp).
    expect(mockMerge).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient download failure (5xx), then succeeds', async () => {
    const tarPath = join(tmpdir(), `dl-retry-${Date.now()}.tar.gz`)
    const tarBuf = await makeTarball(tarPath, { 'colors.md': '# palette' })
    rmSync(tarPath, { force: true })
    const hash = createHash('sha256').update(tarBuf).digest('hex')
    mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [{ ...ENTRY, tarballHash: `sha256-${hash}` }] })
    const okResponse = { ok: true, arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength) } as unknown as Response
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response).mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchSpy)
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries once on a transient network failure (fetch rejects with no HTTP status), then succeeds', async () => {
    const tarPath = join(tmpdir(), `net-retry-${Date.now()}.tar.gz`)
    const tarBuf = await makeTarball(tarPath, { 'colors.md': '# palette' })
    rmSync(tarPath, { force: true })
    const hash = createHash('sha256').update(tarBuf).digest('hex')
    mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [{ ...ENTRY, tarballHash: `sha256-${hash}` }] })
    const okResponse = { ok: true, arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength) } as unknown as Response
    // First call: a socket-level rejection (DNS/reset/TLS) — a TypeError with no status. Second: success.
    const fetchSpy = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchSpy)
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries once when the body stream is reset mid-download (arrayBuffer rejects), then succeeds', async () => {
    const tarPath = join(tmpdir(), `body-retry-${Date.now()}.tar.gz`)
    const tarBuf = await makeTarball(tarPath, { 'colors.md': '# palette' })
    rmSync(tarPath, { force: true })
    const hash = createHash('sha256').update(tarBuf).digest('hex')
    mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [{ ...ENTRY, tarballHash: `sha256-${hash}` }] })
    // First response: headers OK but the body read rejects (undici "terminated"). Second: clean.
    const brokenBody = { ok: true, arrayBuffer: async () => { throw new TypeError('terminated') } } as unknown as Response
    const okResponse = { ok: true, arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength) } as unknown as Response
    const fetchSpy = vi.fn().mockResolvedValueOnce(brokenBody).mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchSpy)
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry slug_not_found (deterministic; never touches the workspace)', async () => {
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'nonexistent-slug')
    expect(result).toEqual({ error: 'slug_not_found' })
    expect(mockCreateForWorkspace).not.toHaveBeenCalled()
  })

  it('does not retry a deterministic hash mismatch (fetches exactly once)', async () => {
    const tarPath = join(tmpdir(), `hash-${Date.now()}.tar.gz`)
    const tarBuf = await makeTarball(tarPath, { 'colors.md': '# palette' })
    rmSync(tarPath, { force: true })
    mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [{ ...ENTRY, tarballHash: `sha256-${'f'.repeat(64)}` }] })
    const okResponse = { ok: true, arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength) } as unknown as Response
    const fetchSpy = vi.fn().mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchSpy)
    const { installDesignKitForApp } = await import('../install.js')
    await expect(installDesignKitForApp('app1', 'modern-bento')).rejects.toThrow(/hash mismatch/i)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('happy path: returns slug, written, and the canonical success message', async () => {
    await primeRealInstall()
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.slug).toBe('modern-bento')
    expect(result.written).toBe(3)
    expect(result.message).toContain('modern-bento')
    expect(result.message).toContain('loadUiKit')
    expect(result.message).toContain('3 files extracted')
    const metaUpload = mockWorkspaceObj.files.upload.mock.calls.find(
      ([opts]: [{ path: string; data: Buffer }]) => opts.path === 'docs/ui-kit/kit-meta.json',
    )
    expect(metaUpload).toBeDefined()
    expect(JSON.parse(metaUpload![0].data.toString('utf-8'))).toEqual({
      id: '3e4848a8-912b-44e9-81ba-1cfaf058d458',
      slug: 'modern-bento',
      displayName: 'Modern Bento',
    })
  })

  // Resolution is case-insensitive across id/slug/displayName — `slug` casing now
  // tracks `displayName` (e.g. "Terra"), so an exact slug match is brittle.
  it('resolves the entry case-insensitively (catalog slug "Terra", input "terra")', async () => {
    await primeRealInstall({ slug: 'Terra', id: 'e3979a61-4a99-4e30-8169-ffe06c73a1bc', displayName: 'Terra' })
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'terra')
    expect('error' in result).toBe(false)
  })

  it('resolves by id when the input is the catalog id', async () => {
    await primeRealInstall()
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', ENTRY.id)
    expect('error' in result).toBe(false)
  })

  it('resolves by displayName when the input is the human label', async () => {
    await primeRealInstall()
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern bento')
    expect('error' in result).toBe(false)
  })

  it('stamps the matched entry id + displayName (no kitId when the entry lacks one)', async () => {
    await primeRealInstall()
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'modern-bento')
    expect(mockMerge).toHaveBeenCalledTimes(1)
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: { source: 'catalog', id: '3e4848a8-912b-44e9-81ba-1cfaf058d458', displayName: 'Modern Bento' },
    })
  })

  it('stamps kitId too when the matched entry has one', async () => {
    await primeRealInstall({
      slug: 'Bordeaux',
      id: '98f856d5-5851-4d96-ac29-7e4f65273540',
      displayName: 'Bordeaux',
      kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
    })
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'Bordeaux')
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: {
        source: 'catalog',
        id: '98f856d5-5851-4d96-ac29-7e4f65273540',
        displayName: 'Bordeaux',
        kitId: '1ad2586d-f5bf-4ef5-8ac6-f7e5f5c5c3d9',
      },
    })
  })

  // AIROBUILD-3232 item 7: the stamp also carries the kit's shape tokens (from
  // anchor.json), preview screenshot path, and palette so the website-build animation
  // can mirror the kit. All guarded — a kit without them stamps the identity alone.
  it('stamps tokens and previewPath when the kit carries them', async () => {
    await primeRealInstallWithFiles(
      {
        'colors.md': '# palette',
        'anchor.json': JSON.stringify({
          radius: { base: 12, subtle: 4 },
          shadow: { rest: 'none' },
          buttons: { primary: 'DM Sans 700, UPPERCASE, 0.12em tracking' },
        }),
      },
      {
        images: { preview: 'previews/modern-bento/abc.webp' },
      },
    )
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'modern-bento')
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: {
        source: 'catalog',
        id: '3e4848a8-912b-44e9-81ba-1cfaf058d458',
        displayName: 'Modern Bento',
        tokens: { radiusBase: 12, radiusButton: 4, flat: true, uppercase: true, tracking: '0.12em' },
        previewPath: 'previews/modern-bento/abc.webp',
      },
    })
  })

  // Many catalog entries (e.g. Ascent) ship only a thumbnail, no full preview — the
  // stamp falls back to it so the build animation still gets a real kit screenshot.
  it('falls back to the kit thumbnail for previewPath when there is no preview image', async () => {
    await primeRealInstallWithFiles({ 'colors.md': '# palette' }, { thumbnail: 'thumbnails/ascent/xyz.png' })
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'modern-bento')
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: expect.objectContaining({ previewPath: 'thumbnails/ascent/xyz.png' }),
    })
  })

  // Third fallback: some entries carry the thumbnail nested under `images` rather than at
  // the top level — the stamp still finds it (entry.images.preview → entry.thumbnail →
  // entry.images.thumbnail).
  it('falls back to entry.images.thumbnail when there is no preview or top-level thumbnail', async () => {
    await primeRealInstallWithFiles({ 'colors.md': '# palette' }, { images: { thumbnail: 'thumbnails/ascent/nested.png' } })
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'modern-bento')
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: expect.objectContaining({ previewPath: 'thumbnails/ascent/nested.png' }),
    })
  })

  it('never stamps when the install fails (slug not found)', async () => {
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'nonexistent')
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('still returns success when metadata stamping throws (best-effort)', async () => {
    mockMerge.mockImplementationOnce(() => { throw new Error('db down') })
    await primeRealInstall()
    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'modern-bento')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.message).toContain('loadUiKit')
  })

  it('resolves by field precedence (id beats displayName) regardless of catalog order, and warns', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    // Ambiguous catalog: kit B's displayName collides with kit A's id ("collide").
    // The id-matching kit (A) must win even though kit B is listed first.
    const kitA = { id: 'collide', slug: 'kit-a', displayName: 'Kit A' }
    const kitB = { id: 'kit-b-id', slug: 'kit-b', displayName: 'Collide' }
    await primeRealInstall(kitA, [kitB])

    const { installDesignKitForApp } = await import('../install.js')
    const result = await installDesignKitForApp('app1', 'collide')

    expect('error' in result).toBe(false)
    // id match (kit A) wins over the displayName match (kit B), not array order.
    expect(mockMerge).toHaveBeenCalledWith('app1', {
      designKit: { source: 'catalog', id: 'collide', displayName: 'Kit A' },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'design_system.install.ambiguous_match',
      expect.objectContaining({ needle: 'collide', chosenId: 'collide' }),
    )
    warnSpy.mockRestore()
  })

  it('does not warn on a single kit whose slug equals its displayName', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    await primeRealInstall({ id: 'terra-id', slug: 'Terra', displayName: 'Terra' })
    const { installDesignKitForApp } = await import('../install.js')
    await installDesignKitForApp('app1', 'terra')
    expect(warnSpy).not.toHaveBeenCalledWith('design_system.install.ambiguous_match', expect.anything())
    warnSpy.mockRestore()
  })
})

// Build a real minimal tarball + fetch stub + catalog entry so installDesignSystem
// can extract it. Returns the catalog entry (with the computed hash) for assertions.
// `extraKits` are prepended to the catalog (sharing the same tarball/hash) so a test
// can prove field-precedence wins over catalog array order.
async function primeRealInstall(
  entryOverride: Record<string, unknown> = {},
  extraKits: Array<Record<string, unknown>> = [],
): Promise<Record<string, unknown>> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'install-kit-app-'))
  const tarPath = join(tmpDir, 'kit.tar.gz')
  const tarBuf = await makeTarball(tarPath, { 'colors.md': '# palette', 'button.md': '# button' })
  const hash = createHash('sha256').update(tarBuf).digest('hex')
  rmSync(tmpDir, { recursive: true, force: true })

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength),
  } as unknown as Response))

  const entry = { ...ENTRY, ...entryOverride, tarballHash: `sha256-${hash}` }
  const extras = extraKits.map(k => ({ ...ENTRY, ...k, tarball: 'kit.tar.gz', tarballHash: `sha256-${hash}` }))
  mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [...extras, entry] })
  return entry
}

/** Like primeRealInstall but with a caller-supplied file set (e.g. to inject an anchor.json).
 * `entryOverride` lets a test attach catalog-entry fields (e.g. `images.preview`,
 * `design.palette`) that the stamp reads alongside the anchor-derived tokens. */
async function primeRealInstallWithFiles(
  files: Record<string, string>,
  entryOverride: Record<string, unknown> = {},
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'install-kit-files-'))
  const tarPath = join(tmpDir, 'kit.tar.gz')
  const tarBuf = await makeTarball(tarPath, files)
  const hash = createHash('sha256').update(tarBuf).digest('hex')
  rmSync(tmpDir, { recursive: true, force: true })

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength),
  } as unknown as Response))

  mockFetchCatalog.mockResolvedValue({ version: 1, generatedAt: '', kits: [{ ...ENTRY, ...entryOverride, tarballHash: `sha256-${hash}` }] })
}

async function makeTarball(targetTar: string, files: Record<string, string>): Promise<Buffer> {
  const stagingDir = mkdtempSync(join(tmpdir(), 'tarball-stage-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(stagingDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  await createTar({ cwd: stagingDir, file: targetTar, gzip: true }, Object.keys(files))
  rmSync(stagingDir, { recursive: true, force: true })
  return readFileSync(targetTar)
}

function createMockWorkspace(): { workspace: WorkspaceClient; uploads: Map<string, Buffer> } {
  const uploads = new Map<string, Buffer>()
  const workspace = {
    workspaceId: 'test-workspace',
    variant: 'preview' as const,
    files: createStubWorkspaceFiles({
      upload: vi.fn().mockImplementation(async (opts: { path: string; data: Buffer }) => {
        uploads.set(opts.path, opts.data)
        return { bytesWritten: opts.data.length }
      }),
    }),
  } as unknown as WorkspaceClient
  return { workspace, uploads }
}

describe('design-system/install', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'design-system-install-'))
    vi.resetModules()
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('downloads, verifies sha256, uploads to workspace under docs/ui-kit/', async () => {
    const tarPath = join(tmp, 'kit.tar.gz')
    const buf = await makeTarball(tarPath, {
      'kit-meta.json': '{"slug":"modern-bento"}',
      'primitives/colors.md': '# colors',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    const result = await installDesignSystem({
      workspace,
      entry: {
        id: 'kit-modern-bento',
        slug: 'modern-bento',
        displayName: 'Modern Bento',
        whenToUse: '',
        tags: [],
        questions: ['Q1?'],
        tarball: 'kit.tar.gz',
        tarballHash: `sha256-${hash}`,
      },
      baseUrl: 'http://example/brand-kits',
    })

    expect(result.slug).toBe('modern-bento')
    expect(result.written).toBe(2)
    expect(uploads.has('docs/ui-kit/kit-meta.json')).toBe(true)
    expect(uploads.get('docs/ui-kit/kit-meta.json')?.toString()).toBe('{"slug":"modern-bento"}')
    expect(uploads.has('docs/ui-kit/primitives/colors.md')).toBe(true)
    expect(uploads.get('docs/ui-kit/primitives/colors.md')?.toString()).toBe('# colors')
  })

  it('synthesizes kit-meta.json from the catalog entry when the tarball omits it', async () => {
    // AIROBUILD-2696 AC8: docs/ui-kit/kit-meta.json is the per-turn artifact signal;
    // catalog installs must guarantee it even when the tarball lacks the file.
    const tarPath = join(tmp, 'kit-no-meta.tar.gz')
    const buf = await makeTarball(tarPath, {
      'primitives/colors.md': '# colors',
      'components/button.md': '# button',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    const result = await installDesignSystem({
      workspace,
      entry: {
        id: 'kit-id-123',
        slug: 'modern-bento',
        displayName: 'Modern Bento',
        whenToUse: '',
        tags: [],
        questions: [],
        tarball: 'kit-no-meta.tar.gz',
        tarballHash: `sha256-${hash}`,
      },
      baseUrl: 'http://example/brand-kits',
    })

    expect(result.written).toBe(3)
    expect(uploads.get('docs/ui-kit/kit-meta.json')).toBeDefined()
    expect(JSON.parse(uploads.get('docs/ui-kit/kit-meta.json')!.toString('utf-8'))).toEqual({
      id: 'kit-id-123',
      slug: 'modern-bento',
      displayName: 'Modern Bento',
    })
  })

  it('rejects on hash mismatch', async () => {
    const tarPath = join(tmp, 'kit.tar.gz')
    const buf = await makeTarball(tarPath, { 'kit-meta.json': '{}' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    await expect(installDesignSystem({
      workspace,
      entry: {
        id: 'kit-x', slug: 'x', displayName: 'X', whenToUse: '', tags: [], questions: [],
        tarball: 'kit.tar.gz', tarballHash: 'sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      baseUrl: 'http://example/brand-kits',
    })).rejects.toThrow(/hash/i)
    expect(uploads.size).toBe(0)
  })

  it('filters out ../ traversal entries from tarball', async () => {
    const tarPath = join(tmp, 'traversal.tar.gz')
    const buf = await makeTarball(tarPath, {
      'safe.md': 'safe content',
      '../escape.md': 'escaped!',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      workspace,
      entry: { id: 'kit-s', slug: 's', displayName: 'S', whenToUse: '', tags: [], questions: [], tarball: 'traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(2)
    expect(uploads.has('docs/ui-kit/safe.md')).toBe(true)
    // Traversal entry should NOT have been uploaded
    expect([...uploads.keys()].some(k => k.includes('escape'))).toBe(false)
  })

  it('filters out nested ../ traversal entries', async () => {
    const tarPath = join(tmp, 'nested-traversal.tar.gz')
    const buf = await makeTarball(tarPath, {
      'ok.md': 'ok',
      'sub/../../escape.md': 'escaped!',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      workspace,
      entry: { id: 'kit-s', slug: 's', displayName: 'S', whenToUse: '', tags: [], questions: [], tarball: 'nested-traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(2)
    expect(uploads.has('docs/ui-kit/ok.md')).toBe(true)
  })

  it('flattens kits/<uuid>/ prefix on extraction', async () => {
    const tarPath = join(tmp, 'nested.tar.gz')
    const buf = await makeTarball(tarPath, {
      'kits/abc123-def456/primitives/colors.md': '# palette',
      'kits/abc123-def456/components/button.md': '# button',
      'kits/abc123-def456/kit-meta.json': '{"slug":"test"}',
    })
    const hash = createHash('sha256').update(buf).digest('hex')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const { workspace, uploads } = createMockWorkspace()

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      workspace,
      entry: { id: 'kit-test', slug: 'test', displayName: 'Test', whenToUse: '', tags: [], questions: [], tarball: 'nested.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(3)
    expect(uploads.has('docs/ui-kit/primitives/colors.md')).toBe(true)
    expect(uploads.has('docs/ui-kit/components/button.md')).toBe(true)
    expect(uploads.has('docs/ui-kit/kit-meta.json')).toBe(true)
    // Should NOT have the kits/ nesting
    expect([...uploads.keys()].some(k => k.includes('kits/'))).toBe(false)
  })

  // --- AIROBUILD-2845 I1: kit-meta.json is a completeness barrier (upload last) ---
  it('does not upload kit-meta.json when a content-file upload fails (no partial-kit signal)', async () => {
    // Class C: kit-meta.json is the per-turn "kit installed" signal the swap gate trusts. If
    // content files fail to upload, kit-meta must NOT land — otherwise the agent swaps to the
    // tool-less -attached variant on an empty/partial kit. Reproduce by failing primitives/*
    // uploads while letting every other upload (incl. kit-meta) succeed.
    const tarPath = join(tmp, 'partial.tar.gz')
    const buf = await makeTarball(tarPath, {
      'primitives/colors.md': '# palette',
      'components/button.md': '# button',
    })
    const hash = createHash('sha256').update(buf).digest('hex')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const uploads = new Map<string, Buffer>()
    const workspace = {
      workspaceId: 'test-workspace',
      variant: 'preview' as const,
      files: createStubWorkspaceFiles({
        upload: vi.fn().mockImplementation(async (opts: { path: string; data: Buffer }) => {
          if (opts.path.includes('/primitives/')) throw new Error('upload failed (simulated transient)')
          uploads.set(opts.path, opts.data)
          return { bytesWritten: opts.data.length }
        }),
      }),
    } as unknown as WorkspaceClient

    const { installDesignSystem } = await import('../install.js')
    await expect(installDesignSystem({
      workspace,
      entry: { id: 'kit-x', slug: 'modern-bento', displayName: 'Modern Bento', whenToUse: '', tags: [], questions: [], tarball: 'partial.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })).rejects.toThrow()
    // The barrier: kit-meta.json must not have been written when content upload failed.
    expect(uploads.has('docs/ui-kit/kit-meta.json')).toBe(false)
  })
})
