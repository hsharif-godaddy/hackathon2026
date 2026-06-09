/* eslint-disable react-hooks/rules-of-hooks -- renderHook callbacks trigger this rule */
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useUpfrontRebuildBuildQueue } from '@/app/[market]/develop/hooks/useUpfrontRebuildBuildQueue'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore'

const mockLoggerWarn = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

function seedQueue(appId: string) {
  const store = useUpfrontRebuildBuildQueueStore.getState()
  store.setPlan(appId, ['homepage', 'about', 'contact'], ['about', 'contact'])
  store.markProcessing(appId)
  store.markDevelopComplete(appId, 'homepage')
}

describe('useUpfrontRebuildBuildQueue', function useUpfrontRebuildBuildQueueTests() {
  beforeEach(function resetStores() {
    vi.useRealTimers()
    vi.clearAllMocks()
    useUpfrontRebuildBuildQueueStore.setState({ queues: {} })
    useStreamingConversationStore.getState().cleanup()
  })

  afterEach(function restoreTimers() {
    vi.useRealTimers()
  })

  it('dispatches next slug and confirms only after processing starts', function dispatchProcessingCycle() {
    seedQueue('app-1')
    const sendUserMessage = vi.fn()

    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: false } },
    )

    expect(sendUserMessage).toHaveBeenCalledWith('Build the about page', {
      isActionRequest: true,
      rebuildBuildPageSlug: 'about',
    })
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual([
      'about',
      'contact',
    ])
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBe('about')

    rerender({ isProcessing: true })

    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual(['contact'])
  })

  it('blocks duplicate dispatch while dispatchingRef is set', function dispatchingRefGuard() {
    seedQueue('app-1')
    const sendUserMessage = vi.fn()

    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: false } },
    )

    expect(sendUserMessage).toHaveBeenCalledTimes(1)

    rerender({ isProcessing: false })

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('warns when stream ends without build evidence for current slug', function streamEndFallback() {
    seedQueue('app-1')
    useUpfrontRebuildBuildQueueStore.getState().setCurrentBuild('app-1', 'about')

    const sendUserMessage = vi.fn()
    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: true } },
    )

    rerender({ isProcessing: false })

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'upfrontRebuildBuildQueue.streamEndWithoutBuildEvidence',
      { appId: 'app-1', slug: 'about' },
    )
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].developCompletedSlugs).toContain('about')
  })

  it('rolls back dispatch and logs error when send fails', async function dispatchFailure() {
    seedQueue('app-1')
    const sendUserMessage = vi.fn().mockRejectedValue(new Error('send failed'))

    renderHook(() => useUpfrontRebuildBuildQueue('app-1', false, sendUserMessage))

    await act(async function flushRejection() {
      await Promise.resolve()
    })

    expect(sendUserMessage).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'upfrontRebuildBuildQueue.dispatchFailed',
      expect.objectContaining({ appId: 'app-1', slug: 'about' }),
    )
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBeNull()
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual([
      'about',
      'contact',
    ])
  })

  it('blocks duplicate dispatch when store already has currentBuildSlug', function currentBuildSlugGuard() {
    seedQueue('app-1')
    useUpfrontRebuildBuildQueueStore.getState().setCurrentBuild('app-1', 'about')
    const sendUserMessage = vi.fn()

    renderHook(() => useUpfrontRebuildBuildQueue('app-1', false, sendUserMessage))

    expect(sendUserMessage).not.toHaveBeenCalled()
  })

  it('marks complete with build evidence without warning', function streamEndWithEvidence() {
    seedQueue('app-1')
    useUpfrontRebuildBuildQueueStore.getState().setCurrentBuild('app-1', 'about')
    const content = 'x'.repeat(120)
    useStreamingConversationStore.setState({
      messages: [{
        id: 'm1',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'tc-1',
          name: 'textEditor',
          status: 'completed',
          input: { command: 'create', path: 'src/pages/about.tsx', file_text: content },
        }],
      }],
      activeStream: null,
      streamingState: 'idle',
    })

    const sendUserMessage = vi.fn()
    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: true } },
    )

    rerender({ isProcessing: false })

    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'upfrontRebuildBuildQueue.streamEndWithoutBuildEvidence',
      expect.anything(),
    )
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].developCompletedSlugs).toContain('about')
  })

  it('dispatches remaining slugs sequentially after each completes', function sequentialDispatch() {
    seedQueue('app-1')
    const sendUserMessage = vi.fn()

    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: false } },
    )

    expect(sendUserMessage).toHaveBeenCalledWith('Build the about page', expect.any(Object))

    rerender({ isProcessing: true })
    rerender({ isProcessing: false })

    useUpfrontRebuildBuildQueueStore.getState().markDevelopComplete('app-1', 'about')
    useUpfrontRebuildBuildQueueStore.getState().setCurrentBuild('app-1', null)

    rerender({ isProcessing: false })

    expect(sendUserMessage).toHaveBeenCalledWith('Build the contact page', expect.any(Object))
  })

  it('clears queue when every plan slug is develop-complete', function autoClear() {
    const store = useUpfrontRebuildBuildQueueStore.getState()
    store.setPlan('app-1', ['homepage', 'about'], ['about'])
    store.markProcessing('app-1')
    store.markDevelopComplete('app-1', 'homepage')
    store.setCurrentBuild('app-1', 'about')

    const content = 'x'.repeat(120)
    useStreamingConversationStore.setState({
      messages: [{
        id: 'm1',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'tc-1',
          name: 'textEditor',
          status: 'completed',
          input: { command: 'create', path: 'src/pages/about.tsx', file_text: content },
        }],
      }],
      activeStream: null,
      streamingState: 'idle',
    })

    const sendUserMessage = vi.fn()
    const { rerender } = renderHook(
      ({ isProcessing }) => useUpfrontRebuildBuildQueue('app-1', isProcessing, sendUserMessage),
      { initialProps: { isProcessing: true } },
    )

    rerender({ isProcessing: false })

    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1']).toBeUndefined()
  })

  it('clears dispatch timeout when appId changes', function appIdChangeCleanup() {
    vi.useFakeTimers()
    seedQueue('app-1')
    useUpfrontRebuildBuildQueueStore.getState().setPlan('app-2', ['homepage', 'about'], ['about'])
    useUpfrontRebuildBuildQueueStore.getState().markDevelopComplete('app-2', 'homepage')
    const sendUserMessage = vi.fn()

    const { rerender } = renderHook(
      ({ appId, isProcessing }) => useUpfrontRebuildBuildQueue(appId, isProcessing, sendUserMessage),
      { initialProps: { appId: 'app-1', isProcessing: false } },
    )

    expect(sendUserMessage).toHaveBeenCalledTimes(1)

    rerender({ appId: 'app-2', isProcessing: false })

    act(function advanceTimeout() {
      vi.advanceTimersByTime(30_001)
    })

    expect(mockLoggerError).not.toHaveBeenCalledWith(
      'upfrontRebuildBuildQueue.dispatchTimeout',
      expect.objectContaining({ appId: 'app-1' }),
    )

    vi.useRealTimers()
  })

  it('rolls back dispatch on timeout when processing never starts', function dispatchTimeout() {
    vi.useFakeTimers()
    seedQueue('app-1')
    const sendUserMessage = vi.fn()

    const { unmount } = renderHook(() => useUpfrontRebuildBuildQueue('app-1', false, sendUserMessage))

    expect(sendUserMessage).toHaveBeenCalledTimes(1)

    act(function advanceTimeout() {
      vi.advanceTimersByTime(30_001)
    })

    expect(mockLoggerError).toHaveBeenCalledWith(
      'upfrontRebuildBuildQueue.dispatchTimeout',
      { appId: 'app-1', slug: 'about' },
    )
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual([
      'about',
      'contact',
    ])

    unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})
