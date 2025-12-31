/**
 * ChunkHandler Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { ChunkHandler } from '../ChunkHandler'
import type { MessageContext, WebSocketMessage } from '../types'

// Mock the store
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(),
  },
}))

describe('ChunkHandler', () => {
  let handler: ChunkHandler
  let mockContext: MessageContext
  let mockSocket: any

  beforeEach(() => {
    handler = new ChunkHandler()
    mockSocket = { id: 'socket-123' }

    mockContext = {
      socket: mockSocket,
      currentAppId: 'app-1',
      actions: {
        appendTextSegment: vi.fn(),
        setStreamingState: vi.fn(),
        setWebSocketState: vi.fn(),
      },
      helpers: {},
      refs: {},
    } as any

    // Reset store mock
    ;(useStreamingConversationStore.getState as any).mockReturnValue({
      streamingState: 'streaming',
      connectionRetry: {
        isRetrying: false,
      },
    })
  })

  it('should have correct type', () => {
    expect(handler.type).toBe('chunk')
  })

  it('should append text segment when streaming', async () => {
    const data: WebSocketMessage = {
      type: 'chunk',
      content: 'Hello world',
      data: {},
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.appendTextSegment).toHaveBeenCalledWith('Hello world')
    expect(mockContext.actions.setStreamingState).not.toHaveBeenCalled()
  })

  it('should transition from retrying to streaming state', async () => {
    ;(useStreamingConversationStore.getState as any).mockReturnValue({
      streamingState: 'retrying',
      connectionRetry: {
        isRetrying: true,
      },
      clearConnectionRetry: vi.fn(),
    })

    const data: WebSocketMessage = {
      type: 'chunk',
      content: 'Hello world',
      data: {},
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.setStreamingState).toHaveBeenCalledWith('streaming')
    expect(mockContext.actions.setWebSocketState).toHaveBeenCalledWith({
      connected: true,
      status: 'streaming',
      error: undefined,
    })
    expect(mockContext.actions.appendTextSegment).toHaveBeenCalledWith('Hello world')
  })

  it('should transition from error to streaming state', async () => {
    ;(useStreamingConversationStore.getState as any).mockReturnValue({
      streamingState: 'error',
      connectionRetry: {
        isRetrying: false,
      },
    })

    const data: WebSocketMessage = {
      type: 'chunk',
      content: 'Recovered',
      data: {},
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.setStreamingState).toHaveBeenCalledWith('streaming')
    expect(mockContext.actions.setWebSocketState).toHaveBeenCalledWith({
      connected: true,
      status: 'streaming',
      error: undefined,
    })
    expect(mockContext.actions.appendTextSegment).toHaveBeenCalledWith('Recovered')
  })

  it('should clear connection retry state when retrying', async () => {
    const mockClearConnectionRetry = vi.fn()
    ;(useStreamingConversationStore.getState as any).mockReturnValue({
      streamingState: 'retrying',
      connectionRetry: {
        isRetrying: true,
      },
      clearConnectionRetry: mockClearConnectionRetry,
    })

    const data: WebSocketMessage = {
      type: 'chunk',
      content: 'Test',
      data: {},
    }

    await handler.handle(data, mockContext)

    expect(mockClearConnectionRetry).toHaveBeenCalled()
  })
})
