import { describe, expect, it } from 'vitest'

import {
  getSlotVideoPosterUrl,
  isImageMediaUrl,
  resolveGeneratedVideoPlaybackUrl,
} from './slotImageUrl'

describe('slotImageUrl video helpers', () => {
  it('isImageMediaUrl rejects mp4 and /video/ paths', () => {
    expect(isImageMediaUrl('https://media.gettyimages.com/id/1/video/clip.mp4?sig=abc')).toBe(false)
    expect(isImageMediaUrl('https://media.gettyimages.com/thumb.jpg')).toBe(true)
  })

  it('getSlotVideoPosterUrl skips mp4 preview URLs', () => {
    expect(getSlotVideoPosterUrl('https://media.gettyimages.com/id/1/video/clip.mp4')).toBe('')
  })

  it('getSlotVideoPosterUrl returns jpeg URLs unchanged', () => {
    expect(getSlotVideoPosterUrl('https://media.gettyimages.com/thumb.jpg')).toBe(
      'https://media.gettyimages.com/thumb.jpg',
    )
  })

  it('resolveGeneratedVideoPlaybackUrl prefers slotUrl on preview origin', () => {
    expect(resolveGeneratedVideoPlaybackUrl(
      '/airo-assets/uploads/ai-video.mp4',
      'https://preview.example/app?token=abc',
      { slotUrl: '/airo-assets/videos/pages/home/hero' },
    )).toBe('https://preview.example/airo-assets/videos/pages/home/hero')
  })

  it('resolveGeneratedVideoPlaybackUrl returns raw url when preview is unavailable', () => {
    expect(resolveGeneratedVideoPlaybackUrl(
      '/airo-assets/uploads/ai-video.mp4',
      null,
    )).toBe('/airo-assets/uploads/ai-video.mp4')
  })
})
