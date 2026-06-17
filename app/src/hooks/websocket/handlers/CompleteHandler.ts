import {
  checkNewPageCreation,
  incrementSessionPromptCount,
  invalidateMediaManifestIfNeeded,
  maybeFireEvalSnapshot,
  maybeShowFeedbackBanner,
  postInitialBuildEvent,
  scheduleUsageRefresh,
  trackCompletion,
  trackInitialBuildComplete,
  updateSiteTimestamp,
} from '@/hooks/shared/completionSideEffects'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from '@/hooks/shared/initialBuildFunnel'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { setInstrumentationIntentCategory } from '@/utils/instrumentation'
import { readIntentCategoryFromSession } from '@/utils/traffic-signals'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

function commitHashFromComplete(data: WebSocketMessage): string | undefined {
  const raw = data.data?.commitHash
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function messageIdFromComplete(data: WebSocketMessage): string | undefined {
  const raw = data.data?.messageId
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function traceIdsFromComplete(
  data: WebSocketMessage,
): { traceId: string; observationId: string; agentName?: string } | null {
  const traceId = data.data?.traceId
  const observationId = data.data?.observationId
  if (typeof traceId !== 'string' || typeof observationId !== 'string') return null
  if (!traceId || !observationId) return null
  const agentName = data.data?.agentId
  return {
    traceId,
    observationId,
    ...(typeof agentName === 'string' && agentName.length > 0 && { agentName }),
  }
}

export class CompleteHandler implements MessageHandler {
  readonly type = 'complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    context.actions.flushToolDeltaBufferImmediate()

    const commitHash = commitHashFromComplete(data)
    const appId = context.currentAppId

    incrementSessionPromptCount(appId)
    maybeShowFeedbackBanner()

    const traceIds = traceIdsFromComplete(data)
    useDevelopPageStore.getState().setLastCompleteTraceIds(traceIds)

    context.machine.send({ type: 'STREAM_COMPLETE' })

    const completeStore = useStreamingConversationStore.getState()
    if (completeStore.connectionRetry.isRetrying) {
      completeStore.clearConnectionRetry()
    }
    context.helpers.clearRetryState()

    context.actions.finalizeStream({
      agentId: data.data?.agentId as string | undefined,
      usage: data.data?.usage,
      totalSteps: data.data?.step as number | undefined,
      finishReason: data.data?.finishReason as string | undefined,
      usedFreeGrants: data.data?.usedFreeGrants as boolean | undefined,
      commitHash: commitHashFromComplete(data),
      messageId: messageIdFromComplete(data),
    })

    trackCompletion(!!data.data?.usage)
    trackInitialBuildComplete(commitHash)

    if (appId) {
      setInstrumentationIntentCategory(
        isInitialBuildFunnelActive() && !isInitialBuildComplete()
          ? 'new_build'
          : (readIntentCategoryFromSession(appId) ?? 'edit'),
      )
      invalidateMediaManifestIfNeeded(appId)

      if (commitHash) {
        await context.helpers.handleCommitComplete(commitHash)
        postInitialBuildEvent(appId)
      } else {
        await checkNewPageCreation(appId)
      }

      updateSiteTimestamp(appId)
    }

    maybeFireEvalSnapshot(commitHash, appId)
    scheduleUsageRefresh()
  }
}
