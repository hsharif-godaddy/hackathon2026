import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../renderers/FileUploadContextRenderer.js', () => ({
  classifyUploadImage: vi.fn(),
}))
vi.mock('../FileUploadService.js', () => ({
  fileUploadService: { findMatchingUpload: vi.fn() },
}))
vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: { importChatUploadToSlot: vi.fn() },
}))
vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { classifyUploadImage } from '../renderers/FileUploadContextRenderer.js'
import { fileUploadService } from '../FileUploadService.js'
import { mediaManifestService } from '../MediaManifestService.js'
import { classifyAndGuideChatUploadImage } from '../chat-upload-classification.js'

const mockedClassify = vi.mocked(classifyUploadImage)
const mockedFindMatching = vi.mocked(fileUploadService.findMatchingUpload)
const mockedImport = vi.mocked(mediaManifestService.importChatUploadToSlot)

function classification(overrides: Record<string, unknown> = {}) {
  return {
    variant: 'adaptive',
    classification: 'photo',
    designDirection: 'none',
    contentStructure: 'none',
    assetRole: null,
    placementIntent: 'unclear',
    extractedColors: null,
    extractedPages: null,
    summary: '',
    ...overrides,
  } as never
}

const buffer = Buffer.from('img')

describe('classifyAndGuideChatUploadImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindMatching.mockResolvedValue({
      file: { filename: 'stored.jpg', originalName: 'hero.jpg', mimeType: 'image/jpeg', size: 1, uploadedAt: '', uploadId: 'u1' },
      sourcePath: '/tmp/stored.jpg',
    } as never)
  })

  it('returns all-null when classification fails', async () => {
    mockedClassify.mockResolvedValue(null)
    const result = await classifyAndGuideChatUploadImage({ appId: 'a', fileName: 'hero.jpg', buffer, userPrompt: 'x' })
    expect(result).toEqual({ classification: null, guidance: null, slotUrl: null, storedUploadFilename: null })
    expect(mockedImport).not.toHaveBeenCalled()
  })

  it('reference_only → guidance only, no auto-register', async () => {
    mockedClassify.mockResolvedValue(classification({ placementIntent: 'reference_only' }))
    const result = await classifyAndGuideChatUploadImage({ appId: 'a', fileName: 'mood.jpg', buffer, userPrompt: 'make it look like this' })
    expect(mockedImport).not.toHaveBeenCalled()
    expect(result.slotUrl).toBeNull()
    expect(result.guidance).toContain('reference/inspiration only')
  })

  it('display_on_site + hero_image → auto-registers a slot and returns slot URL in guidance', async () => {
    mockedClassify.mockResolvedValue(classification({ placementIntent: 'display_on_site', assetRole: 'hero_image' }))
    mockedImport.mockResolvedValue({
      success: true,
      slotPath: 'uploads/hero-x',
      slotUrl: '/airo-assets/images/uploads/hero-x',
      uploadedUrl: '/airo-assets/uploads/x.jpg',
      slot: { mediaType: 'image', currentUrl: '/airo-assets/uploads/x.jpg', searchQuery: '', alternatives: [], userModified: true },
    } as never)

    const result = await classifyAndGuideChatUploadImage({ appId: 'a', fileName: 'hero.jpg', buffer, userPrompt: 'use as hero' })

    expect(mockedImport).toHaveBeenCalledWith('a', { filename: 'stored.jpg', assetRole: 'hero_image', createIfMissing: true })
    expect(result.slotUrl).toBe('/airo-assets/images/uploads/hero-x')
    expect(result.guidance).toContain('/airo-assets/images/uploads/hero-x')
  })

  it('display_on_site + null role (generic photo) → guidance to import_upload, no auto-register', async () => {
    mockedClassify.mockResolvedValue(classification({ placementIntent: 'display_on_site', assetRole: null }))
    const result = await classifyAndGuideChatUploadImage({ appId: 'a', fileName: 'product.jpg', buffer, userPrompt: 'add to products' })
    expect(mockedImport).not.toHaveBeenCalled()
    expect(result.guidance).toContain('import_upload')
    expect(result.guidance).toContain('stored.jpg')
  })

  it('logo → guidance to /assets, no auto-register', async () => {
    mockedClassify.mockResolvedValue(classification({ placementIntent: 'display_on_site', assetRole: 'logo' }))
    const result = await classifyAndGuideChatUploadImage({ appId: 'a', fileName: 'logo.png', buffer, userPrompt: 'use this logo' })
    expect(mockedImport).not.toHaveBeenCalled()
    expect(result.guidance).toContain('logo on the site')
  })

})
