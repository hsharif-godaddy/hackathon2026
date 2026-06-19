// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSetQueryData = vi.fn()
vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: () => ({ setQueryData: (...args: unknown[]) => mockSetQueryData(...args) }),
}))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { handleMediaCaptionNotification } from '../mediaCaptionNotification'

describe('handleMediaCaptionNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates slot and manifest caches on a valid event', () => {
    handleMediaCaptionNotification({
      raw: { appId: 'app-123', slotName: 'pages/home/hero', caption: 'sunset over mountains' },
      clientAppId: 'app-123',
      logPrefix: 'sse.media_caption',
    })

    expect(mockSetQueryData).toHaveBeenCalledWith(
      ['mediaSlot', 'app-123', 'pages/home/hero'],
      expect.any(Function),
    )
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ['mediaManifest', 'app-123'],
      expect.any(Function),
    )
  })

  it('applies the caption via the slot updater (and no-ops on empty cache)', () => {
    handleMediaCaptionNotification({
      raw: { appId: 'app-123', slotName: 'hero', caption: 'golden retriever running' },
      clientAppId: 'app-123',
      logPrefix: 'sse.media_caption',
    })

    const slotUpdater = mockSetQueryData.mock.calls[0][1] as (old: unknown) => unknown
    const oldSlot = { currentUrl: '/img.jpg', mediaType: 'image', searchQuery: '' }
    expect(slotUpdater(oldSlot)).toEqual({
      ...oldSlot,
      caption: 'golden retriever running',
      searchQuery: 'golden retriever running',
    })
    expect(slotUpdater(null)).toBeNull()
  })

  it('patches only the named slot in the manifest updater, leaving others untouched', () => {
    handleMediaCaptionNotification({
      raw: { appId: 'app-123', slotName: 'hero', caption: 'a caption' },
      clientAppId: 'app-123',
      logPrefix: 'sse.media_caption',
    })

    const manifestUpdater = mockSetQueryData.mock.calls[1][1] as (old: unknown) => unknown
    const manifest = {
      hero: { currentUrl: '/hero.jpg', searchQuery: '' },
      about: { currentUrl: '/about.jpg', searchQuery: 'team' },
    }
    expect(manifestUpdater(manifest)).toEqual({
      hero: { currentUrl: '/hero.jpg', searchQuery: 'a caption', caption: 'a caption' },
      about: { currentUrl: '/about.jpg', searchQuery: 'team' },
    })
    // Absent slot → manifest returned untouched
    expect(manifestUpdater({ other: { currentUrl: '/x.jpg' } })).toEqual({ other: { currentUrl: '/x.jpg' } })
    expect(manifestUpdater(null)).toBeNull()
  })

  it('ignores events for a different appId', () => {
    handleMediaCaptionNotification({
      raw: { appId: 'app-123', slotName: 'hero', caption: 'test' },
      clientAppId: 'app-999',
      logPrefix: 'sse.media_caption',
    })

    expect(mockSetQueryData).not.toHaveBeenCalled()
  })

  it('ignores malformed event data (missing slotName/caption)', () => {
    handleMediaCaptionNotification({
      raw: { appId: 'app-123' },
      clientAppId: 'app-123',
      logPrefix: 'sse.media_caption',
    })

    expect(mockSetQueryData).not.toHaveBeenCalled()
  })
})
