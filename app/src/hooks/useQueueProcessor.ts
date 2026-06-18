'use client'

import { useEffect, useRef } from 'react'

import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { queuedMessageToSendOptions } from '@/lib/messageQueue'
import { logger } from '@/lib/request-context'
import type { ChatMessage, QueuedMessage } from '@/stores/useStreamingConversationStore'
import {
  useIsQueueStoppedOnError,
  useQueuedMessages,
  useStreamingConversationStore,
  useStreamingState,
} from '@/stores/useStreamingConversationStore'

type SendMessageFn = (options: SendMessageOptions) => Promise<void>

export function useQueueProcessor(params: {
  enabled: boolean
  sendMessage: SendMessageFn
  isAwaitingStream: boolean
}): void {
  const { enabled, sendMessage, isAwaitingStream } = params
  const streamingState = useStreamingState()
  const queuedMessages = useQueuedMessages()
  const queueStoppedOnError = useIsQueueStoppedOnError()
  const sendRef = useRef(sendMessage)
  sendRef.current = sendMessage

  const prevStreamingStateRef = useRef(streamingState)

  useEffect(() => {
    if (!enabled) return
    const prev = prevStreamingStateRef.current
    prevStreamingStateRef.current = streamingState
    if (streamingState !== 'idle' && streamingState !== 'error') return
    if (prev === 'idle' || prev === 'error') return
    if (queuedMessages.length === 0) return

    const last: ChatMessage | undefined = useStreamingConversationStore
      .getState()
      .messages.slice(-1)[0]
    const failed =
      streamingState === 'error' ||
      Boolean(
        last && (
          last.error ||
          last.upstreamError ||
          last.userStopped ||
          last.connectionLost ||
          last.budgetExceeded ||
          last.maxStepsReached
        ),
      )
    if (failed) {
      logger.info('queue.stoppedOnError', {
        reason: streamingState === 'error' ? 'streaming-error' : 'message-failure',
        queueLength: queuedMessages.length,
      })
      useStreamingConversationStore.getState().setQueueStoppedOnError(true)
    } else if (useStreamingConversationStore.getState().queueStoppedOnError) {
      logger.info('queue.stoppedOnError.cleared', {
        reason: 'successful-stream-completion',
        queueLength: queuedMessages.length,
      })
      useStreamingConversationStore.getState().setQueueStoppedOnError(false)
    }
  }, [enabled, streamingState, queuedMessages.length])

  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (streamingState !== 'idle' && streamingState !== 'error') return
    if (isAwaitingStream) return
    if (queueStoppedOnError) return
    if (queuedMessages.length === 0) return
    if (inFlightRef.current) return

    const next: QueuedMessage | null = useStreamingConversationStore
      .getState()
      .takeNextQueuedMessage()
    if (!next) return

    logger.info('queue.dequeue', {
      id: next.id,
      remaining: queuedMessages.length - 1,
      contentPreview: next.content.slice(0, 60),
    })

    const payload = queuedMessageToSendOptions(next)

    inFlightRef.current = true

    void (async () => {
      try {
        await sendRef.current(payload)
        const postState = useStreamingConversationStore.getState().streamingState
        if (postState === 'idle' || postState === 'error') {
          logger.warn('queue.dequeue.silent-failure', { id: next.id, postState })
          useStreamingConversationStore.getState().requeueMessage(next)
          useStreamingConversationStore.getState().setQueueStoppedOnError(true)
        }
      } catch (err: unknown) {
        logger.error('queue.dequeue.send-failed', {
          id: next.id,
          message: err instanceof Error ? err.message : String(err),
        })
        useStreamingConversationStore.getState().requeueMessage(next)
        useStreamingConversationStore.getState().setQueueStoppedOnError(true)
      } finally {
        inFlightRef.current = false
      }
    })()
  }, [enabled, streamingState, queueStoppedOnError, queuedMessages, isAwaitingStream])
}
