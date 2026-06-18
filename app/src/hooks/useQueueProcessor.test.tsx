/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { mockInstrumentation } from '@/tests/mocks'
import { logImpressionEvent } from '@/utils/instrumentation'
import { useQueueProcessor } from './useQueueProcessor'

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/utils/instrumentation', () => mockInstrumentation())

function getState() {
  return useStreamingConversationStore.getState()
}

function Harness({
  enabled,
  sendMessage,
  isAwaitingStream = false,
}: {
  enabled: boolean
  sendMessage: (opts: never) => Promise<void>
  isAwaitingStream?: boolean
}) {
  useQueueProcessor({ enabled, sendMessage: sendMessage as never, isAwaitingStream })
  return null
}

function setStreamingState(state: Parameters<ReturnType<typeof getState>['setStreamingState']>[0]) {
  act(() => {
    getState().setStreamingState(state)
  })
}

function addCompletedMessage(partial: Partial<ChatMessage>) {
  act(() => {
    getState().addCompletedMessage({
      id: 'm-' + Math.random().toString(36).slice(2),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      ...partial,
    })
  })
}

describe('useQueueProcessor', () => {
  beforeEach(() => {
    act(() => {
      getState().cleanup()
    })
    vi.clearAllMocks()
  })

  it('does nothing when disabled', () => {
    const sendMessage = vi.fn(async () => {})
    act(() => {
      getState().enqueueMessage({ content: 'a' })
    })
    render(<Harness enabled={false} sendMessage={sendMessage} />)
    setStreamingState('idle')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('dequeues + sends the head when stream goes idle', async () => {
    // Mock mirrors production: sendMessage flips streamingState to 'streaming',
    // which gates the processor from dequeueing the next item until that
    // stream completes.
    const sendMessage = vi.fn(async () => {
      act(() => {
        getState().setStreamingState('streaming')
      })
    })
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'first' })
      getState().enqueueMessage({ content: 'second' })
    })

    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({ content: 'first' })
    expect(getState().queuedMessages.map((q) => q.content)).toEqual(['second'])
  })

  it('does not dequeue while streaming', () => {
    const sendMessage = vi.fn(async () => {})
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')
    act(() => {
      getState().enqueueMessage({ content: 'first' })
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(getState().queuedMessages).toHaveLength(1)
  })

  it('stops the queue when the stream completes with an error', async () => {
    const sendMessage = vi.fn(async () => {})
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'pending' })
    })

    addCompletedMessage({ upstreamError: true, content: 'failed' })
    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(getState().queuedMessages).toHaveLength(1)
  })

  it('does not stop on a clean completion', async () => {
    const sendMessage = vi.fn(async () => {
      act(() => {
        getState().setStreamingState('streaming')
      })
    })
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'a' })
    })

    addCompletedMessage({ content: 'ok' })
    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled()
    })
    expect(getState().queueStoppedOnError).toBe(false)
  })

  it('clears the stop flag when a later stream completes cleanly', async () => {
    const sendMessage = vi.fn(async () => {
      act(() => {
        getState().setStreamingState('streaming')
      })
    })
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'queued' })
      getState().setQueueStoppedOnError(true)
    })

    addCompletedMessage({ content: 'ok' })
    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(false)
    })
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({ content: 'queued' })
  })

  it('does not dequeue while stopped on error', async () => {
    const sendMessage = vi.fn(async () => {})
    render(<Harness enabled sendMessage={sendMessage} />)
    act(() => {
      getState().enqueueMessage({ content: 'a' })
      getState().setQueueStoppedOnError(true)
    })
    setStreamingState('idle')
    // Give effects a chance to run.
    await Promise.resolve()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(getState().queuedMessages).toHaveLength(1)
  })

  it('only dequeues one message per idle transition when sendMessage does not flip state synchronously', async () => {
    let resolveSend: (() => void) | null = null
    const sendMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
    )
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'first' })
      getState().enqueueMessage({ content: 'second' })
      getState().enqueueMessage({ content: 'third' })
    })

    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(getState().queuedMessages.map((q) => q.content)).toEqual(['second', 'third'])

    expect(resolveSend).not.toBeNull()
    await act(async () => {
      resolveSend!()
      await Promise.resolve()
    })
  })

  it('requeues at the head and stops when sendMessage returns silently without starting a stream', async () => {
    const sendMessage = vi.fn(async () => {})
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'first' })
      getState().enqueueMessage({ content: 'second' })
    })

    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(getState().queuedMessages.map((q) => q.content)).toEqual(['first', 'second'])
  })

  it('requeues at the head and stops when sendMessage rejects', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('boom')
    })
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'first' })
    })

    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })
    expect(getState().queuedMessages.map((q) => q.content)).toEqual(['first'])
  })

  it('requeues at the head and re-stops when sendMessage no-ops from error state', async () => {
    const sendMessage = vi.fn(async () => {})
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'first' })
      getState().enqueueMessage({ content: 'second' })
    })

    setStreamingState('error')
    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })

    act(() => {
      getState().setQueueStoppedOnError(false)
    })

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })
    expect(getState().queuedMessages.map((q) => q.content)).toEqual(['first', 'second'])
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('resumes from error state once the stop flag is cleared', async () => {
    const sendMessage = vi.fn(async () => {
      act(() => {
        getState().setStreamingState('streaming')
      })
    })
    render(<Harness enabled sendMessage={sendMessage} />)
    setStreamingState('streaming')

    act(() => {
      getState().enqueueMessage({ content: 'queued-after-failure' })
    })

    setStreamingState('error')
    await vi.waitFor(() => {
      expect(getState().queueStoppedOnError).toBe(true)
    })
    expect(sendMessage).not.toHaveBeenCalled()

    act(() => {
      getState().setQueueStoppedOnError(false)
    })

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({ content: 'queued-after-failure' })
  })

  it('does not dequeue while isAwaitingStream is true', async () => {
    const sendMessage = vi.fn(async () => {})
    const { rerender } = render(<Harness enabled sendMessage={sendMessage} isAwaitingStream />)
    setStreamingState('idle')

    act(() => {
      getState().enqueueMessage({ content: 'queued-during-await' })
    })
    await Promise.resolve()
    expect(sendMessage).not.toHaveBeenCalled()

    setStreamingState('streaming')
    rerender(<Harness enabled sendMessage={sendMessage} isAwaitingStream={false} />)
    setStreamingState('idle')

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({ content: 'queued-during-await' })
  })

  describe('instrumentation', () => {
    it('emits chat.queue.start impression on dequeue', async () => {
      const sendMessage = vi.fn(async () => {
        act(() => {
          getState().setStreamingState('streaming')
        })
      })
      render(<Harness enabled sendMessage={sendMessage} />)
      setStreamingState('streaming')

      act(() => {
        getState().enqueueMessage({ content: 'a' })
        getState().enqueueMessage({ content: 'b' })
      })

      setStreamingState('idle')

      await vi.waitFor(() => {
        expect(sendMessage).toHaveBeenCalledTimes(1)
      })
      expect(logImpressionEvent).toHaveBeenCalledWith(
        'chat.queue.start',
        expect.objectContaining({ remaining: 1, ageMs: expect.any(Number) }),
      )
    })

    it('emits chat.queue.complete impression after a queued item finishes successfully', async () => {
      const sendMessage = vi.fn(async () => {
        act(() => {
          getState().setStreamingState('streaming')
        })
      })
      render(<Harness enabled sendMessage={sendMessage} />)
      setStreamingState('streaming')

      act(() => {
        getState().enqueueMessage({ content: 'a' })
      })
      setStreamingState('idle')
      await vi.waitFor(() => {
        expect(sendMessage).toHaveBeenCalledTimes(1)
      })

      addCompletedMessage({ content: 'ok' })
      setStreamingState('idle')

      await vi.waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith(
          'chat.queue.complete',
          expect.objectContaining({ durationMs: expect.any(Number) }),
        )
      })
    })

    it('emits chat.queue.fail impression when the queued item stream errors out', async () => {
      const sendMessage = vi.fn(async () => {
        act(() => {
          getState().setStreamingState('streaming')
        })
      })
      render(<Harness enabled sendMessage={sendMessage} />)
      setStreamingState('streaming')

      act(() => {
        getState().enqueueMessage({ content: 'a' })
      })
      setStreamingState('idle')
      await vi.waitFor(() => {
        expect(sendMessage).toHaveBeenCalledTimes(1)
      })

      addCompletedMessage({ upstreamError: true, content: 'fail' })
      setStreamingState('idle')

      await vi.waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith(
          'chat.queue.fail',
          expect.objectContaining({ reason: 'message-failure' }),
        )
      })
    })
  })
})
