/**
 * Complete Handler
 *
 * Handles stream completion messages.
 * Finalizes the stream, clears state, and triggers post-completion actions.
 */
import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { appFetch } from '@/lib/gasket-config'
import { JourneyTracker } from '@/lib/journeyTracker'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

// Session storage keys for tracking prompts and feedback
const SESSION_PROMPT_COUNT_KEY = 'airo_session_prompt_count'
const SESSION_FEEDBACK_SHOWN_KEY = 'airo_session_feedback_shown'
const SESSION_FEEDBACK_TRIGGER_THRESHOLD = 10 // Number of user prompts before showing feedback
/** Per-app build completion count (eval snapshot: trigger only when count === 1) */
const EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX = 'airo_eval_snapshot_app_build_count_'

/**
 * Check if we should show the feedback widget
 */
function shouldShowFeedbackBanner(): boolean {
  // Check if already shown in this session
  const hasShown = sessionStorage.getItem(SESSION_FEEDBACK_SHOWN_KEY)
  if (hasShown === 'true') {
    return false
  }

  // Get current prompt count
  const countStr = sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY)
  const count = countStr ? parseInt(countStr, 10) : 0

  return count >= SESSION_FEEDBACK_TRIGGER_THRESHOLD
}

/**
 * Increment session prompt counter (global, for feedback widget).
 * Only increments if site is published.
 */
function incrementSessionPromptCount(appId: string | null): void {
  // Only increment if site is published to avoid triggering feedback banner for draft sites
  const site = appId ? useSitesStore.getState().getSite(appId) : null
  const isPublished = site?.published_url && site.published_url.length > 0

  if (!isPublished) {
    return
  }

  const countStr = sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY)
  const count = countStr ? parseInt(countStr, 10) : 0
  sessionStorage.setItem(SESSION_PROMPT_COUNT_KEY, String(count + 1))
}

/**
 * Non-empty commit hash from complete payload (server squash-merge to main).
 */
function commitHashFromComplete(data: WebSocketMessage): string | undefined {
  const raw = data.data?.commitHash
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Increment per-app build count when this completion included a git commit.
 * Eval snapshot fires only when count === 1 (first committed build this session). Returns 0 if no appId.
 */
function incrementEvalSnapshotBuildCount(appId: string | null): number {
  if (!appId) return 0
  const key = `${EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX}${appId}`
  const countStr = sessionStorage.getItem(key)
  const count = countStr ? parseInt(countStr, 10) : 0
  const newCount = count + 1
  sessionStorage.setItem(key, String(newCount))
  return newCount
}

/**
 * Mark feedback as shown for this session
 */
function markFeedbackShown(): void {
  sessionStorage.setItem(SESSION_FEEDBACK_SHOWN_KEY, 'true')
}

/**
 * Show feedback banner by setting store state
 */
function showFeedbackBanner(promptCount: number): void {
  const { setShowFeedbackBanner } = useDevelopPageStore.getState()

  // Set the banner visibility in the store
  setShowFeedbackBanner(true)
  markFeedbackShown()

  // Log feedback banner shown
  logger.info('feedback.banner.shown', {
    promptCount,
  })
}

function isMediaRelatedTool(toolName: string): boolean {
  return toolName === 'media'
    || toolName.startsWith('media__')
    || toolName.startsWith('media-logo__')
}

export class CompleteHandler implements MessageHandler {
  readonly type = 'complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Flush any buffered tool input deltas
    context.actions.flushToolDeltaBufferImmediate()

    const commitHash = commitHashFromComplete(data)
    const appId = context.currentAppId
    incrementSessionPromptCount(appId)

    const shouldShowBanner = shouldShowFeedbackBanner()
    if (shouldShowBanner) {
      // Get current prompt count for logging
      const countStr = sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY)
      const promptCount = countStr ? parseInt(countStr, 10) : 0

      showFeedbackBanner(promptCount)
    }

    // Send STREAM_COMPLETE event to machine
    context.machine.send({ type: 'STREAM_COMPLETE' })

    // Clear store-based retry state on successful completion
    const completeStore = useStreamingConversationStore.getState()
    if (completeStore.connectionRetry.isRetrying) {
      completeStore.clearConnectionRetry()
    }

    // Clear APP_NOT_FOUND retry state
    context.helpers.clearRetryState()

    // Finalize the stream with metadata
    context.actions.finalizeStream({
      agentId: data.data?.agentId as string | undefined,
      usage: data.data?.usage,
      totalSteps: data.data?.step as number | undefined,
      finishReason: data.data?.finishReason as string | undefined,
      usedFreeGrants: data.data?.usedFreeGrants as boolean | undefined,
    })

    JourneyTracker.current()?.completeActivePrompt({ success: true })

    if (data.data?.usage) {
      logImpressionEvent('credits.usage.consumed')()
    }

    // Send analytics
    context.helpers.sendToolImpression('complete')

    // Machine handles UI state transitions via STREAM_COMPLETE event
    // Adapter syncs: setWebSocketState, setStreamingState, setIsLoading, finalizeStream

    // Read finalized messages once — all post-finalize checks use this snapshot.
    const { messages: finalizedMessages } = useStreamingConversationStore.getState()
    const lastMsg = finalizedMessages[finalizedMessages.length - 1]

    // Invalidate media manifest cache so the Media tab picks up newly created slots.
    // Check the finalized message for media-related tool calls to avoid unnecessary refetches.
    const hadMediaTools = lastMsg?.role === 'assistant' &&
      lastMsg.toolCalls?.some((tc) => isMediaRelatedTool(tc.name))

    if (hadMediaTools && appId) {
      const mediaClient = getQueryClient()
      if (!mediaClient) {
        logger.warn('complete-handler.media-manifest.no-query-client', { appId })
      } else {
        void mediaClient.invalidateQueries({ queryKey: ['mediaManifest', appId] }).catch(
          function mediaManifestInvalidateFailed(error: unknown) {
            logger.warn('complete-handler.media-manifest.invalidate-failed', {
              appId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        )
      }
    }

    // Determine eval snapshot eligibility after finalizeStream so the current turn's
    // tool calls are available in messages[]. Skip counting when the agent stopped on
    // askQuestion — that means it wrote partial scaffold and is waiting for user input,
    // not that it completed the first real build.
    let shouldFireEvalSnapshotTrigger = false
    if (commitHash) {
      const stoppedOnAskQuestion = lastMsg?.role === 'assistant' &&
        lastMsg.toolCalls?.some((tc) => tc.name === 'askQuestion')
      if (!stoppedOnAskQuestion) {
        const buildCount = incrementEvalSnapshotBuildCount(appId)
        if (buildCount === 1) {
          shouldFireEvalSnapshotTrigger = true
        }
      }
    }

    if (commitHash) {
      // Handle commit selection and preview refresh.
      // handleCommitComplete posts MESSAGE_COMPLETE, which triggers page.tsx
      // to detect new-page creation and navigate the preview.
      await context.helpers.handleCommitComplete(commitHash)
    } else {
      // No commit hash — check if the agent created a new page.
      // Vite HMR handles the file-change refresh but won't navigate to the
      // new route, so we fire MESSAGE_COMPLETE ourselves when a page was created.
      if (lastMsg?.role === 'assistant' && lastMsg.toolCalls?.length) {
        const { extractNewPageRoute } = await import('@/app/[market]/develop/components/utils')
        if (extractNewPageRoute(lastMsg.toolCalls)) {
          window.postMessage(
            { type: 'MESSAGE_COMPLETE', source: 'websocket' },
            window.location.origin
          )
        }
      }
    }

    if (shouldFireEvalSnapshotTrigger) {
      window.dispatchEvent(new CustomEvent('eval-snapshot-trigger'))
    }

    // Update site's updated_at timestamp so it moves to top of apps list
    // Call the backend API to persist a lastInteractionAt variable, then update frontend stores
    if (appId) {
      appFetch(`/api/sites/${appId}/variables`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastInteractionAt: new Date().toISOString() })
      })
        .then(async (response) => {
          if (response.ok) {
            const updatedSite = await response.json()
            useSiteStore.getState().updateSite(appId, updatedSite)
            useSitesStore.getState().updateSite(appId, updatedSite)
          }
        })
        .catch((error) => {
          logger.warn('complete-handler.update-timestamp.failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
    }

    // Refresh credit grants after message completes with staggered delays.
    // mgmt-airo spend data may take time to propagate after chat completion,
    // so we invalidate twice to catch late-arriving updates. Invalidating the
    // query directly (instead of dispatching a window event for the hook to
    // listen to) avoids registering one listener per useCreditGrants caller.
    for (const delay of [5_000, 30_000]) {
      setTimeout(function refreshCreditGrants() {
        const client = getQueryClient()
        if (!client) {
          logger.warn('complete-handler.credit-grants.no-query-client', { delay })
          return
        }
        void client.invalidateQueries({ queryKey: ['credit-grants'] }).catch(
          function creditGrantsInvalidateFailed(error: unknown) {
            logger.warn('complete-handler.credit-grants.invalidate-failed', {
              delay,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        )
      }, delay)
    }

    // Note: We intentionally do NOT clear the stored socket ID here anymore.
    // Preserving it allows for recovery if the user reloads the page shortly after completion.
    // The server handles stale recovery attempts gracefully with "Recovery attempted but no buffered events found".
    // We only clear the conversationId cookie if it's no longer valid.
  }
}
