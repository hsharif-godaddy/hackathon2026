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
import { logImpressionEvent } from '@/utils/instrumentation'

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
  const pendingQueuedItemRef = useRef<{ id: string; startedAt: number } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const prev = prevStreamingStateRef.current
    prevStreamingStateRef.current = streamingState
    if (streamingState !== 'idle' && streamingState !== 'error') return
    if (prev === 'idle' || prev === 'error') return

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
    const reason = streamingState === 'error' ? 'streaming-error' : 'message-failure'

    const pending = pendingQueuedItemRef.current
    if (pending) {
      const durationMs = Date.now() - pending.startedAt
      if (failed) {
        logger.info('queue.message.failed', { id: pending.id, durationMs, reason })
        logImpressionEvent('chat.queue.fail', { durationMs, reason })()
      } else {
        logger.info('queue.message.completed', { id: pending.id, durationMs })
        logImpressionEvent('chat.queue.complete', { durationMs })()
      }
      pendingQueuedItemRef.current = null
    }

    if (failed && queuedMessages.length > 0) {
      logger.info('queue.stoppedOnError', { reason, queueLength: queuedMessages.length })
      useStreamingConversationStore.getState().setQueueStoppedOnError(true)
    } else if (!failed && useStreamingConversationStore.getState().queueStoppedOnError) {
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

    const startedAt = Date.now()
    const ageMs = startedAt - next.enqueuedAt
    const remaining = queuedMessages.length - 1
    logger.info('queue.message.started', {
      id: next.id,
      remaining,
      ageMs,
      contentPreview: next.content.slice(0, 60),
    })
    logImpressionEvent('chat.queue.start', { ageMs, remaining })()
    pendingQueuedItemRef.current = { id: next.id, startedAt }

    const payload = queuedMessageToSendOptions(next)

    inFlightRef.current = true

    void (async () => {
      try {
        await sendRef.current(payload)
        const postState = useStreamingConversationStore.getState().streamingState
        if (postState === 'idle' || postState === 'error') {
          logger.warn('queue.message.failed', { id: next.id, reason: 'silent-failure', postState })
          logImpressionEvent('chat.queue.fail', { reason: 'silent-failure' })()
          pendingQueuedItemRef.current = null
          useStreamingConversationStore.getState().requeueMessage(next)
          useStreamingConversationStore.getState().setQueueStoppedOnError(true)
        }
      } catch (err: unknown) {
        logger.error('queue.message.failed', {
          id: next.id,
          reason: 'send-error',
          message: err instanceof Error ? err.message : String(err),
        })
        logImpressionEvent('chat.queue.fail', { reason: 'send-error' })()
        pendingQueuedItemRef.current = null
        useStreamingConversationStore.getState().requeueMessage(next)
        useStreamingConversationStore.getState().setQueueStoppedOnError(true)
      } finally {
        inFlightRef.current = false
      }
    })()
  }, [enabled, streamingState, queueStoppedOnError, queuedMessages, isAwaitingStream])
}
