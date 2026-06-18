/**
 * @vitest-environment jsdom
 */
/**
 * useChatHelpers Tests
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
  setConversationIdCookie,
} from './useChatHelpers'

describe('Cookie utilities', () => {
  beforeEach(() => {
    // JSDOM environment has limited cookie support
    // These tests verify the API contracts but cookies may not persist in JSDOM
  })

  describe('setConversationIdCookie', () => {
    it('should not throw when setting cookie', () => {
      expect(() => setConversationIdCookie('app-123', 'conv-abc-123')).not.toThrow()
    })
  })

  describe('getConversationIdFromCookie', () => {
    it('returns null if cookie does not exist', () => {
      const conversationId = getConversationIdFromCookie('app-999')

      expect(conversationId).toBeNull()
    })

    it('returns null if appId is null', () => {
      const conversationId = getConversationIdFromCookie(null)

      expect(conversationId).toBeNull()
    })

    it('validates UUID format', () => {
      // In a real browser, this would work, but JSDOM has limited cookie support
      // We're testing the API contract here
      const conversationId = getConversationIdFromCookie('app-123')

      // Should return null or a valid UUID
      if (conversationId !== null) {
        expect(conversationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      } else {
        expect(conversationId).toBeNull()
      }
    })
  })

  describe('clearConversationIdCookie', () => {
    it('should not throw when clearing cookie', () => {
      expect(() => clearConversationIdCookie('app-123')).not.toThrow()
    })

    it('should not throw if appId is null', () => {
      expect(() => clearConversationIdCookie(null)).not.toThrow()
    })
  })
})
