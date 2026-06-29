import { describe, expect, it } from 'vitest'

import {
  getSlotVideoPosterUrl,
  isImageMediaUrl,
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
})
