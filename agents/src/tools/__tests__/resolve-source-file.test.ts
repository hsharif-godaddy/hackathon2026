import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { resolveSourceFile } from '../file-edit-utils.js'
import { fileUploadService } from '../../services/FileUploadService.js'
import { DevSupervisorError } from '../../services/DevSupervisorClient.js'
import { markUploadsPlaced } from '../../services/renderers/upload-classification-persistence.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

vi.mock('../../services/renderers/upload-classification-persistence.js', () => ({
  markUploadsPlaced: vi.fn().mockResolvedValue(true),
}))

describe('resolveSourceFile - upload auto-resolve (exact match + rename-tolerant image fallback)', () => {
  const testAppId = 'test-app-exact-match'
  const testProjectDir = `/tmp/test-project-resolve/${testAppId}`

  const mockFiles: WorkspaceFiles = {
    // stat returns not_found so the existence check treats targets as new files
    // (a generic error would fail-safe to "exists").
    stat: vi.fn().mockResolvedValue({ entries: [{ error: 'not_found' }] }),
    view: vi.fn().mockRejectedValue(new DevSupervisorError('not_found', 404, 'not found')),
    readText: vi.fn().mockResolvedValue(''),
    tree: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(),
    archive: vi.fn(),
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

  it('should resolve a renamed IMAGE to the most recent image upload (rename-tolerant fallback)', async () => {
    // Agent created the file under a tidied name (banner.jpg) that does not
    // match the upload (hero-image.jpg). The empty image file must still be
    // filled from the recent upload rather than left empty (broken <img>).
    await seedUpload('hero-image.jpg', Buffer.from('JPEG_DATA'))
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/banner.jpg',
      '',
      mockFiles
    )
    expect(result).not.toBeNull()
    expect(result!.binaryCopied).toBe(true)
    expect(mockFiles.upload).toHaveBeenCalledWith({
      path: 'public/assets/banner.jpg',
      data: expect.any(Buffer),
    })
  })

  it('should fall back to the NEWEST image upload when a renamed image is created', async () => {
    await seedUpload('first.png', Buffer.from('FIRST'))
    await new Promise(r => setTimeout(r, 50))
    await seedUpload('second.png', Buffer.from('SECOND'))

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)
    expect(result).not.toBeNull()
    expect(result!.binaryCopied).toBe(true)
    const uploadArg = vi.mocked(mockFiles.upload).mock.calls.at(-1)?.[0]
    expect((uploadArg?.data as Buffer).toString()).toBe('SECOND')
  })

  it('should NOT fall back for a renamed NON-image file (fallback is image-only)', async () => {
    await seedUpload('notes.txt', 'hello')
    const result = await resolveSourceFile(
      testAppId,
      'public/data/other.txt',
      '',
      mockFiles
    )
    expect(result).toBeNull()
  })

  it('should REFUSE to guess when multiple images were uploaded in one batch (ambiguous latest)', async () => {
    // Two images, ONE upload batch → identical uploadedAt → "latest" is
    // ambiguous. A renamed target must NOT be filled with an arbitrary one.
    await fileUploadService.processUpload(testAppId, [
      { originalname: 'a.png', mimetype: 'image/png', size: 3, buffer: Buffer.from('AAA') },
      { originalname: 'b.png', mimetype: 'image/png', size: 3, buffer: Buffer.from('BBB') },
    ] as Express.Multer.File[])

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)
    expect(result).toEqual({ skip: true, reason: 'no-match' })
  })

  it('should NOT fall back to an SVG upload for a raster target (would corrupt the file)', async () => {
    await seedUpload('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)
    expect(result).toEqual({ skip: true, reason: 'no-match' })
  })

  it('should PRESERVE an existing file (skip) rather than guess-fill it when no exact match', async () => {
    // A different image was uploaded this turn; the agent re-creates an existing
    // logo.png (empty). The fallback must NOT overwrite it with the newest
    // upload — it returns skip so the create site leaves the file untouched.
    await seedUpload('background.jpg', Buffer.from('BG'))
    vi.mocked(mockFiles.stat).mockResolvedValueOnce({ entries: [{ path: 'public/assets/logo.png', kind: 'file', size: 100, modifiedAt: '2026-01-01T00:00:00.000Z' }] })

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)

    expect(result).toEqual({ skip: true, reason: 'no-upload' })
    expect(mockFiles.upload).not.toHaveBeenCalled()
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

  it('should return no-match skip when no uploads exist for a new raster target', async () => {
    const result = await resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      '',
      mockFiles
    )
    expect(result).toEqual({ skip: true, reason: 'no-match' })
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

  it('marks the upload placed with the correct stored filename and original name (binary)', async () => {
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))

    await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)

    const mockedMark = vi.mocked(markUploadsPlaced)
    expect(mockedMark).toHaveBeenCalledWith(expect.objectContaining({
      appId: testAppId,
      fileName: 'logo.png',
    }))
    const call = mockedMark.mock.calls[0]![0]
    expect(call.storedFilename).toMatch(/^test-app-exact-match_/)
  })

  it('does NOT call markUploadsPlaced for text files — returns uploadIdentity so the caller marks after the write', async () => {
    // For text, resolveSourceFile returns the content and uploadIdentity. The
    // caller (text-editor.ts) marks placed after handleCreate succeeds. This
    // prevents both the premature-mark bug (mark before write) and the SVG-logo
    // re-injection bug (never marking non-binary files).
    await seedUpload('data.json', '{"key":"val"}')
    vi.mocked(markUploadsPlaced).mockClear()

    const result = await resolveSourceFile(testAppId, 'public/data/data.json', '', mockFiles)

    expect(vi.mocked(markUploadsPlaced)).not.toHaveBeenCalled()
    expect(result).not.toBeNull()
    expect(result && !('skip' in result) && 'uploadIdentity' in result).toBe(true)
    if (result && !('skip' in result) && 'uploadIdentity' in result) {
      expect(result.uploadIdentity?.fileName).toBe('data.json')
      expect(result.uploadIdentity?.storedFilename).toMatch(/^test-app-exact-match_/)
    }
  })

  it('returns { skip, reason: copy-error } when the copy fails for an EXISTING file', async () => {
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))
    vi.mocked(mockFiles.stat).mockResolvedValueOnce({ entries: [{ path: 'public/assets/logo.png', kind: 'file', size: 100, modifiedAt: '2026-01-01T00:00:00.000Z' }] })
    vi.mocked(mockFiles.upload).mockRejectedValueOnce(new Error('disk full'))

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)

    expect(result).toEqual({ skip: true, reason: 'copy-error' })
  })

  it('returns { skip, reason: copy-error } when the copy fails for a NEW file (not null, not empty write)', async () => {
    // targetExists = false (default view mock rejects with not_found)
    await seedUpload('logo.png', Buffer.from('PNG_DATA'))
    vi.mocked(mockFiles.upload).mockRejectedValueOnce(new Error('disk full'))

    const result = await resolveSourceFile(testAppId, 'public/assets/logo.png', '', mockFiles)

    // Must return skip+copy-error, NOT null — null would cause the caller to
    // write an empty file, producing a broken <img> with no retryable message.
    expect(result).toEqual({ skip: true, reason: 'copy-error' })
  })
})
