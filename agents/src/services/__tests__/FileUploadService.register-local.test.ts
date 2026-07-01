import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { FileUploadService, type LocalFileToRegister } from '../FileUploadService.js'

/**
 * Tests for registerLocalFilesAsUpload — the rebuild path that surfaces crawled
 * source-site images as uploads in the Media tab.
 */
describe('FileUploadService.registerLocalFilesAsUpload', () => {
  const uploadsDir = '/tmp/test-uploads-register-local'
  const sourceDir = '/tmp/test-source-register-local'
  let service: FileUploadService

  async function writeSource(filename: string, content: string | Buffer): Promise<string> {
    const p = path.join(sourceDir, filename)
    await writeFile(p, content)
    return p
  }

  beforeEach(async () => {
    for (const d of [uploadsDir, sourceDir]) {
      if (existsSync(d)) await rm(d, { recursive: true, force: true })
    }
    await mkdir(sourceDir, { recursive: true })
    service = new FileUploadService(uploadsDir)
  })

  afterEach(async () => {
    for (const d of [uploadsDir, sourceDir]) {
      if (existsSync(d)) await rm(d, { recursive: true, force: true })
    }
  })

  it('registers files and lists them with the source marker', async () => {
    const src = await writeSource('abc123.png', Buffer.from('fake-png-bytes'))
    const files: LocalFileToRegister[] = [
      { absoluteSourcePath: src, originalName: 'hero.png', mimeType: 'image/png' }
    ]

    const result = await service.registerLocalFilesAsUpload('app1', files, {
      uploadId: 'crawled-source',
      source: 'crawled'
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      originalName: 'hero.png',
      filename: 'abc123.png',
      mimeType: 'image/png',
      source: 'crawled'
    })

    const listed = await service.listUploadedFiles('app1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.filename).toBe('abc123.png')
    expect(listed[0]?.source).toBe('crawled')

    // File physically present at the served path.
    const onDisk = service.getFilePath('app1', 'crawled-source', 'abc123.png')
    expect(existsSync(onDisk)).toBe(true)
  })

  it('derives mimeType from the extension when not provided', async () => {
    const src = await writeSource('photo.jpg', Buffer.from('jpeg'))
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      [{ absoluteSourcePath: src, originalName: 'photo.jpg', mimeType: null }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files[0]?.mimeType).toBe('image/jpeg')
  })

  it('is idempotent — re-running yields a single batch with no duplicates', async () => {
    const src = await writeSource('stable-hash.png', Buffer.from('png'))
    const files: LocalFileToRegister[] = [
      { absoluteSourcePath: src, originalName: 'logo.png', mimeType: 'image/png' }
    ]

    await service.registerLocalFilesAsUpload('app1', files, { uploadId: 'crawled-source', source: 'crawled' })
    await service.registerLocalFilesAsUpload('app1', files, { uploadId: 'crawled-source', source: 'crawled' })

    const listed = await service.listUploadedFiles('app1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.filename).toBe('stable-hash.png')
  })

  it('skips empty files but registers siblings (unlike multipart validateUpload)', async () => {
    const empty = await writeSource('empty.png', Buffer.alloc(0))
    const present = await writeSource('present.png', Buffer.from('png'))
    const files: LocalFileToRegister[] = [
      { absoluteSourcePath: empty, originalName: 'empty.png', mimeType: 'image/png' },
      { absoluteSourcePath: present, originalName: 'present.png', mimeType: 'image/png' },
    ]

    const result = await service.registerLocalFilesAsUpload('app1', files, {
      uploadId: 'crawled-source',
      source: 'crawled',
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.filename).toBe('present.png')
    expect(result.failedFiles).toHaveLength(1)
    expect(result.failedFiles[0]?.originalName).toBe('empty.png')
    expect(result.failedFiles[0]?.error).toMatch(/File is empty/)
  })

  it('skips missing source files but registers the rest', async () => {
    const present = await writeSource('present.png', Buffer.from('png'))
    const files: LocalFileToRegister[] = [
      { absoluteSourcePath: present, originalName: 'present.png', mimeType: 'image/png' },
      { absoluteSourcePath: path.join(sourceDir, 'gone.png'), originalName: 'gone.png', mimeType: 'image/png' }
    ]

    const result = await service.registerLocalFilesAsUpload('app1', files, {
      uploadId: 'crawled-source',
      source: 'crawled'
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.filename).toBe('present.png')
    expect(result.failedFiles).toHaveLength(1)
    expect(result.failedFiles[0]?.originalName).toBe('gone.png')
  })

  it('skips files with blocked extensions', async () => {
    const evil = await writeSource('payload.exe', Buffer.from('MZ'))
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      [{ absoluteSourcePath: evil, originalName: 'payload.exe', mimeType: 'application/x-msdownload' }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files).toHaveLength(0)
    expect(result.failedFiles).toHaveLength(1)
  })

  it('skips files that exceed the image size cap', async () => {
    const src = await writeSource('huge.jpg', Buffer.from('small on disk; size is forced below'))
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      // Pass an explicit size over the 25MB image cap so we exercise the
      // oversize-skip path without writing a multi-MB fixture.
      [{ absoluteSourcePath: src, originalName: 'huge.jpg', mimeType: 'image/jpeg', size: 26 * 1024 * 1024 }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files).toHaveLength(0)
    expect(result.failedFiles).toHaveLength(1)
    expect(result.failedFiles[0]?.error).toMatch(/exceeds maximum allowed size/)
    expect(await service.listUploadedFiles('app1')).toHaveLength(0)
  })

  it('skips files whose content type cannot be resolved (no recognized extension)', async () => {
    const src = await writeSource('deadbeef', Buffer.from('bytes')) // no extension → null mime
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      [{ absoluteSourcePath: src, originalName: 'mystery', mimeType: null }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files).toHaveLength(0)
    expect(result.failedFiles).toHaveLength(1)
    expect(result.failedFiles[0]?.error).toMatch(/Unrecognized file type/)
    // Not listed, and no bytes left on disk.
    expect(await service.listUploadedFiles('app1')).toHaveLength(0)
    expect(existsSync(service.getFilePath('app1', 'crawled-source', 'deadbeef'))).toBe(false)
  })

  it('deduplicates repeated filenames within a single batch', async () => {
    const src = await writeSource('dup.png', Buffer.from('png'))
    const files: LocalFileToRegister[] = [
      { absoluteSourcePath: src, originalName: 'one.png', mimeType: 'image/png' },
      { absoluteSourcePath: src, originalName: 'two.png', mimeType: 'image/png' }
    ]
    const result = await service.registerLocalFilesAsUpload('app1', files, {
      uploadId: 'crawled-source',
      source: 'crawled'
    })
    expect(result.files).toHaveLength(1)
  })

  it('leaves no batch directory behind when nothing is registered', async () => {
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      [{ absoluteSourcePath: path.join(sourceDir, 'missing.png'), originalName: 'missing.png', mimeType: 'image/png' }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files).toHaveLength(0)
    expect(existsSync(service.getAppUploadsDir('app1') + '/crawled-source')).toBe(false)
  })

  it('sanitizes SVG content on registration', async () => {
    const malicious = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'
    const src = await writeSource('icon.svg', malicious)
    const result = await service.registerLocalFilesAsUpload(
      'app1',
      [{ absoluteSourcePath: src, originalName: 'icon.svg', mimeType: 'image/svg+xml' }],
      { uploadId: 'crawled-source', source: 'crawled' }
    )
    expect(result.files).toHaveLength(1)
    const onDisk = service.getFilePath('app1', 'crawled-source', 'icon.svg')
    const written = await import('node:fs/promises').then((m) => m.readFile(onDisk, 'utf-8'))
    expect(written).not.toContain('<script>')
  })
})
