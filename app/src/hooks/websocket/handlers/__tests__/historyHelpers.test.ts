import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { createMockMessageContext } from './testUtils'
import { emitLoadHistoryIfNeeded } from '../historyHelpers'

vi.mock('@/stores/useStreamingConversationStore', async () => {
  const actual = await vi.importActual('@/stores/useStreamingConversationStore')
  return {
    ...actual,
    useStreamingConversationStore: {
      getState: vi.fn(),
    },
  }
})

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

describe('emitLoadHistoryIfNeeded', function helperTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('no conversationId', function noConversationIdTests() {
    it('marks historyLoadingComplete and returns false when currentAppId is null', function nullAppId() {
      const setHistoryLoadingComplete = vi.fn()
      const context = createMockMessageContext({ currentAppId: null })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: false,
        setHistoryLoadingComplete,
      })

      expect(emitLoadHistoryIfNeeded(context, 'test')).toBe(false)
      expect(context.socket.emit).not.toHaveBeenCalled()
      expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    })

    it('marks historyLoadingComplete and returns false when cookie has no conversationId', function noCookie() {
      const setHistoryLoadingComplete = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue(null),
        },
      })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: false,
        setHistoryLoadingComplete,
      })

      expect(emitLoadHistoryIfNeeded(context, 'test')).toBe(false)
      expect(context.socket.emit).not.toHaveBeenCalled()
      expect(setHistoryLoadingComplete).toHaveBeenCalledWith(true)
    })

    it('does not call setHistoryLoadingComplete again when already complete', function noDoubleSet() {
      const setHistoryLoadingComplete = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue(null),
        },
      })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: true,
        setHistoryLoadingComplete,
      })

      emitLoadHistoryIfNeeded(context, 'test')

      expect(setHistoryLoadingComplete).not.toHaveBeenCalled()
    })
  })

  describe('guard conditions', function guardTests() {
    it('returns false without emitting when historyLoadingComplete is true', function alreadyLoaded() {
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: true,
        historyLoadRequested: false,
      })

      expect(emitLoadHistoryIfNeeded(context, 'test')).toBe(false)
      expect(context.socket.emit).not.toHaveBeenCalled()
    })

    it('returns false without emitting when historyLoadRequested is true', function alreadyRequested() {
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-abc'),
        },
      })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: false,
        historyLoadRequested: true,
      })

      expect(emitLoadHistoryIfNeeded(context, 'test')).toBe(false)
      expect(context.socket.emit).not.toHaveBeenCalled()
    })
  })

  describe('successful emission', function emissionTests() {
    it('sets historyLoadRequested, emits load_history with conversationId, and returns true', function emits() {
      const setHistoryLoadRequested = vi.fn()
      const context = createMockMessageContext({
        helpers: {
          ...createMockMessageContext().helpers,
          getConversationIdFromCookie: vi.fn().mockReturnValue('conv-xyz'),
        },
      })

      mockStore.getState.mockReturnValue({
        historyLoadingComplete: false,
        historyLoadRequested: false,
        setHistoryLoadRequested,
      })

      expect(emitLoadHistoryIfNeeded(context, 'agents_available')).toBe(true)
      expect(setHistoryLoadRequested).toHaveBeenCalledWith(true)
      expect(context.socket.emit).toHaveBeenCalledWith('load_history', { conversationId: 'conv-xyz' })
    })
  })
})
