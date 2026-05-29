import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { resolveSourceFile } from '../file-edit-utils.js'
import { fileUploadService } from '../../services/FileUploadService.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

describe('resolveSourceFile - exact match only', () => {
  const testAppId = 'test-app-exact-match'
  const testProjectDir = `/tmp/test-project-resolve/${testAppId}`

  const mockFiles: WorkspaceFiles = {
    view: vi.fn(),
    tree: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(),
  };

  async function seedUpload(originalName: string, content: string | Buffer): Promise<string> {
    const file = {
      originalname: originalName,
      mimetype: originalName.endsWith('.png') ? 'image/png' : 'text/plain',
      size: typeof content === 'string' ? Buffer.byteLength(content) : content.length,
      buffer: typeof content === 'string' ? Buffer.from(content) : content
    } as Express.Multer.File
    const result = await fileUploadService.processUpload(testAppId, [file])
    return result.uploadId
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    for (const dir of [testProjectDir]) {
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
    }
    const testAppUploadsDir = fileUploadService.getAppUploadsDir(testAppId)
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true })
    }
    const testAppUploadsDir = fileUploadService.getAppUploadsDir(testAppId)
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true })
    }
  })

  it('should resolve when target filename matches originalName exactly', async () => {
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      '',
      mockFiles
    )
    expect(result).not.toBeNull()
    expect(result!.binaryCopied).toBe(true)
    expect(mockFiles.upload).toHaveBeenCalledWith({
      path: 'public/assets/logo.png',
      data: expect.any(Buffer),
    })
  })

  it('should NOT resolve when filenames differ only by name (same extension)', async () => {
    await seedUpload('hero-image.jpg', Buffer.from('JPEG_DATA'))
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/banner.jpg',
      '',
      mockFiles
    )
    expect(result).toBeNull()
  })

  it('should return null when content is not empty', async () => {
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      'some content',
      mockFiles
    )
    expect(result).toBeNull()
  })

  it('should return null when no uploads exist', async () => {
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      '',
      mockFiles
    )
    expect(result).toBeNull()
  })

  it('should resolve text files by reading content', async () => {
    await seedUpload('data.json', '{"key": "value"}')
    const result = await resolveSourceFile(
      testAppId,
      'public/data/data.json',
      '',
      mockFiles
    )
    expect(result).not.toBeNull()
    expect(result!.content).toBe('{"key": "value"}')
    expect(result!.binaryCopied).toBeUndefined()
  })

  it('should match on stored filename as well as originalName', async () => {
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))
    const files = await fileUploadService.listUploadedFiles(testAppId)
    const storedFilename = files[0]!.filename

    const result = await resolveSourceFile(
      testAppId,
      `public/assets/${storedFilename}`,
      '',
      mockFiles
    )
    expect(result).not.toBeNull()
  })

  it('should resolve to the newest upload when originalName is re-uploaded', async () => {
    await seedUpload('data.json', '{"version": "old"}')
    await new Promise(r => setTimeout(r, 50))
    await seedUpload('data.json', '{"version": "new"}')

    const result = await resolveSourceFile(testAppId, 'public/data/data.json', '', mockFiles)
    expect(result).not.toBeNull()
    expect(result!.content).toBe('{"version": "new"}')
  })
})
