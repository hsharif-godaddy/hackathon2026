/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SocialPostState } from '@/types/social-posts'
import { emitPostPublished, emitPostUpdated, onPostPublished, onPostUpdated } from '@/utils/social/events'

describe('social events', () => {
  let mockWindow: typeof window

  beforeEach(() => {
    mockWindow = global.window as typeof window
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('emitPostPublished', () => {
    it('should dispatch custom event with postId and default PUBLISHED state', () => {
      const dispatchSpy = vi.spyOn(mockWindow, 'dispatchEvent')

      emitPostPublished('post-123')

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'social:post:published',
          detail: {
            postId: 'post-123',
            state: SocialPostState.PUBLISHED
          }
        })
      )
    })

    it('should dispatch custom event with postId and custom state', () => {
      const dispatchSpy = vi.spyOn(mockWindow, 'dispatchEvent')

      emitPostPublished('post-456', SocialPostState.SCHEDULED)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'social:post:published',
          detail: {
            postId: 'post-456',
            state: SocialPostState.SCHEDULED
          }
        })
      )
    })

    it('should dispatch custom event with FAILED state', () => {
      const dispatchSpy = vi.spyOn(mockWindow, 'dispatchEvent')

      emitPostPublished('post-789', SocialPostState.FAILED)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'social:post:published',
          detail: {
            postId: 'post-789',
            state: SocialPostState.FAILED
          }
        })
      )
    })
  })

  describe('onPostPublished', () => {
    it('should call callback when event is emitted', () => {
      const callback = vi.fn()

      onPostPublished(callback)
      emitPostPublished('post-123', SocialPostState.PUBLISHED)

      expect(callback).toHaveBeenCalledWith('post-123', SocialPostState.PUBLISHED)
    })

    it('should call callback with correct state for SCHEDULED', () => {
      const callback = vi.fn()

      onPostPublished(callback)
      emitPostPublished('post-456', SocialPostState.SCHEDULED)

      expect(callback).toHaveBeenCalledWith('post-456', SocialPostState.SCHEDULED)
    })

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      onPostPublished(callback1)
      onPostPublished(callback2)
      emitPostPublished('post-789', SocialPostState.PUBLISHED)

      expect(callback1).toHaveBeenCalledWith('post-789', SocialPostState.PUBLISHED)
      expect(callback2).toHaveBeenCalledWith('post-789', SocialPostState.PUBLISHED)
    })

    it('should return unsubscribe function that removes event listener', () => {
      const callback = vi.fn()

      const unsubscribe = onPostPublished(callback)
      unsubscribe()

      emitPostPublished('post-123', SocialPostState.PUBLISHED)

      expect(callback).not.toHaveBeenCalled()
    })

    it('should allow resubscription after unsubscribe', () => {
      const callback = vi.fn()

      const unsubscribe1 = onPostPublished(callback)
      unsubscribe1()

      emitPostPublished('post-1', SocialPostState.PUBLISHED)
      expect(callback).not.toHaveBeenCalled()

      onPostPublished(callback)
      emitPostPublished('post-2', SocialPostState.PUBLISHED)

      expect(callback).toHaveBeenCalledWith('post-2', SocialPostState.PUBLISHED)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should only call subscribed callbacks, not unsubscribed ones', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsubscribe1 = onPostPublished(callback1)
      onPostPublished(callback2)

      unsubscribe1()
      emitPostPublished('post-123', SocialPostState.PUBLISHED)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith('post-123', SocialPostState.PUBLISHED)
    })

    it('should handle rapid successive events', () => {
      const callback = vi.fn()

      onPostPublished(callback)

      emitPostPublished('post-1', SocialPostState.PUBLISHED)
      emitPostPublished('post-2', SocialPostState.SCHEDULED)
      emitPostPublished('post-3', SocialPostState.FAILED)

      expect(callback).toHaveBeenCalledTimes(3)
      expect(callback).toHaveBeenNthCalledWith(1, 'post-1', SocialPostState.PUBLISHED)
      expect(callback).toHaveBeenNthCalledWith(2, 'post-2', SocialPostState.SCHEDULED)
      expect(callback).toHaveBeenNthCalledWith(3, 'post-3', SocialPostState.FAILED)
    })
  })

  describe('emitPostUpdated', () => {
    it('should dispatch custom event with updated post detail', () => {
      const dispatchSpy = vi.spyOn(mockWindow, 'dispatchEvent')

      emitPostUpdated({
        id: 'post-123',
        styleLabel: 'Instagram',
        content: 'Updated copy',
        hashtags: [],
      })

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'social:post:updated',
          detail: {
            post: expect.objectContaining({
              id: 'post-123',
              content: 'Updated copy',
            })
          }
        })
      )
    })
  })

  describe('onPostUpdated', () => {
    it('should call callback when update event is emitted', () => {
      const callback = vi.fn()

      onPostUpdated(callback)
      emitPostUpdated({
        id: 'post-123',
        styleLabel: 'Instagram',
        content: 'Fresh content',
        hashtags: [],
      })

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'post-123',
          content: 'Fresh content',
        })
      )
    })

    it('should return unsubscribe function that removes update listener', () => {
      const callback = vi.fn()

      const unsubscribe = onPostUpdated(callback)
      unsubscribe()

      emitPostUpdated({
        id: 'post-123',
        styleLabel: 'Instagram',
        content: 'Fresh content',
        hashtags: [],
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('integration', () => {
    it('should support complete publish workflow', () => {
      const callback = vi.fn()

      const unsubscribe = onPostPublished(callback)

      emitPostPublished('post-1', SocialPostState.PUBLISHED)
      expect(callback).toHaveBeenLastCalledWith('post-1', SocialPostState.PUBLISHED)

      emitPostPublished('post-2', SocialPostState.SCHEDULED)
      expect(callback).toHaveBeenLastCalledWith('post-2', SocialPostState.SCHEDULED)

      unsubscribe()

      emitPostPublished('post-3', SocialPostState.PUBLISHED)
      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('should handle error state in workflow', () => {
      const callback = vi.fn()

      onPostPublished(callback)

      emitPostPublished('post-fail', SocialPostState.FAILED)

      expect(callback).toHaveBeenCalledWith('post-fail', SocialPostState.FAILED)
    })
  })
})
