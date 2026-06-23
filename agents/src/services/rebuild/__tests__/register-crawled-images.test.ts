import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { AssetInfo, AssetManifest } from '../../../types/rebuild.js'
import type { FileUploadService } from '../../FileUploadService.js'
import { CRAWLED_SOURCE_UPLOAD_ID, registerCrawledImagesAsUploads } from '../register-crawled-images.js'

describe('registerCrawledImagesAsUploads', () => {
  const appPath = '/tmp/test-register-crawled-images-app'
  const manifestPath = path.join(appPath, '.source-site', 'assets', 'manifest.json')

  function makeService(): FileUploadService & { registerLocalFilesAsUpload: ReturnType<typeof vi.fn> } {
    const registerLocalFilesAsUpload = vi.fn().mockResolvedValue({
      uploadId: CRAWLED_SOURCE_UPLOAD_ID,
      appId: 'app1',
      files: [],
      failedFiles: []
    })
    return { registerLocalFilesAsUpload } as unknown as FileUploadService & {
      registerLocalFilesAsUpload: ReturnType<typeof vi.fn>
    }
  }

  async function writeManifest(assets: AssetInfo[]): Promise<void> {
    await mkdir(path.dirname(manifestPath), { recursive: true })
    const manifest: AssetManifest = {
      assets,
      totalAssets: assets.length,
      byType: { image: assets.filter((a) => a.type === 'image').length, font: 0, icon: 0, other: 0 },
      generatedAt: '2026-06-08T00:00:00.000Z'
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
  }

  function asset(partial: Partial<AssetInfo>): AssetInfo {
    return {
      url: 'https://example.com/img.png',
      localPath: '.source-site/assets/images/hash.png',
      type: 'image',
      sourcePages: [],
      ...partial
    }
  }

  beforeEach(async () => {
    if (existsSync(appPath)) await rm(appPath, { recursive: true, force: true })
  })

  afterEach(async () => {
    if (existsSync(appPath)) await rm(appPath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('no-ops when the manifest is missing', async () => {
    const service = makeService()
    await registerCrawledImagesAsUploads('app1', appPath, service)
    expect(service.registerLocalFilesAsUpload).not.toHaveBeenCalled()
  })

  it('no-ops when the manifest is unparseable', async () => {
    await mkdir(path.dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, '{not json')
    const service = makeService()
    await registerCrawledImagesAsUploads('app1', appPath, service)
    expect(service.registerLocalFilesAsUpload).not.toHaveBeenCalled()
  })

  it('registers only image assets (filters fonts/icons/other)', async () => {
    await writeManifest([
      asset({ type: 'image', localPath: '.source-site/assets/images/a.png' }),
      asset({ type: 'font', localPath: '.source-site/assets/other/b.woff2' }),
      asset({ type: 'icon', localPath: '.source-site/assets/other/c.ico' }),
      asset({ type: 'other', localPath: '.source-site/assets/other/d.bin' })
    ])
    const service = makeService()
    await registerCrawledImagesAsUploads('app1', appPath, service)

    expect(service.registerLocalFilesAsUpload).toHaveBeenCalledTimes(1)
    const [appId, files, opts] = service.registerLocalFilesAsUpload.mock.calls[0]
    expect(appId).toBe('app1')
    expect(files).toHaveLength(1)
    expect(opts).toEqual({ uploadId: CRAWLED_SOURCE_UPLOAD_ID, source: 'crawled' })
  })

  it('no-ops when there are no image assets', async () => {
    await writeManifest([asset({ type: 'font', localPath: '.source-site/assets/other/b.woff2' })])
    const service = makeService()
    await registerCrawledImagesAsUploads('app1', appPath, service)
    expect(service.registerLocalFilesAsUpload).not.toHaveBeenCalled()
  })

  it('maps absoluteSourcePath, size, and originalName correctly', async () => {
    await writeManifest([
      // 1. originalName from URL basename
      asset({
        url: 'https://example.com/photos/hero-banner.jpg?w=1200',
        localPath: '.source-site/assets/images/aaa.jpg',
        fileSize: 4321
      }),
      // 2. URL has no usable basename → slugified altText + on-disk ext
      asset({
        url: 'https://cdn.example.com/',
        altText: 'Our Friendly Team!',
        localPath: '.source-site/assets/images/bbb.png'
      }),
      // 3. no URL basename, no altText → on-disk basename
      asset({
        url: 'https://cdn.example.com/',
        localPath: '.source-site/assets/images/ccc.webp'
      })
    ])
    const service = makeService()
    await registerCrawledImagesAsUploads('app1', appPath, service)

    const files = service.registerLocalFilesAsUpload.mock.calls[0][1]
    expect(files[0]).toEqual({
      absoluteSourcePath: path.join(appPath, '.source-site/assets/images/aaa.jpg'),
      originalName: 'hero-banner.jpg',
      mimeType: null,
      size: 4321
    })
    expect(files[1].originalName).toBe('our-friendly-team.png')
    expect(files[2].originalName).toBe('ccc.webp')
  })

  it('never throws when the upload service fails', async () => {
    await writeManifest([asset({ type: 'image' })])
    const service = makeService()
    service.registerLocalFilesAsUpload.mockRejectedValue(new Error('disk full'))
    await expect(registerCrawledImagesAsUploads('app1', appPath, service)).resolves.toBeUndefined()
  })

  it('never throws when an image entry has a malformed localPath', async () => {
    // A non-string localPath makes path.join / deriveOriginalName throw while
    // building the file list — that must not escape this best-effort helper
    // (otherwise it could mask a scrape error in ScrapePipeline.run's finally).
    await writeManifest([asset({ localPath: undefined as unknown as string })])
    const service = makeService()
    await expect(registerCrawledImagesAsUploads('app1', appPath, service)).resolves.toBeUndefined()
    expect(service.registerLocalFilesAsUpload).not.toHaveBeenCalled()
  })
})
