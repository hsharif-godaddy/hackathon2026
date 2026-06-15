import { describe, it, expect, vi } from 'vitest'

vi.mock('../../media-slot-tool.js', () => ({
  MediaSlotTool: class {
    async selectMedia() {
      return { success: true }
    }
  },
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
