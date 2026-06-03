import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevSupervisorError } from '../../../services/DevSupervisorClient.js'
import { FileUploadContextRenderer } from '../FileUploadContextRenderer.js'

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

import { createForWorkspace } from '../../../workspace/index.js'

describe('FileUploadContextRenderer', () => {
  let renderer: FileUploadContextRenderer
  const mockView = vi.fn()
  const mockDownload = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    renderer = new FileUploadContextRenderer()
    ;(createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      files: { view: mockView, download: mockDownload },
    })
  })

  it('canHandle returns true for file_upload type', () => {
    expect(renderer.canHandle('file_upload')).toBe(true)
  })

  it('reads text files via workspace.files.view()', async () => {
    mockView.mockResolvedValue({
      path: 'docs/brief.md',
      content: '# Site Brief\nBuild me a portfolio site.',
      encoding: 'utf-8',
      lines: 2,
      size: 40,
      truncated: false,
    })

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'brief.md', isImage: false } },
      'build a site',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mockView).toHaveBeenCalledWith({ path: 'docs/brief.md', limit: 10000 })
    expect(result).not.toBeNull()
    expect(result?.content).toContain('brief.md')
  })

  it('reads image files via workspace.files.download()', async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockDownload.mockResolvedValue({
      data: pngData,
      contentType: 'image/png',
    })

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'logo.png', isImage: true } },
      'use this logo',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(mockDownload).toHaveBeenCalledWith({ path: 'src/assets/logo.png' })
    expect(result).not.toBeNull()
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

  it('returns not-found message when workspace view throws for text', async () => {
    mockView.mockRejectedValue(new DevSupervisorError('not_found', 404, 'docs/missing.md'))

    const result = await renderer.render(
      { type: 'file_upload', data: { name: 'missing.md', isImage: false } },
      'use this',
      { appId: 'abc123', appPath: '/app' },
    )

    expect(result?.content).toContain('not found')
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
      mockView
        .mockResolvedValueOnce({ content: '# Brief\nPortfolio site.', lines: 2, size: 25, truncated: false })
        .mockResolvedValueOnce({ content: 'Brand colors: blue, green.', lines: 1, size: 26, truncated: false })

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

      expect(mockView).toHaveBeenCalledTimes(2)
      expect(result).not.toBeNull()
      expect(result?.content).toContain('brief.md')
      expect(result?.content).toContain('brand.txt')
    })

    it('handles data.files array with mixed image and text', async () => {
      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      mockDownload.mockResolvedValueOnce({ data: pngData, contentType: 'image/png' })
      mockView.mockResolvedValueOnce({ content: '# Notes', lines: 1, size: 7, truncated: false })

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
      expect(mockView).toHaveBeenCalledWith({ path: 'docs/notes.md', limit: 10000 })
      expect(result).not.toBeNull()
      expect(result?.content).toContain('logo.png')
      expect(result?.content).toContain('notes.md')
    })

    it('falls back to legacy data.name format', async () => {
      mockView.mockResolvedValueOnce({ content: '# Old format', lines: 1, size: 12, truncated: false })

      const result = await renderer.render(
        { type: 'file_upload', data: { name: 'legacy.md', isImage: false } },
        'build a site',
        { appId: 'abc123', appPath: '/app' },
      )

      expect(mockView).toHaveBeenCalledWith({ path: 'docs/legacy.md', limit: 10000 })
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
      mockView
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce({ content: '# Good file', lines: 1, size: 11, truncated: false })

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
})
