/**
 * Shared Completion Side Effects
 *
 * Extracted from WS CompleteHandler so both WebSocket and SSE
 * transports can trigger commit handling, preview refresh,
 * timestamp updates, and usage refresh on stream completion.
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { sendToolImpressionEvent } from '@/hooks/websocket/useWebSocketHelpers'
import { appFetch } from '@/lib/gasket-config'
import { JourneyTracker } from '@/lib/journeyTracker'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { logImpressionEvent } from '@/utils/instrumentation'

/**
 * Handle commit completion: invalidate git history, update selected commit,
 * trigger preview refresh, check for new-page creation.
 */
export async function handleCommitComplete(commitHash: string, appId: string): Promise<void> {
  const queryClient = getQueryClient()
  if (!queryClient) return

  await queryClient.invalidateQueries({
    queryKey: ['git-history', appId],
    refetchType: 'active',
  })

  await queryClient.invalidateQueries({
    queryKey: ['secretsDiff', appId],
    refetchType: 'active',
  })

  useGitStore.getState().setSelectedCommitHash(appId, commitHash)

  const { streamingState, activeStream } = useStreamingConversationStore.getState()
  const isAgentRunning = streamingState === 'streaming' && !!activeStream

  if (!isAgentRunning) {
    window.postMessage(
      { type: 'MESSAGE_COMPLETE', source: 'agent' },
      window.location.origin,
    )
  }
}

/**
 * Check finalized messages for new page creation when no commit hash.
 */
export async function checkNewPageCreation(): Promise<void> {
  const { messages } = useStreamingConversationStore.getState()
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'assistant' && lastMsg.toolCalls?.length) {
    const { extractNewPageRoute } = await import('@/app/[market]/develop/components/utils')
    if (extractNewPageRoute(lastMsg.toolCalls)) {
      window.postMessage(
        { type: 'MESSAGE_COMPLETE', source: 'agent' },
        window.location.origin,
      )
    }
  }
}

/**
 * Invalidate media manifest cache if the last message used media tools.
 */
export function invalidateMediaManifestIfNeeded(appId: string): void {
  const { messages } = useStreamingConversationStore.getState()
  const lastMsg = messages[messages.length - 1]

  const hadMediaTools = lastMsg?.role === 'assistant' &&
    lastMsg.toolCalls?.some((tc) =>
      tc.name === 'media' ||
      tc.name.startsWith('media__') ||
      tc.name.startsWith('media-logo__')
    )

  if (hadMediaTools) {
    const client = getQueryClient()
    if (!client) {
      logger.warn('completionSideEffects.media-manifest.no-query-client', { appId })
      return
    }
    void client.invalidateQueries({ queryKey: ['mediaManifest', appId] }).catch(
      function mediaManifestInvalidateFailed(error: unknown) {
        logger.warn('completionSideEffects.media-manifest.invalidate-failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    )
  }
}

/**
 * Update site's updated_at timestamp.
 */
export function updateSiteTimestamp(appId: string): void {
  appFetch(`/api/sites/${appId}/variables`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastInteractionAt: new Date().toISOString() }),
  })
    .then(async (response) => {
      if (response.ok) {
        const updatedSite = await response.json()
        useSiteStore.getState().updateSite(appId, updatedSite)
        useSitesStore.getState().updateSite(appId, updatedSite)
      } else {
        logger.warn('completionSideEffects.update-timestamp.http_error', {
          appId, status: response.status,
        })
      }
    })
    .catch((error) => {
      logger.warn('completionSideEffects.update-timestamp.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

/**
 * Schedule usage refresh events after completion.
 */
export function scheduleUsageRefresh(): void {
  for (const delay of [5_000, 30_000]) {
    setTimeout(function refreshCreditGrants() {
      const client = getQueryClient()
      if (!client) {
        logger.warn('completionSideEffects.credit-grants.no-query-client', { delay })
        return
      }
      void client.invalidateQueries({ queryKey: ['credit-grants'] }).catch(
        function creditGrantsInvalidateFailed(error: unknown) {
          logger.warn('completionSideEffects.credit-grants.invalidate-failed', {
            delay,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      )
    }, delay)
  }
}

// --- Analytics & tracking side effects ---

const SESSION_PROMPT_COUNT_KEY = 'airo_session_prompt_count'
const SESSION_FEEDBACK_SHOWN_KEY = 'airo_session_feedback_shown'
const SESSION_FEEDBACK_TRIGGER_THRESHOLD = 10
const EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX = 'airo_eval_snapshot_app_build_count_'

export function incrementSessionPromptCount(appId: string | null): void {
  const site = appId ? useSitesStore.getState().getSite(appId) : null
  const isPublished = site?.published_url && site.published_url.length > 0
  if (!isPublished) return

  const count = parseInt(sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY) ?? '0', 10)
  sessionStorage.setItem(SESSION_PROMPT_COUNT_KEY, String(count + 1))
}

export function maybeShowFeedbackBanner(): void {
  if (sessionStorage.getItem(SESSION_FEEDBACK_SHOWN_KEY) === 'true') return

  const count = parseInt(sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY) ?? '0', 10)
  if (count < SESSION_FEEDBACK_TRIGGER_THRESHOLD) return

  useDevelopPageStore.getState().setShowFeedbackBanner(true)
  sessionStorage.setItem(SESSION_FEEDBACK_SHOWN_KEY, 'true')
  logger.info('feedback.banner.shown', { promptCount: count })
}

// Returns true if this is the first committed build for this app this session.
export function incrementEvalSnapshotBuildCount(appId: string | null): boolean {
  if (!appId) return false
  const key = `${EVAL_SNAPSHOT_APP_BUILD_COUNT_PREFIX}${appId}`
  const count = parseInt(sessionStorage.getItem(key) ?? '0', 10) + 1
  sessionStorage.setItem(key, String(count))
  return count === 1
}

export function maybeFireEvalSnapshot(commitHash: string | undefined, appId: string | null): void {
  if (!commitHash) return

  const { messages } = useStreamingConversationStore.getState()
  const lastMsg = messages[messages.length - 1]
  const stoppedOnAskQuestion = lastMsg?.role === 'assistant' &&
    lastMsg.toolCalls?.some((tc) => tc.name === 'askQuestion')
  if (stoppedOnAskQuestion) return

  if (incrementEvalSnapshotBuildCount(appId)) {
    window.dispatchEvent(new CustomEvent('eval-snapshot-trigger'))
  }
}

export function trackCompletion(hasUsage: boolean): void {
  JourneyTracker.current()?.completeActivePrompt({ success: true })
  if (hasUsage) logImpressionEvent('credits.usage.consumed')()
  sendToolImpressionEvent('complete')
}

export function trackError(errorType?: string): void {
  JourneyTracker.current()?.completeActivePrompt({ success: false, errorType: errorType ?? 'unknown' })
  sendToolImpressionEvent('error')
}

export function trackStepStart(): void {
  sendToolImpressionEvent('start')
}

export function trackToolResult(toolName: string): void {
  sendToolImpressionEvent(toolName)
}
