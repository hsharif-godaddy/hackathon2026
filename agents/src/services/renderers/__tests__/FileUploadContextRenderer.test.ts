import { Readable } from 'node:stream'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { DevSupervisorError } from '../../../services/DevSupervisorClient.js'
import { FileUploadContextRenderer, classifyUploadImage } from '../FileUploadContextRenderer.js'

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({ path: '/app' }),
  }; }),
}))

vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn().mockReturnValue({ modelId: 'test' }),
}))

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: '{}' }),
}))

vi.mock('../../../utils/image-resize.js', () => ({
  resizeForVision: vi.fn().mockResolvedValue({
    buffer: Buffer.from('resized'),
    mimeType: 'image/png',
  }),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: { create: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    importChatUploadToSlot: vi.fn(),
  },
}))

vi.mock('../../../services/FileUploadService.js', () => ({
  fileUploadService: {
    findMatchingUpload: vi.fn(),
  },
}))

import { createForWorkspace } from '../../../workspace/index.js'
import { generateText } from 'ai'
import { fileUploadService } from '../../../services/FileUploadService.js'
import { mediaManifestService } from '../../../services/MediaManifestService.js'
import { logger } from '../../../logging/index.js'

describe('FileUploadContextRenderer', () => {
  let renderer: FileUploadContextRenderer
  const mockReadText = vi.fn()
  const mockDownload = vi.fn()
  const mockWrite = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    renderer = new FileUploadContextRenderer()
    mockWrite.mockResolvedValue({ bytesWritten: 0 })
    ;(createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      files: createStubWorkspaceFiles({ readText: mockReadText, download: mockDownload, write: mockWrite }),
    })
  })

  it('canHandle returns true for file_upload type', () => {
    expect(renderer.canHandle('file_upload')).toBe(true)
  })

  it('reads text files via workspace.files.readText()', async () => {
    mockReadText.mockResolvedValue('# Site Brief\nBuild me a portfolio site.')

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'brief.md', isImage: false } },
      'build a site',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mockReadText).toHaveBeenCalledWith({ path: 'docs/brief.md' })
    expect(result).not.toBeNull()
    expect(result?.content).toContain('brief.md')
  })

  it('reads image files via workspace.files.download()', async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockDownload.mockResolvedValue({
      stream: Readable.from(pngData),
      contentType: 'image/png',
      contentLength: pngData.length,
    })

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'logo.png', isImage: true } },
      'use this logo',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mockDownload).toHaveBeenCalledWith({ path: 'src/assets/logo.png' })
    expect(result).not.toBeNull()
  })

  it('auto-registers hero_image uploads into a media slot', async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockDownload.mockResolvedValue({
      stream: Readable.from(pngData),
      contentType: 'image/png',
      contentLength: pngData.length,
    })
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        variant: 'adaptive',
        classification: 'photo',
        designDirection: 'partial',
        contentStructure: 'none',
        assetRole: 'hero_image',
        placementIntent: 'display_on_site',
        extractedColors: null,
        extractedPages: null,
        summary: 'Hero photo for homepage',
      }),
    } as never)
    vi.mocked(fileUploadService.findMatchingUpload).mockResolvedValue({
      file: {
        filename: 'stored-hero.jpg',
        originalName: 'hero.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        uploadId: 'upload-1',
      },
      sourcePath: '/tmp/stored-hero.jpg',
    })
    vi.mocked(mediaManifestService.importChatUploadToSlot).mockResolvedValue({
      success: true,
      slotPath: 'uploads/hero-hero',
      slotUrl: '/airo-assets/images/uploads/hero-hero',
      uploadedUrl: '/airo-assets/uploads/uploads-hero-hero-abcd1234.jpg',
      slot: {
        mediaType: 'image',
        currentUrl: '/airo-assets/uploads/uploads-hero-hero-abcd1234.jpg',
        searchQuery: '',
        alternatives: [],
        userModified: true,
      },
    })

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'hero.jpg', isImage: true } },
      'use this as the hero',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mediaManifestService.importChatUploadToSlot).toHaveBeenCalledWith('abc123', {
      filename: 'stored-hero.jpg',
      assetRole: 'hero_image',
      createIfMissing: true,
    })
    expect(result?.content).toContain('display on site')
    expect(result?.content).toContain('/airo-assets/images/uploads/hero-hero')
    expect(result?.content).toContain('Do NOT copy to public/assets')
  })

  it('does not auto-register hero images shared as reference only', async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockDownload.mockResolvedValue({
      stream: Readable.from(pngData),
      contentType: 'image/png',
      contentLength: pngData.length,
    })
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        variant: 'adaptive',
        classification: 'reference_design',
        designDirection: 'partial',
        contentStructure: 'none',
        assetRole: null,
        placementIntent: 'reference_only',
        extractedColors: null,
        extractedPages: null,
        summary: 'Mood board reference',
      }),
    } as never)

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'mood.jpg', isImage: true } },
      'make the hero feel like this image',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mediaManifestService.importChatUploadToSlot).not.toHaveBeenCalled()
    expect(result?.content).toContain('reference/inspiration only')
    expect(result?.content).not.toContain('Media slot registered')
  })

  it('does not auto-register logo uploads', async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockDownload.mockResolvedValue({
      stream: Readable.from(pngData),
      contentType: 'image/png',
      contentLength: pngData.length,
    })
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        variant: 'adaptive',
        classification: 'logo',
        designDirection: 'full',
        contentStructure: 'none',
        assetRole: 'logo',
        placementIntent: 'display_on_site',
        extractedColors: ['#000000'],
        extractedPages: null,
        summary: 'Company logo',
      }),
    } as never)

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'logo.png', isImage: true } },
      'use this logo',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mediaManifestService.importChatUploadToSlot).not.toHaveBeenCalled()
    expect(result?.content).toContain('logo on the site')
    expect(result?.content).not.toContain('Media slot registered')
  })

  it('returns not-found message when workspace download throws for image', async () => {
    mockDownload.mockRejectedValue(new DevSupervisorError('not_found', 404, 'src/assets/missing.png'))

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'missing.png', isImage: true } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content).toContain('not found')
  })

  it('returns not-found message when workspace readText throws for text', async () => {
    mockReadText.mockRejectedValue(new DevSupervisorError('not_found', 404, 'docs/missing.md'))

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'missing.md', isImage: false } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content).toContain('not found')
  })

  it('logs per-file failure and skips when non-404 image error occurs', async () => {
    mockDownload.mockRejectedValue(new Error('connection refused'))

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'logo.png', isImage: true } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content ?? '').not.toContain('not found on disk')
    expect(logger.warn).toHaveBeenCalledWith(
      'context.renderer.file_upload.render_single_failed',
      expect.objectContaining({ appId: 'abc123', fileName: 'logo.png' }),
    )
  })

  it('logs per-file failure and skips when non-404 text error occurs', async () => {
    mockReadText.mockRejectedValue(new Error('connection refused'))

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'doc.md', isImage: false } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content ?? '').not.toContain('not found on disk')
    expect(logger.warn).toHaveBeenCalledWith(
      'context.renderer.file_upload.render_single_failed',
      expect.objectContaining({ appId: 'abc123', fileName: 'doc.md' }),
    )
  })

  it('returns unavailable message when workspace is null for image', async () => {
    ;(createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'logo.png', isImage: true } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content).toContain('unavailable')
  })

  it('returns unavailable message when workspace is null for text', async () => {
    ;(createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'doc.md', isImage: false } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content).toContain('unavailable')
  })

  describe('multi-file format', () => {
    it('handles data.files array with multiple text files', async () => {
      mockReadText
        // First readText is the persisted-classifications read (skip-known gate);
        // return empty so both files are treated as fresh.
        .mockResolvedValueOnce('{"files":[]}')
        .mockResolvedValueOnce('# Brief\nPortfolio site.')
        .mockResolvedValueOnce('Brand colors: blue, green.')
        // Final readText is persistClassifications re-reading under its write lock.
        .mockResolvedValueOnce('{"files":[]}')

      const result = await renderer.render(
        {
          type: 'file_upload',
          data: {
            files: [
              { name: 'brief.md', isDesignMd: false, isImage: false },
              { name: 'brand.txt', isDesignMd: false, isImage: false },
            ],
          },
        },
        'build a site',
        { appId: 'abc123', appPath: '/app' },
      )

      // 1 persisted-classifications read + 2 file reads + 1 persist re-read (lock)
      expect(mockReadText).toHaveBeenCalledTimes(4)
      expect(result).not.toBeNull()
      expect(result?.content).toContain('brief.md')
      expect(result?.content).toContain('brand.txt')
    })

    it('skips re-classifying a persisted file on a continuation/handoff turn', async () => {
      // isContinuation=true (handoff/auto-continue): the same attachment is
      // re-fed with a non-user prompt. The persisted entry is reused (context
      // manager re-injects it) — no classifier call, no per-file read.
      mockReadText.mockResolvedValueOnce(
        JSON.stringify({ files: [{ fileName: 'brief.md', placementIntent: 'unclear' }] }),
      )

      const result = await renderer.render(
        { type: 'file_upload', data: { files: [{ name: 'brief.md', isImage: false }] } },
        'a later handoff prompt',
        { appId: 'abc123', appPath: '/app', isContinuation: true },
      )

      // Only the persisted-classifications read happened — no per-file readText.
      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(generateText).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('re-classifies a persisted file on a fresh user turn (not a continuation)', async () => {
      // Same file classified before, but this is a fresh user message
      // (isContinuation falsy) — the user is acting on the upload again, so it
      // must be classified against the current message regardless of the prior
      // persisted result.
      mockReadText
        .mockResolvedValueOnce(
          JSON.stringify({ files: [{ fileName: 'mood.jpg', placementIntent: 'reference_only' }] }),
        )
      // Image download fails with DevSupervisorError not_found → short-circuits
      // to the not-found fallback, proving the file was NOT skipped.
      mockDownload.mockRejectedValueOnce(new DevSupervisorError('not_found', 404, 'src/assets/mood.jpg'))

      const result = await renderer.render(
        { type: 'file_upload', data: { files: [{ name: 'mood.jpg', isImage: true }] } },
        'put this here',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(mockDownload).toHaveBeenCalledTimes(1)
      expect(result).not.toBeNull()
    })

    it('handles data.files array with mixed image and text', async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      mockReadText
        .mockResolvedValueOnce('{"files":[]}')
        .mockResolvedValueOnce('# Notes')
      mockDownload.mockResolvedValueOnce({ stream: Readable.from(pngData), contentType: 'image/png', contentLength: pngData.length })

      const result = await renderer.render(
        {
          type: 'file_upload',
          data: {
            files: [
              { name: 'logo.png', isDesignMd: false, isImage: true },
              { name: 'notes.md', isDesignMd: false, isImage: false },
            ],
          },
        },
        'build with this logo',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(mockDownload).toHaveBeenCalledWith({ path: 'src/assets/logo.png' })
      expect(mockReadText).toHaveBeenCalledWith({ path: 'docs/notes.md' })
      expect(result).not.toBeNull()
      expect(result?.content).toContain('logo.png')
      expect(result?.content).toContain('notes.md')
    })

    it('falls back to legacy data.name format', async () => {
      mockReadText
        .mockResolvedValueOnce('{"files":[]}')
        .mockResolvedValueOnce('# Old format')

      const result = await renderer.render(
        { type: 'file_upload', data: { name: 'legacy.md', isImage: false } },
        'build a site',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(mockReadText).toHaveBeenCalledWith({ path: 'docs/legacy.md' })
      expect(result?.content).toContain('legacy.md')
    })

    it('returns null when data.files is empty array', async () => {
      const result = await renderer.render(
        { type: 'file_upload', data: { files: [] } },
        'build a site',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(result).toBeNull()
    })

    it('skips individual files that fail and includes successes', async () => {
      mockReadText
        .mockResolvedValueOnce('{"files":[]}')
        .mockRejectedValueOnce(new DevSupervisorError('not_found', 404, 'docs/missing.md'))
        .mockResolvedValueOnce('# Good file')

      const result = await renderer.render(
        {
          type: 'file_upload',
          data: {
            files: [
              { name: 'missing.md', isDesignMd: false, isImage: false },
              { name: 'good.md', isDesignMd: false, isImage: false },
            ],
          },
        },
        'build a site',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(result).not.toBeNull()
      expect(result?.content).toContain('good.md')
    })
  })

  describe('classifyUploadImage — LLM output degradation', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    it('returns null when the model returns non-JSON prose', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({ text: 'Sure! This looks like a hero image.' } as never)
      const result = await classifyUploadImage(buf, 'photo.jpg', 'use as hero')
      expect(result).toBeNull()
    })

    it('degrades an off-enum placementIntent to "unclear" (never auto-place)', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({ placementIntent: 'definitely-put-it-everywhere', assetRole: 'hero_image' }),
      } as never)
      const result = await classifyUploadImage(buf, 'photo.jpg', 'use as hero')
      expect(result).not.toBeNull()
      expect(result?.placementIntent).toBe('unclear')
    })

    it('degrades an unknown assetRole to null (not slot-eligible)', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({ placementIntent: 'display_on_site', assetRole: 'mascot' }),
      } as never)
      const result = await classifyUploadImage(buf, 'photo.jpg', 'use this')
      expect(result).not.toBeNull()
      expect(result?.assetRole).toBeNull()
    })

    it('returns null when the model call throws', async () => {
      vi.mocked(generateText).mockRejectedValueOnce(Object.assign(new Error('gocode 400'), { statusCode: 400 }))
      const result = await classifyUploadImage(buf, 'photo.jpg', 'use as hero')
      expect(result).toBeNull()
    })
  })
})
