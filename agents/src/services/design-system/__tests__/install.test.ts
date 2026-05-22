import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { create as createTar } from 'tar'

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

  it('downloads, verifies sha256, extracts under docs/ui-kit/', async () => {
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

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installDesignSystem } = await import('../install.js')
    const result = await installDesignSystem({
      appPath,
      entry: {
        slug: 'modern-bento',
        whenToUse: '',
        tags: [],
        questions: ['Q1?'],
        tarball: 'kit.tar.gz',
        tarballHash: `sha256-${hash}`,
      },
      baseUrl: 'http://example/brand-kits',
    })

    expect(result.slug).toBe('modern-bento')
    expect(result.written).toBeGreaterThan(0)
    expect(existsSync(join(appPath, 'docs/ui-kit/kit-meta.json'))).toBe(true)
    expect(existsSync(join(appPath, 'docs/ui-kit/primitives/colors.md'))).toBe(true)
  })

  it('rejects on hash mismatch', async () => {
    const tarPath = join(tmp, 'kit.tar.gz')
    const buf = await makeTarball(tarPath, { 'kit-meta.json': '{}' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response))

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })
    const { installDesignSystem } = await import('../install.js')
    await expect(installDesignSystem({
      appPath,
      entry: {
        slug: 'x', whenToUse: '', tags: [], questions: [],
        tarball: 'kit.tar.gz', tarballHash: 'sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      baseUrl: 'http://example/brand-kits',
    })).rejects.toThrow(/hash/i)
    expect(existsSync(join(appPath, 'docs/ui-kit'))).toBe(false)
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

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      appPath,
      entry: { slug: 's', whenToUse: '', tags: [], tarball: 'traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(1)
    expect(existsSync(join(appPath, 'docs/ui-kit/safe.md'))).toBe(true)
    expect(existsSync(join(appPath, '../escape.md'))).toBe(false)
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

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      appPath,
      entry: { slug: 's', whenToUse: '', tags: [], tarball: 'nested-traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(1)
    expect(existsSync(join(appPath, 'docs/ui-kit/ok.md'))).toBe(true)
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

    const appPath = join(tmp, 'app')
    mkdirSync(appPath, { recursive: true })

    const { installDesignSystem } = await import('../install.js')
    const r = await installDesignSystem({
      appPath,
      entry: { slug: 'test', whenToUse: '', tags: [], tarball: 'nested.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(3)
    expect(existsSync(join(appPath, 'docs/ui-kit/primitives/colors.md'))).toBe(true)
    expect(existsSync(join(appPath, 'docs/ui-kit/components/button.md'))).toBe(true)
    expect(existsSync(join(appPath, 'docs/ui-kit/kit-meta.json'))).toBe(true)
    // Should NOT have the kits/ nesting
    expect(existsSync(join(appPath, 'docs/ui-kit/kits'))).toBe(false)
  })
})
