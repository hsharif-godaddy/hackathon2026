import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { FileUploadService } from '../FileUploadService.js'

describe('FileUploadService - no expiry', () => {
  const testDir = '/tmp/test-uploads-no-expiry'
  let service: FileUploadService

  beforeEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
    service = new FileUploadService(testDir)
  })

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  it('should not include expiresAt in upload result', async () => {
    const file = {
      originalname: 'test.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: Buffer.from('test')
    } as Express.Multer.File

    const result = await service.processUpload('app1', [file])
    expect(result.expiresAt).toBeUndefined()
  })

  it('should not include expiresAt in metadata.json', async () => {
    const file = {
      originalname: 'test.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: Buffer.from('test')
    } as Express.Multer.File

    const result = await service.processUpload('app1', [file])
    const metadataPath = service.getFilePath('app1', result.uploadId, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'))
    expect(metadata.expiresAt).toBeUndefined()
    expect(metadata.uploadedAt).toBeDefined()
  })

  it('should not have deleteExpiredUploads method', () => {
    expect((service as any).deleteExpiredUploads).toBeUndefined()
  })

  it('should parse old metadata with expiresAt field (backward compat)', async () => {
    const file = {
      originalname: 'test.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: Buffer.from('test')
    } as Express.Multer.File

    const result = await service.processUpload('app1', [file])
    const metadataPath = service.getFilePath('app1', result.uploadId, 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'))
    metadata.expiresAt = new Date(Date.now() + 86400000).toISOString()
    const { writeFile: writeFileFs } = await import('node:fs/promises')
    await writeFileFs(metadataPath, JSON.stringify(metadata, null, 2))

    const files = await service.listUploadedFiles('app1')
    expect(files.length).toBeGreaterThan(0)
  })
})
