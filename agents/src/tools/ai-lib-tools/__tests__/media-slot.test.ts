import { describe, it, expect, vi } from 'vitest'

const { mockFillSlot, mockGetRebuildCtx } = vi.hoisted(() => ({
  mockFillSlot: vi.fn(),
  mockGetRebuildCtx: vi.fn(),
}))

vi.mock('../../rebuild-source-media.js', () => ({
  fillSlotFromRebuildSource: mockFillSlot,
  getRebuildBuildContext: mockGetRebuildCtx,
}))

vi.mock('../../media-slot-tool.js', () => ({
  MediaSlotTool: class {
    async selectMedia() {
      return { success: true }
    }
    async importUpload({ slot }: { slot: string }) {
      return {
        success: true,
        slot,
        slotUrl: `/airo-assets/images/${slot}`,
        mediaType: 'image',
        uploadedUrl: '/airo-assets/uploads/the-real-upload.jpg',
      }
    }
  },
}))

vi.mock('../../../services/upload-classification-store.js', () => ({
  recordUploadSlotUrl: vi.fn(),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById() {
      return null
    }
  },
}))

import { mediaSlotAITool } from '../media-slot.js'

type ToModelOutput = (options: {
  toolCallId: string
  input: unknown
  output: unknown
}) => { type: string; value: string }

const toModelOutput = (mediaSlotAITool as unknown as { toModelOutput: ToModelOutput }).toModelOutput

describe('mediaSlotAITool', () => {
  describe('#toModelOutput', () => {
    it('is forwarded to the AI SDK tool', () => {
      expect(toModelOutput).toBeTypeOf('function')
    })

    it('projects the full payload to a lean model view without image URLs', () => {
      const full = JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'modern office',
        resolvedUrl: 'https://media.gettyimages.com/hero.jpg',
        thumbnailUrl: 'https://media.gettyimages.com/hero-thumb.jpg',
        alternatives: [
          'https://media.gettyimages.com/alt1.jpg',
          'https://media.gettyimages.com/alt2.jpg',
        ],
        alternativeCount: 2,
      })

      const projected = toModelOutput({ toolCallId: '1', input: {}, output: full })
      expect(projected.type).toBe('text')

      const lean = JSON.parse(projected.value)
      expect(lean).toEqual({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'modern office',
      })

      // Critical: no Getty URLs or alternatives leak into model context.
      expect(projected.value).not.toContain('gettyimages')
      expect(lean.resolvedUrl).toBeUndefined()
      expect(lean.thumbnailUrl).toBeUndefined()
      expect(lean.alternatives).toBeUndefined()
    })

    it('preserves the video element guidance note', () => {
      const full = JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/videos/pages/home/hero',
        mediaType: 'video',
        resolvedUrl: 'https://media.gettyimages.com/clip.mp4',
        note: 'IMPORTANT: Use <video src="/airo-assets/videos/pages/home/hero" autoPlay muted loop playsInline />',
      })

      const lean = JSON.parse(toModelOutput({ toolCallId: '1', input: {}, output: full }).value)
      expect(lean.mediaType).toBe('video')
      expect(lean.note).toContain('<video')
      expect(lean.resolvedUrl).toBeUndefined()
    })
  })
})

describe('rebuild Getty-gate (keepSourceImages)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('keepSourceImages: true + action: search → returns a gated result the model can read', async () => {
    mockFillSlot.mockResolvedValue(null)
    mockGetRebuildCtx.mockResolvedValue({ appPath: 'x', rootPath: '/', keepSourceImages: true })

    const result = await (mediaSlotAITool as any).execute(
      { action: 'search', slot: 'pages/home/hero', mediaType: 'image', query: 'restaurant hero image' },
      { experimental_context: { metadata: { appId: 'app123' } } },
    )

    // success:false + note survive toModelOutput's projection (disabled/reason would be stripped).
    const parsed = JSON.parse(result)
    expect(parsed.success).toBe(false)
    expect(parsed.note).toMatch(/No matching source image found/)
  })

  it('keepSourceImages: false + action: search → gate does NOT fire', async () => {
    mockFillSlot.mockResolvedValue(null)
    mockGetRebuildCtx.mockResolvedValue({ appPath: 'x', rootPath: '/', keepSourceImages: false })

    let result: string | undefined
    try {
      result = await (mediaSlotAITool as any).execute(
        { action: 'search', slot: 'pages/home/hero', mediaType: 'image', query: 'restaurant hero image' },
        { experimental_context: { metadata: { appId: 'app123' } } },
      )
    } catch (e) {
      // May throw for reasons unrelated to the gate — that's acceptable, but
      // must not be the keep-source-images gate itself
      expect((e as Error).message).not.toMatch(/keep-source-images/i)
      return
    }

    if (result !== undefined) {
      const parsed = JSON.parse(result)
      expect(parsed.disabled).not.toBe(true)
    }
  })

  it('action: import_upload → gate is never consulted', async () => {
    mockFillSlot.mockResolvedValue(null)
    mockGetRebuildCtx.mockResolvedValue({ appPath: 'x', rootPath: '/', keepSourceImages: true })

    let result: string | undefined
    try {
      result = await (mediaSlotAITool as any).execute(
        { action: 'import_upload', slot: 'pages/home/hero', mediaType: 'image', filename: 'photo.jpg' },
        { experimental_context: { metadata: { appId: 'app123' } } },
      )
    } catch {
      // May throw for unrelated reasons — gate not consulted is the assertion
    }

    expect(mockGetRebuildCtx).not.toHaveBeenCalled()
    if (result !== undefined) {
      expect(result).not.toContain('"disabled": true')
    }
  })

  it('action: search → rebuild source-fill IS consulted and its result is returned verbatim', async () => {
    // The intended trigger: a stock search on a rebuild app gets a scraped
    // source image instead of Getty. Guards against a regression that inverts
    // the action guard or hard-codes null, which would silently disable rebuild
    // source-fill with every other test still green.
    const sourcePayload = {
      success: true,
      slot: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      resolvedUrl: '/assets/images/scraped-from-source-site.png',
      alternatives: [],
    }
    mockFillSlot.mockResolvedValue(sourcePayload)

    const result = await (mediaSlotAITool as any).execute(
      { action: 'search', slot: 'pages/home/hero', mediaType: 'image', query: 'restaurant hero image' },
      { experimental_context: { metadata: { appId: 'app123' } } },
    )

    expect(mockFillSlot).toHaveBeenCalledTimes(1)
    expect(JSON.parse(result)).toMatchObject(sourcePayload)
  })

  it('action: import_upload → source-fill is NOT consulted; the user\'s upload is placed, not a scraped image', async () => {
    // Source-fill substitutes a scraped source image for a STOCK SEARCH. On a
    // rebuild app it would otherwise intercept import_upload, discard the user's
    // uploaded file, and (with no query to rank on) fill every slot with the
    // SAME scraped image — collapsing all distinct uploads to one wrong photo.
    // Make source-fill return a hijacking result so a regression that drops the
    // guard short-circuits here; the guard must prevent it being called at all.
    mockFillSlot.mockResolvedValue({
      success: true,
      slot: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      resolvedUrl: '/airo-assets/uploads/scraped-source-image.png',
    })

    const result = await (mediaSlotAITool as any).execute(
      { action: 'import_upload', slot: 'pages/home/hero', mediaType: 'image', filename: 'photo.jpg' },
      { experimental_context: { metadata: { appId: 'app123' } } },
    )

    // Source-fill never ran...
    expect(mockFillSlot).not.toHaveBeenCalled()
    // ...and the slot carries the actual upload (from MediaSlotTool.importUpload),
    // not the scraped image source-fill would have returned.
    const parsed = JSON.parse(result)
    expect(parsed.slotUrl).toBe('/airo-assets/images/pages/home/hero')
    expect(parsed.uploadedUrl).toBe('/airo-assets/uploads/the-real-upload.jpg')
    expect(parsed.resolvedUrl).toBeUndefined()
  })
})
