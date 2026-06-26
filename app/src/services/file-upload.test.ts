/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn().mockResolvedValue({ token: 'test-token', uploadUrl: 'http://localhost/upload' }),
  getFileMetadataAgent: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('file-upload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  describe('validateImageFile', () => {
    it('allows supported image types', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
      expect(validateImageFile(file)).toBeNull()
    })

    it('allows video types', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['data'], 'clip.mp4', { type: 'video/mp4' })
      expect(validateImageFile(file)).toBeNull()
    })

    it('allows SVG files', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' })
      expect(validateImageFile(file)).toBeNull()
    })

    it('allows AVIF files', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['data'], 'photo.avif', { type: 'image/avif' })
      expect(validateImageFile(file)).toBeNull()
    })

    it('rejects unsupported types', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
      expect(validateImageFile(file)).toContain('not allowed')
    })

    it('rejects images over 25MB', async () => {
      const { validateImageFile } = await import('./file-upload')
      // Create a file object with a forced size
      const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' })
      Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 })
      const error = validateImageFile(file)
      expect(error).toContain('25MB')
    })

    it('rejects videos over 50MB', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['x'], 'big.mp4', { type: 'video/mp4' })
      Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 })
      const error = validateImageFile(file)
      expect(error).toContain('50MB')
    })

    it('allows images up to 25MB', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['x'], 'ok.jpg', { type: 'image/jpeg' })
      Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 })
      expect(validateImageFile(file)).toBeNull()
    })

    it('allows videos up to 50MB', async () => {
      const { validateImageFile } = await import('./file-upload')
      const file = new File(['x'], 'ok.mp4', { type: 'video/mp4' })
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 })
      expect(validateImageFile(file)).toBeNull()
    })
  })

  describe('uploadImages', () => {
    it('throws when no files are provided', async () => {
      const { uploadImages } = await import('./file-upload')
      await expect(uploadImages('app1', [])).rejects.toThrow('No files selected')
    })

    it('throws when all files are invalid', async () => {
      const { uploadImages } = await import('./file-upload')
      const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
      await expect(uploadImages('app1', [file])).rejects.toThrow()
    })

    it('uploads valid files and skips invalid ones', async () => {
      const { getFileUploadAgent } = await import('@/lib/file-agent')
      ;(getFileUploadAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', uploadUrl: 'http://localhost/upload' })
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uploadId: 'up1', files: [{ filename: 'photo.jpg' }], failedFiles: [] }),
      })

      const { uploadImages } = await import('./file-upload')
      const validFile = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
      const invalidFile = new File(['doc'], 'doc.pdf', { type: 'application/pdf' })

      const result = await uploadImages('app1', [validFile, invalidFile])
      expect(result.uploadId).toBe('up1')
      // fetch should have been called with only the valid file
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('uploads video files successfully', async () => {
      const { getFileUploadAgent } = await import('@/lib/file-agent')
      ;(getFileUploadAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', uploadUrl: 'http://localhost/upload' })
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uploadId: 'up2', files: [{ filename: 'clip.mp4' }], failedFiles: [] }),
      })

      const { uploadImages } = await import('./file-upload')
      const videoFile = new File(['vid'], 'clip.mp4', { type: 'video/mp4' })

      const result = await uploadImages('app1', [videoFile])
      expect(result.uploadId).toBe('up2')
    })
  })
})
