import { useEffect, useRef } from 'react'

import type { SendMessageOptions } from '@/app/[market]/develop/components/chat/ChatContext'
import { extractDevelopBuiltSlugsFromToolCalls } from '@/app/[market]/develop/components/utils'
import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore'

type SendUserMessage = (content: string, options?: SendMessageOptions) => void | Promise<void>

const DISPATCH_TIMEOUT_MS = 30_000

function getLatestAssistantToolCalls() {
  const { messages, activeStream } = useStreamingConversationStore.getState()
  if (activeStream && !activeStream.isComplete) {
    return activeStream.toolCalls ?? []
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      return messages[i].toolCalls ?? []
    }
  }
  return []
}

function markSlugCompleteOnStreamEnd(
  appId: string,
  slug: string,
  builtSlugs: string[],
  markDevelopComplete: (appId: string, slug: string) => void,
) {
  if (!builtSlugs.includes(slug)) {
    logger.warn('upfrontRebuildBuildQueue.streamEndWithoutBuildEvidence', { appId, slug })
  }
  markDevelopComplete(appId, slug)
}

/**
 * After a scoped initial rebuild, automatically trigger develop builds for
 * inner pages queued by websiteRebuild (homepage is handled via handoff).
 * Progress is shown in the rebuild page selector.
 */
export function useUpfrontRebuildBuildQueue(
  appId: string | null,
  isProcessing: boolean,
  sendUserMessage: SendUserMessage | undefined,
) {
  const markProcessing = useUpfrontRebuildBuildQueueStore(state => state.markProcessing)
  const peekNext = useUpfrontRebuildBuildQueueStore(state => state.peekNext)
  const confirmDispatched = useUpfrontRebuildBuildQueueStore(state => state.confirmDispatched)
  const rollbackDispatch = useUpfrontRebuildBuildQueueStore(state => state.rollbackDispatch)
  const setCurrentBuild = useUpfrontRebuildBuildQueueStore(state => state.setCurrentBuild)
  const markDevelopComplete = useUpfrontRebuildBuildQueueStore(state => state.markDevelopComplete)
  const clear = useUpfrontRebuildBuildQueueStore(state => state.clear)
  const queueEntry = useUpfrontRebuildBuildQueueStore(state => (appId ? state.queues[appId] : undefined))
  const dispatchingRef = useRef(false)
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevAppIdRef = useRef(appId)
  const prevIsProcessingRef = useRef(isProcessing)

  useEffect(function clearDispatchTimeoutOnUnmount() {
    return function cleanup() {
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current)
      }
    }
  }, [])

  useEffect(function trackProcessingForUpfrontQueue() {
    if (isProcessing && appId) {
      markProcessing(appId)
    }
    if (isProcessing && dispatchingRef.current && appId) {
      const slug = useUpfrontRebuildBuildQueueStore.getState().queues[appId]?.currentBuildSlug
      if (slug) {
        confirmDispatched(appId, slug)
      }
      dispatchingRef.current = false
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current)
        dispatchTimeoutRef.current = null
      }
    }
  }, [appId, isProcessing, markProcessing, confirmDispatched])

  useEffect(function markDevelopCompleteOnStreamEnd() {
    const wasProcessing = prevIsProcessingRef.current
    prevIsProcessingRef.current = isProcessing

    if (!appId || isProcessing || !wasProcessing) return

    const entry = useUpfrontRebuildBuildQueueStore.getState().queues[appId]
    if (!entry) return

    const builtSlugs = extractDevelopBuiltSlugsFromToolCalls(getLatestAssistantToolCalls())

    for (const slug of builtSlugs) {
      if (entry.planSlugs.includes(slug)) {
        markDevelopComplete(appId, slug)
      }
    }

    const refreshed = useUpfrontRebuildBuildQueueStore.getState().queues[appId]
    if (!refreshed) return

    if (refreshed.currentBuildSlug) {
      markSlugCompleteOnStreamEnd(appId, refreshed.currentBuildSlug, builtSlugs, markDevelopComplete)
      setCurrentBuild(appId, null)
    } else if (
      refreshed.planSlugs[0] &&
      !refreshed.developCompletedSlugs.includes(refreshed.planSlugs[0])
    ) {
      markSlugCompleteOnStreamEnd(appId, refreshed.planSlugs[0], builtSlugs, markDevelopComplete)
    }

    const updated = useUpfrontRebuildBuildQueueStore.getState().queues[appId]
    if (
      updated &&
      updated.planSlugs.length > 0 &&
      updated.developCompletedSlugs.length >= updated.planSlugs.length
    ) {
      clear(appId)
    }
  }, [appId, isProcessing, markDevelopComplete, setCurrentBuild, clear])

  useEffect(function dispatchNextUpfrontRebuildPage() {
    if (prevAppIdRef.current !== appId) {
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current)
        dispatchTimeoutRef.current = null
      }
      dispatchingRef.current = false
      prevAppIdRef.current = appId
    }

    if (isProcessing || !appId || !sendUserMessage || dispatchingRef.current) return

    const entry = useUpfrontRebuildBuildQueueStore.getState().queues[appId]
    if (entry?.currentBuildSlug) return

    const slug = peekNext(appId)
    if (!slug) return

    dispatchingRef.current = true
    setCurrentBuild(appId, slug)

    dispatchTimeoutRef.current = setTimeout(function dispatchTimeout() {
      if (!dispatchingRef.current || !appId) return
      logger.error('upfrontRebuildBuildQueue.dispatchTimeout', { appId, slug })
      rollbackDispatch(appId)
      dispatchingRef.current = false
      dispatchTimeoutRef.current = null
    }, DISPATCH_TIMEOUT_MS)

    void Promise.resolve(
      sendUserMessage(`Build the ${slug} page`, {
        isActionRequest: true,
        rebuildBuildPageSlug: slug,
      }),
    ).catch(function dispatchFailed(error: unknown) {
      if (!appId) return
      logger.error('upfrontRebuildBuildQueue.dispatchFailed', {
        appId,
        slug,
        error: error instanceof Error ? error.message : String(error),
      })
      rollbackDispatch(appId)
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current)
      }
      dispatchTimeoutRef.current = setTimeout(function dispatchRetryTimeout() {
        dispatchingRef.current = false
        dispatchTimeoutRef.current = null
      }, DISPATCH_TIMEOUT_MS)
    })

    return function cleanupDispatchEffect() {
      if (dispatchingRef.current) return
      if (dispatchTimeoutRef.current) {
        clearTimeout(dispatchTimeoutRef.current)
        dispatchTimeoutRef.current = null
      }
    }
  }, [appId, isProcessing, sendUserMessage, peekNext, setCurrentBuild, rollbackDispatch, queueEntry])
}
