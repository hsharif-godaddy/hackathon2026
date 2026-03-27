/**
 * CompleteHandler Tests
 * @vitest-environment jsdom
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
    sessionStorage.removeItem('airo_eval_snapshot_app_build_count_app-123')
  })

  it('finalizes stream and clears recovery state on completion', async () => {
    const clearConnectionRetry = vi.fn()
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: true },
      clearConnectionRetry,
      messages: [],
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
  })

  it('dispatches eval-snapshot-trigger on first completion with commitHash', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    sessionStorage.removeItem('airo_eval_snapshot_app_build_count_app-123')
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    await handler.handle(
      {
        type: 'complete',
        content: '',
        data: { commitHash: 'abc1111' },
      },
      createMockMessageContext()
    )

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eval-snapshot-trigger' })
    )
    expect(sessionStorage.getItem('airo_eval_snapshot_app_build_count_app-123')).toBe('1')
    dispatchSpy.mockRestore()
  })

  it('does not dispatch eval-snapshot-trigger when commitHash is absent', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    sessionStorage.removeItem('airo_eval_snapshot_app_build_count_app-123')
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [{ role: 'assistant' as const, toolCalls: [{ id: '1', name: 'edit_file' }] }],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eval-snapshot-trigger' })
    )
    expect(sessionStorage.getItem('airo_eval_snapshot_app_build_count_app-123')).toBe(null)
    dispatchSpy.mockRestore()
  })
})
