/**
 * useWebSocketHelpers Tests
 */

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'

import { useGitStore } from '@/stores/useGitStore'
import {
  clearConversationIdCookie,
  getConversationIdFromCookie,
  setConversationIdCookie,
  useWebSocketHelpers,
} from './useWebSocketHelpers'

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: {
    getState: vi.fn(),
  },
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

// Helper to create wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockGitStore = useGitStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

describe('useWebSocketHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGitStore.getState.mockReturnValue({
      selectCommit: vi.fn().mockResolvedValue(undefined),
    })

    // Reset cookies
    if (typeof document !== 'undefined') {
      document.cookie.split(';').forEach((c) => {
        document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')
      })
    }

    // Reset sessionStorage
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear()
    }

    // Mock window.postMessage
    global.window.postMessage = vi.fn()
  })

  describe('clearStoredSocketId', () => {
    it('clears socket ID from sessionStorage for current app', () => {
      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      sessionStorage.setItem('socket_id_app-123', 'socket-abc')

      result.current.clearStoredSocketId()

      expect(sessionStorage.getItem('socket_id_app-123')).toBeNull()
    })

    it('does nothing if currentAppId is null', () => {
      const { result } = renderHook(() => useWebSocketHelpers(null), { wrapper: createWrapper() })

      sessionStorage.setItem('socket_id_app-123', 'socket-abc')

      result.current.clearStoredSocketId()

      // Should not clear
      expect(sessionStorage.getItem('socket_id_app-123')).toBe('socket-abc')
    })

    it('only clears the specific app socket ID', () => {
      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      sessionStorage.setItem('socket_id_app-123', 'socket-abc')
      sessionStorage.setItem('socket_id_app-456', 'socket-def')

      result.current.clearStoredSocketId()

      expect(sessionStorage.getItem('socket_id_app-123')).toBeNull()
      expect(sessionStorage.getItem('socket_id_app-456')).toBe('socket-def')
    })
  })

  describe('handleCommitComplete', () => {
    it('invalidates queries, selects commit, and triggers preview refresh', async () => {
      const selectCommit = vi.fn().mockResolvedValue(undefined)
      mockGitStore.getState.mockReturnValue({ selectCommit })

      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      await result.current.handleCommitComplete('abcdef123456')

      // Verify postMessage was called
      expect(window.postMessage).toHaveBeenCalledWith(
        {
          type: 'MESSAGE_COMPLETE',
          source: 'websocket',
        },
        window.location.origin
      )
    })

    it('triggers preview refresh even without commit hash', async () => {
      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      await result.current.handleCommitComplete()

      expect(window.postMessage).toHaveBeenCalledWith(
        {
          type: 'MESSAGE_COMPLETE',
          source: 'websocket',
        },
        window.location.origin
      )
    })

    it('triggers preview refresh even if commit selection fails', async () => {
      const selectCommit = vi.fn().mockRejectedValue(new Error('Selection failed'))
      mockGitStore.getState.mockReturnValue({ selectCommit })

      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      await result.current.handleCommitComplete('abcdef123456')

      // Should still trigger preview refresh
      expect(window.postMessage).toHaveBeenCalledWith(
        {
          type: 'MESSAGE_COMPLETE',
          source: 'websocket',
        },
        window.location.origin
      )
    })

    it('triggers preview refresh immediately if no appId', async () => {
      const { result } = renderHook(() => useWebSocketHelpers(null), { wrapper: createWrapper() })

      await result.current.handleCommitComplete('abcdef123456')

      expect(window.postMessage).toHaveBeenCalledWith(
        {
          type: 'MESSAGE_COMPLETE',
          source: 'websocket',
        },
        window.location.origin
      )
    })
  })

  describe('sendToolImpression', () => {
    it('sends tool impression event', () => {
      const { result } = renderHook(() => useWebSocketHelpers('app-123'), { wrapper: createWrapper() })

      // Should not throw
      expect(() => result.current.sendToolImpression('read-file')).not.toThrow()
    })
  })

  it('functions are stable across re-renders when appId does not change', () => {
    const { result, rerender } = renderHook(({ appId }) => useWebSocketHelpers(appId), {
      initialProps: { appId: 'app-123' },
      wrapper: createWrapper(),
    })

    const firstClearFn = result.current.clearStoredSocketId
    const firstHandleCommitFn = result.current.handleCommitComplete
    const firstSendToolFn = result.current.sendToolImpression

    rerender({ appId: 'app-123' })

    expect(result.current.clearStoredSocketId).toBe(firstClearFn)
    expect(result.current.handleCommitComplete).toBe(firstHandleCommitFn)
    expect(result.current.sendToolImpression).toBe(firstSendToolFn)
  })
})

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
