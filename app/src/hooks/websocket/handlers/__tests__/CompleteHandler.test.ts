/**
 * CompleteHandler Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { CompleteHandler } from '../CompleteHandler'
import type { WebSocketMessage } from '../types'

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(),
  },
}))

import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

describe('CompleteHandler', () => {
  const handler = new CompleteHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finalizes stream and clears recovery state on completion', async () => {
    const clearConnectionRetry = vi.fn()
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: true },
      clearConnectionRetry,
    })

    const context = createMockMessageContext()
    const data: WebSocketMessage = {
      type: 'complete',
      content: '',
      data: {
        agentId: 'develop',
        usage: { totalTokens: 100 },
        step: 3,
        commitHash: 'abcdef1',
      },
    }

    await handler.handle(data, context)

    expect(context.actions.flushToolDeltaBufferImmediate).toHaveBeenCalled()
    expect(clearConnectionRetry).toHaveBeenCalled()
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({
      agentId: 'develop',
      usage: { totalTokens: 100 },
      totalSteps: 3,
    })
    expect(context.helpers.sendToolImpression).toHaveBeenCalledWith('complete')
    // Machine handles UI state transitions via STREAM_COMPLETE event (Tier 1)
    // Adapter syncs: setWebSocketState, setStreamingState, setIsLoading
    expect(context.helpers.handleCommitComplete).toHaveBeenCalledWith('abcdef1')
    // Note: We no longer clear the stored socket ID on completion to enable recovery on page reload
  })
})
