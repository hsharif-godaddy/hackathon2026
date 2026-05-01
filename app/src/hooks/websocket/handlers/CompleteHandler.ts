import {
  checkNewPageCreation,
  incrementSessionPromptCount,
  invalidateMediaManifestIfNeeded,
  maybeFireEvalSnapshot,
  maybeShowFeedbackBanner,
  scheduleUsageRefresh,
  trackCompletion,
  updateSiteTimestamp,
} from '@/hooks/shared/completionSideEffects'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

function commitHashFromComplete(data: WebSocketMessage): string | undefined {
  const raw = data.data?.commitHash
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

export class CompleteHandler implements MessageHandler {
  readonly type = 'complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    context.actions.flushToolDeltaBufferImmediate()

    const commitHash = commitHashFromComplete(data)
    const appId = context.currentAppId

    incrementSessionPromptCount(appId)
    maybeShowFeedbackBanner()

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
    })

    trackCompletion(!!data.data?.usage)


    if (appId) {
      invalidateMediaManifestIfNeeded(appId)

      if (commitHash) {
        await context.helpers.handleCommitComplete(commitHash)
      } else {
        await checkNewPageCreation()
      }

      updateSiteTimestamp(appId)
    }

    maybeFireEvalSnapshot(commitHash, appId)
    scheduleUsageRefresh()
  }
}
