import { beforeEach,describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { MediaCaptionHandler } from '../MediaCaptionHandler'

// Mock getQueryClient
const mockSetQueryData = vi.fn()
vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: () => ({ setQueryData: mockSetQueryData }),
}))

describe('MediaCaptionHandler', () => {
  let handler: MediaCaptionHandler

  beforeEach(() => {
    handler = new MediaCaptionHandler()
    vi.clearAllMocks()
  })

  it('has type "media_caption"', () => {
    expect(handler.type).toBe('media_caption')
  })

  it('updates slot and manifest caches on valid event', async () => {
    const context = createMockMessageContext({ currentAppId: 'app-123' })
    const message = {
      type: 'media_caption',
      content: '',
      data: { appId: 'app-123', slotName: 'pages/home/hero', caption: 'sunset over mountains' },
    }

    await handler.handle(message, context)

    // Should update slot cache
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ['mediaSlot', 'app-123', 'pages/home/hero'],
      expect.any(Function)
    )
    // Should update manifest cache
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ['mediaManifest', 'app-123'],
      expect.any(Function)
    )
  })

  it('applies caption to existing slot data', async () => {
    const context = createMockMessageContext({ currentAppId: 'app-123' })
    const message = {
      type: 'media_caption',
      content: '',
      data: { appId: 'app-123', slotName: 'hero', caption: 'golden retriever running' },
    }

    await handler.handle(message, context)

    // Verify the updater function works correctly for slot cache
    const slotUpdater = mockSetQueryData.mock.calls[0][1]
    const oldSlot = { currentUrl: '/img.jpg', mediaType: 'image', searchQuery: '' }
    expect(slotUpdater(oldSlot)).toEqual({ ...oldSlot, caption: 'golden retriever running', searchQuery: 'golden retriever running' })
    expect(slotUpdater(null)).toBeNull()
  })

  it('ignores events for different appId', async () => {
    const context = createMockMessageContext({ currentAppId: 'app-999' })
    const message = {
      type: 'media_caption',
      content: '',
      data: { appId: 'app-123', slotName: 'hero', caption: 'test' },
    }

    await handler.handle(message, context)

    expect(mockSetQueryData).not.toHaveBeenCalled()
  })

  it('ignores malformed event data', async () => {
    const context = createMockMessageContext({ currentAppId: 'app-123' })
    const message = {
      type: 'media_caption',
      content: '',
      data: { appId: 'app-123' }, // missing slotName and caption
    }

    await handler.handle(message, context)

    expect(mockSetQueryData).not.toHaveBeenCalled()
  })
})
