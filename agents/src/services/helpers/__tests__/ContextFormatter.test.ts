import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextFormatter, readAgentUploadAsBase64 } from '../ContextFormatter.js'

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data'))
}))

vi.mock('../../../services/FileUploadService.js', () => {
  const mockService = {
    findMatchingUpload: vi.fn(),
    getAppUploadsDir: vi.fn().mockReturnValue('/tmp/uploads/app1')
  }

  return {
    fileUploadService: mockService,
    FileUploadService: vi.fn(function () { return mockService; })
  }
})

describe('ContextFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#readAgentUploadAsBase64', () => {
    it('should strip query params from signed URLs before matching', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      const file = { id: 'f1', originalName: 'photo.jpg', filename: 'app1_123_f1.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      vi.mocked(fileUploadService.findMatchingUpload).mockResolvedValue({ file, sourcePath: '/tmp/uploads/app1/upload_abc/app1_123_f1.jpg' })

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/app1_123_f1.jpg?sig=abc123&exp=9999999999'
      )

      expect(vi.mocked(fileUploadService.findMatchingUpload)).toHaveBeenCalledWith('app1', 'app1_123_f1.jpg')
      expect(result).not.toBeNull()
      expect(result).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('should still work with URLs that have no query params', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      const file = { id: 'f1', originalName: 'photo.jpg', filename: 'app1_123_f1.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      vi.mocked(fileUploadService.findMatchingUpload).mockResolvedValue({ file, sourcePath: '/tmp/uploads/app1/upload_abc/app1_123_f1.jpg' })

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/app1_123_f1.jpg'
      )

      expect(vi.mocked(fileUploadService.findMatchingUpload)).toHaveBeenCalledWith('app1', 'app1_123_f1.jpg')
      expect(result).not.toBeNull()
      expect(result).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('should handle encoded filenames in URLs', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      const file = { id: 'f1', originalName: 'my photo.jpg', filename: 'my photo.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      vi.mocked(fileUploadService.findMatchingUpload).mockResolvedValue({ file, sourcePath: '/tmp/uploads/app1/upload_abc/my photo.jpg' })

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/my%20photo.jpg?sig=abc&exp=999'
      )

      expect(vi.mocked(fileUploadService.findMatchingUpload)).toHaveBeenCalledWith('app1', 'my photo.jpg')
      expect(result).not.toBeNull()
    })

    it('should return null for invalid URLs', async () => {
      const result = await readAgentUploadAsBase64('http://example.com/some/other/path')
      expect(result).toBeNull()
    })

    it('should return null when file not found in uploads', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      vi.mocked(fileUploadService.findMatchingUpload).mockResolvedValue(null)

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/nonexistent.jpg?sig=abc&exp=999'
      )

      expect(result).toBeNull()
    })
  })

  // AIROBUILD-1556 — formatAiEditContext surfaces imageInfo (alt + URL) only.
  // Click-action guidance is owned by the popover prompt builders, NOT this
  // function — keeping it out keeps non-click-action image edits (Replace,
  // Modify, border, etc.) free of irrelevant click-action prose.
  describe('#formatAiEditContext', () => {
    const baseContext = {
      elementInfo: { tagName: 'div', className: 'card', id: 'c1', textContent: 'hello' },
      devContext: { fileName: 'src/pages/index.tsx', componentName: 'HomePage', lineNumber: 42 },
      selector: '.card#c1',
    }

    it('omits Image Details when imageInfo is absent', () => {
      const result = ContextFormatter.formatAiEditContext(baseContext)
      expect(result).not.toBeNull()
      expect(result!.content).not.toContain('Image Details:')
    })

    it('includes alt and Image Details for foreground <img>', () => {
      const result = ContextFormatter.formatAiEditContext({
        ...baseContext,
        elementInfo: { ...baseContext.elementInfo, tagName: 'img' },
        imageInfo: { type: 'img', currentUrl: '/airo-assets/images/menu/morning-buns', alt: 'Morning Buns' },
      })
      expect(result!.content).toContain('Image type: img')
      expect(result!.content).toContain('Alt text: Morning Buns')
    })

    it('never appends click-action guidance — that lives in the popover prompt builders', () => {
      const foreground = ContextFormatter.formatAiEditContext({
        ...baseContext,
        elementInfo: { ...baseContext.elementInfo, tagName: 'img' },
        imageInfo: { type: 'img', currentUrl: '/u', alt: 'x' },
      })!
      const background = ContextFormatter.formatAiEditContext({
        ...baseContext,
        imageInfo: { type: 'background', currentUrl: '/u', alt: '' },
      })!
      expect(foreground.content).not.toContain('Click-Action Guidance')
      expect(foreground.content).not.toContain('per-item pattern')
      expect(background.content).not.toContain('Click-Action Guidance')
    })

    it('truncates oversized alt text and falls back to "none" when missing', () => {
      const longAlt = 'x'.repeat(500)
      const withLongAlt = ContextFormatter.formatAiEditContext({
        ...baseContext,
        elementInfo: { ...baseContext.elementInfo, tagName: 'img' },
        imageInfo: { type: 'img', currentUrl: '/u', alt: longAlt },
      })!
      expect(withLongAlt.content).toContain('x'.repeat(200))
      expect(withLongAlt.content).not.toContain('x'.repeat(201))

      const withoutAlt = ContextFormatter.formatAiEditContext({
        ...baseContext,
        elementInfo: { ...baseContext.elementInfo, tagName: 'img' },
        imageInfo: { type: 'img', currentUrl: '/u' },
      })!
      expect(withoutAlt.content).toContain('Alt text: none')
    })

    it('drops invalid imageInfo.type instead of leaking it into the prompt', () => {
      const result = ContextFormatter.formatAiEditContext({
        ...baseContext,
        imageInfo: { type: 'malicious', currentUrl: '/u', alt: 'x' },
      })
      expect(result!.content).toContain('Image type: null')
    })
  })
})
