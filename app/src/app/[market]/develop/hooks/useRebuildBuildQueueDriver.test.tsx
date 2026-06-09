/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useRebuildBuildQueue } from './useRebuildBuildQueue'
import { useRebuildBuildQueueDriver } from './useRebuildBuildQueueDriver'

const sendMock = vi.fn()
let processing = false

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => sendMock,
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => processing,
  useIsLoading: () => false,
}))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('useRebuildBuildQueueDriver', () => {
  beforeEach(() => {
    sendMock.mockReset()
    processing = false
    useRebuildBuildQueue.getState().stop()
  })

  it('sends the first slug when a batch is enqueued and the stream is idle', () => {
    const { rerender } = renderHook(() => useRebuildBuildQueueDriver())
    useRebuildBuildQueue.getState().enqueue(['about', 'contact'])
    rerender()
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('Build the about page', {
      isActionRequest: true,
      rebuildBuildPageSlug: 'about',
    })
    expect(useRebuildBuildQueue.getState().phase).toBe('sent')
  })

  it('does not send a second message until the first turn completes, then sends the next', () => {
    const { rerender } = renderHook(() => useRebuildBuildQueueDriver())
    useRebuildBuildQueue.getState().enqueue(['about', 'contact'])
    rerender()                       // sends about
    processing = true; rerender()    // about turn starts
    expect(sendMock).toHaveBeenCalledTimes(1)
    processing = false; rerender()   // about turn ends → advance
    rerender()                       // sends contact
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock).toHaveBeenLastCalledWith('Build the contact page', {
      isActionRequest: true,
      rebuildBuildPageSlug: 'contact',
    })
  })

  it('sends nothing when no batch is running', () => {
    const { rerender } = renderHook(() => useRebuildBuildQueueDriver())
    processing = true; rerender()
    processing = false; rerender()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('stops cleanly: after stop(), no further sends', () => {
    const { rerender } = renderHook(() => useRebuildBuildQueueDriver())
    useRebuildBuildQueue.getState().enqueue(['about', 'contact'])
    rerender()                       // sends about
    processing = true; rerender()
    useRebuildBuildQueue.getState().stop()
    processing = false; rerender()
    expect(sendMock).toHaveBeenCalledTimes(1)   // contact never sent
  })

  it('stop() during an in-flight turn halts; the trailing turn-end does not advance', () => {
    const { rerender } = renderHook(() => useRebuildBuildQueueDriver())
    useRebuildBuildQueue.getState().enqueue(['about', 'contact'])
    rerender()                       // sends about
    processing = true; rerender()    // about turn starts (in-turn)
    useRebuildBuildQueue.getState().stop()
    processing = false; rerender()   // about turn ends, but batch was stopped
    expect(useRebuildBuildQueue.getState().status).toBe('idle')
    expect(sendMock).toHaveBeenCalledTimes(1)   // contact never sent
  })

  it('watchdog recovers a stalled send when no turn ever starts', () => {
    vi.useFakeTimers()
    try {
      // Drive the store into the stalled 'sent' state (a send that never started a turn),
      // then mount the driver so it arms the watchdog on mount.
      useRebuildBuildQueue.getState().enqueue(['about'])
      useRebuildBuildQueue.getState().markSent() // phase 'sent', attempts 0
      renderHook(() => useRebuildBuildQueueDriver())
      expect(useRebuildBuildQueue.getState().phase).toBe('sent')
      act(() => { vi.advanceTimersByTime(8000) })
      // attempts survives the retry re-send (markSent doesn't touch it), so it's the
      // stable proof the watchdog fired and recovered.
      expect(useRebuildBuildQueue.getState().attempts).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('watchdog does not disturb a turn that started normally', () => {
    vi.useFakeTimers()
    try {
      processing = true
      useRebuildBuildQueue.getState().enqueue(['about'])
      useRebuildBuildQueue.getState().markSent()
      useRebuildBuildQueue.getState().onProcessingChange(true) // phase 'in-turn'
      renderHook(() => useRebuildBuildQueueDriver())
      act(() => { vi.advanceTimersByTime(20000) })
      expect(useRebuildBuildQueue.getState().phase).toBe('in-turn')
    } finally {
      vi.useRealTimers()
    }
  })
})
