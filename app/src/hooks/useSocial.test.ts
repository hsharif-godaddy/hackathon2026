import { describe, expect, it, vi } from 'vitest'

import { parsePayload, toPostState } from '@/hooks/useSocial'
import { logger } from '@/lib/request-context'
import { SocialPostState } from '@/types/social-posts'

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

describe('useSocial helpers', () => {
  describe('parsePayload', () => {
    it('returns parsed payload when input is valid JSON string', () => {
      const payload = parsePayload('{"message":"hello","imageUrls":["https://cdn.example/image.png"]}')

      expect(payload).toEqual({
        message: 'hello',
        imageUrls: ['https://cdn.example/image.png'],
      })
    })

    it('returns object payload as-is', () => {
      const payload = parsePayload({
        message: 'from-object',
        imageUrls: ['https://cdn.example/object.png'],
      })

      expect(payload).toEqual({
        message: 'from-object',
        imageUrls: ['https://cdn.example/object.png'],
      })
    })

    it('returns empty object and logs warning when JSON is invalid', () => {
      const payload = parsePayload('not-json')

      expect(payload).toEqual({})
      expect(logger.warn).toHaveBeenCalledWith(
        'social.posts.parse-payload.failed',
        expect.objectContaining({
          payload: 'not-json',
        }),
      )
    })
  })

  describe('toPostState', () => {
    it('returns enum value for valid state', () => {
      expect(toPostState('DRAFT')).toBe(SocialPostState.DRAFT)
      expect(toPostState('PUBLISHED')).toBe(SocialPostState.PUBLISHED)
      expect(toPostState('SCHEDULED')).toBe(SocialPostState.SCHEDULED)
      expect(toPostState('FAILED')).toBe(SocialPostState.FAILED)
    })

    it('returns undefined for invalid state values', () => {
      expect(toPostState('published')).toBeUndefined()
      expect(toPostState('UNKNOWN')).toBeUndefined()
      expect(toPostState('')).toBeUndefined()
    })
  })
})
