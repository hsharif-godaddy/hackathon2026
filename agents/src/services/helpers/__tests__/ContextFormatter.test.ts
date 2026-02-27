import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readAgentUploadAsBase64 } from '../ContextFormatter.js'

vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue(['upload_abc']),
  existsSync: vi.fn().mockReturnValue(true)
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data'))
}))

vi.mock('../../../services/FileUploadService.js', () => {
  const mockService = {
    listUploadedFiles: vi.fn(),
    getAppUploadsDir: vi.fn().mockReturnValue('/tmp/uploads/app1'),
    getFilePath: vi.fn().mockImplementation((_appId: string, _uploadId: string, filename: string) =>
      `/tmp/uploads/app1/${_uploadId}/${filename}`
    )
  }

  return {
    fileUploadService: mockService,
    FileUploadService: vi.fn(() => mockService)
  }
})

describe('ContextFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('#readAgentUploadAsBase64', () => {
    it('should strip query params from signed URLs before matching', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        { id: 'f1', originalName: 'photo.jpg', filename: 'app1_123_f1.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      ])

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/app1_123_f1.jpg?sig=abc123&exp=9999999999'
      )

      expect(vi.mocked(fileUploadService.listUploadedFiles)).toHaveBeenCalledWith('app1')
      expect(result).not.toBeNull()
      expect(result).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('should still work with URLs that have no query params', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        { id: 'f1', originalName: 'photo.jpg', filename: 'app1_123_f1.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      ])

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/app1_123_f1.jpg'
      )

      expect(vi.mocked(fileUploadService.listUploadedFiles)).toHaveBeenCalledWith('app1')
      expect(result).not.toBeNull()
      expect(result).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('should handle encoded filenames in URLs', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        { id: 'f1', originalName: 'my photo.jpg', filename: 'my photo.jpg', size: 1024, mimeType: 'image/jpeg', uploadedAt: '2025-01-01T00:00:00Z' }
      ])

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/my%20photo.jpg?sig=abc&exp=999'
      )

      expect(vi.mocked(fileUploadService.listUploadedFiles)).toHaveBeenCalledWith('app1')
      expect(result).not.toBeNull()
    })

    it('should return null for invalid URLs', async () => {
      const result = await readAgentUploadAsBase64('http://example.com/some/other/path')
      expect(result).toBeNull()
    })

    it('should return null when file not found in uploads', async () => {
      const { fileUploadService } = await import('../../../services/FileUploadService.js')
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([])

      const result = await readAgentUploadAsBase64(
        'http://localhost:4000/files/uploads/app1/nonexistent.jpg?sig=abc&exp=999'
      )

      expect(result).toBeNull()
    })
  })
})
