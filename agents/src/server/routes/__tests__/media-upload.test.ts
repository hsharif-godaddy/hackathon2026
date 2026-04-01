import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import sharp from 'sharp'

// Mock the app-ownership middleware to bypass authentication
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((req, res, next) => next()),
}))

// Mock persistent assets helper to use test paths
vi.mock('../../../utils/persistent-assets.js', () => ({
  getPersistentPublicDir: vi.fn((appPath: string) => `${appPath}/public`),
}))

// Mock dependencies
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    updateSlotWithUpload: vi.fn(),
    getManifest: vi.fn(),
    updateSlot: vi.fn(),
  },
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi
      .fn()
      .mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
  })),
}))


vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /media/:appId/slots/:slotName/upload', () => {
  let app: express.Application

  beforeAll(async () => {
    // Import after mocks are set up
    const { default: mediaRouter } = await import('../media.js')
    app = express()
    app.use('/media', mediaRouter)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject non-image files', async () => {
    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', Buffer.from('not an image'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain(
      'Only JPEG, PNG, WebP, and GIF images are supported'
    )
  })

  it('should reject files larger than 10MB', async () => {
    // Create a buffer larger than 10MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024)

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', largeBuffer, {
        filename: 'large.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('10MB')
  })

  it('should reject files with valid MIME type but invalid magic bytes', async () => {
    // Send random bytes claiming to be JPEG
    const fakeImage = Buffer.from('This is not a real image file at all')

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', fakeImage, {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('does not match')
  })

  it('should accept valid image upload', async () => {
    const { mediaManifestService } = await import(
      '../../../services/MediaManifestService.js'
    )
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: 'https://media.gettyimages.com/old.jpg',
        searchQuery: 'hero image',
        alternatives: [],
        userModified: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    })
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: '/airo-assets/uploads/hero-abc123.jpg',
        searchQuery: 'hero image',
        alternatives: ['https://media.gettyimages.com/old.jpg'],
        userModified: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    })

    // Create a valid test image
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer()

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.uploadedUrl).toContain('/airo-assets/uploads/')
  })

  it('should return 400 when no file is provided', async () => {
    const response = await request(app).post('/media/test-app/slots/hero/upload')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('No image file provided')
  })

  it('should return 404 when slot does not exist', async () => {
    const { mediaManifestService } = await import(
      '../../../services/MediaManifestService.js'
    )
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: false,
      error: 'Slot not found: nonexistent',
    })

    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer()

    const response = await request(app)
      .post('/media/test-app/slots/nonexistent/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(404)
    expect(response.body.error).toContain('Slot not found')
  })

  it('should handle nested slot names with slashes', async () => {
    const { mediaManifestService } = await import(
      '../../../services/MediaManifestService.js'
    )
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: 'https://example.com/old.jpg',
        searchQuery: 'test',
        alternatives: [],
        userModified: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    })
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: '/airo-assets/uploads/components-hero-section-abc123.jpg',
        searchQuery: 'test',
        alternatives: ['https://example.com/old.jpg'],
        userModified: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    })

    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .jpeg()
      .toBuffer()

    const response = await request(app)
      .post('/media/test-app/slots/components/hero/section/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(mediaManifestService.getSlot).toHaveBeenCalledWith(
      'test-app',
      'components/hero/section'
    )
  })

})
