import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateQRCode, QRCodeTool } from '../qr-code-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

const mockUpload = vi.fn().mockResolvedValue({ bytesWritten: 1024 })

// Mock workspace
vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn().mockReturnValue({
    files: { upload: (...args: unknown[]) => mockUpload(...args) }
  })
}))

// Mock AppRepository
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue({
      id: 'test-app-123',
      previewUrl: 'https://test-app.preview.airo.dev',
      path: '/tmp/apps/test-app-123'
    })
  }))
}))

describe('qr-code-tool', function packageTests() {
  const testAppId = 'test-app-123'

  beforeEach(() => {
    mockUpload.mockClear()
  })

  describe('#generateQRCode', function generateTests() {
    it('should generate QR code for home page', async function generateHome() {
      const result = await generateQRCode({
        appId: testAppId,
        targetPage: '/',
        size: 1000
      })

      expect(result.success).toBe(true)
      expect(result.targetUrl).toBe('https://test-app.preview.airo.dev/')
      expect(result.base64).toBeDefined()
      expect(result.base64).toMatch(/^data:image\/png;base64,/)
      expect(result.size).toBe(1000)
      expect(mockUpload).toHaveBeenCalledOnce()
      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/^public\/assets\/qr-codes\/qr-home-.*\.png$/),
          data: expect.any(Buffer)
        })
      )
    })

    it('should generate QR code for specific page', async function generateSpecific() {
      const result = await generateQRCode({
        appId: testAppId,
        targetPage: '/about',
        size: 400
      })

      expect(result.success).toBe(true)
      expect(result.targetUrl).toBe('https://test-app.preview.airo.dev/about')
      expect(result.size).toBe(400)
      expect(result.base64).toBeDefined()
      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/^public\/assets\/qr-codes\/qr-about-.*\.png$/)
        })
      )
    })

    it('should use default size if not specified', async function generateDefaultSize() {
      const result = await generateQRCode({
        appId: testAppId,
        targetPage: '/'
      })

      expect(result.success).toBe(true)
      expect(result.size).toBe(1000)
    })

    it('should handle pages without leading slash', async function generateNoSlash() {
      const result = await generateQRCode({
        appId: testAppId,
        targetPage: 'contact'
      })

      expect(result.success).toBe(true)
      expect(result.targetUrl).toBe('https://test-app.preview.airo.dev/contact')
    })

    it('should fail gracefully when app not found', async function generateNotFound() {
      vi.mocked(AppRepository).mockImplementationOnce(() => ({
        findById: vi.fn().mockReturnValue(null)
      } as any))

      const result = await generateQRCode({
        appId: 'nonexistent-app',
        targetPage: '/'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('App not found')
    })

    it('should generate unique filenames for same page', async function generateUnique() {
      const result1 = await generateQRCode({
        appId: testAppId,
        targetPage: '/'
      })

      const result2 = await generateQRCode({
        appId: testAppId,
        targetPage: '/'
      })

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result1.filepath).not.toBe(result2.filepath)
    })

    it('should handle nested pages correctly', async function generateNested() {
      const result = await generateQRCode({
        appId: testAppId,
        targetPage: '/blog/post-1'
      })

      expect(result.success).toBe(true)
      expect(result.targetUrl).toBe('https://test-app.preview.airo.dev/blog/post-1')
      expect(result.base64).toBeDefined()
      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/^public\/assets\/qr-codes\/qr-blog_post-1-.*\.png$/)
        })
      )
    })

    it('should fail when workspace is not available', async function generateNoWorkspace() {
      const { createForWorkspace } = await import('../../workspace/index.js')
      vi.mocked(createForWorkspace).mockReturnValueOnce(null)

      const result = await generateQRCode({
        appId: testAppId,
        targetPage: '/'
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Workspace not available')
    })
  })

  describe('QRCodeTool class', function classTests() {
    it('should create instance', function createInstance() {
      const tool = new QRCodeTool()
      expect(tool).toBeInstanceOf(QRCodeTool)
    })
  })
})
