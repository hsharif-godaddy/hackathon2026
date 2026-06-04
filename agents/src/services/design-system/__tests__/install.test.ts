import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { create as createTar } from 'tar'
import type { WorkspaceClient } from '../../../workspace/index.js'

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
    files: {
      upload: vi.fn().mockImplementation(async (opts: { path: string; data: Buffer }) => {
        uploads.set(opts.path, opts.data)
        return { bytesWritten: opts.data.length }
      }),
    },
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
    expect(result.written).toBe(2)
    expect(uploads.has('docs/ui-kit/kit-meta.json')).toBe(true)
    expect(uploads.has('docs/ui-kit/primitives/colors.md')).toBe(true)
    expect(uploads.get('docs/ui-kit/primitives/colors.md')?.toString()).toBe('# colors')
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
        slug: 'x', whenToUse: '', tags: [], questions: [],
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
      entry: { slug: 's', whenToUse: '', tags: [], tarball: 'traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(1)
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
      entry: { slug: 's', whenToUse: '', tags: [], tarball: 'nested-traversal.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(1)
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
      entry: { slug: 'test', whenToUse: '', tags: [], tarball: 'nested.tar.gz', tarballHash: `sha256-${hash}` },
      baseUrl: 'http://example/brand-kits',
    })
    expect(r.written).toBe(3)
    expect(uploads.has('docs/ui-kit/primitives/colors.md')).toBe(true)
    expect(uploads.has('docs/ui-kit/components/button.md')).toBe(true)
    expect(uploads.has('docs/ui-kit/kit-meta.json')).toBe(true)
    // Should NOT have the kits/ nesting
    expect([...uploads.keys()].some(k => k.includes('kits/'))).toBe(false)
  })
})
