/**
 * Shared Completion Side Effects
 *
 * Extracted from WS CompleteHandler so both WebSocket and SSE
 * transports can trigger commit handling, preview refresh,
 * timestamp updates, and usage refresh on stream completion.
 */

import { getQueryClient } from '@/components/providers/QueryClientProvider'
import { sendToolImpressionEvent } from '@/hooks/chat/useChatHelpers'
import { trackBuildComplete } from '@/hooks/shared/initialBuildFunnel'
import { appFetch } from '@/lib/gasket-config'
import { JourneyTracker } from '@/lib/journeyTracker'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import { safeGetItem, safeSetItem } from '@/utils/localStorage'

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
  // A new agent commit invalidates any in-flight redo path and re-anchors
  // the chat-turn cursor to the just-landed turn.
  useGitStore.getState().clearRedoStack(appId)
  useGitStore.getState().setUndoCursor(appId, commitHash)

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

  // Only check the last assistant message (current turn) to avoid session-long invalidation
  const lastAssistantMsg = messages.findLast((msg) => msg.role === 'assistant')
  const hadMediaTools = lastAssistantMsg?.toolCalls?.some((tc) =>
    tc.name === 'media' ||
    tc.name.startsWith('media__') ||
    tc.name.startsWith('media-image__') ||
    tc.name.startsWith('media-video__') ||
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

// --- Initial build event ---

const INITIAL_BUILD_EVENT_SENT_KEY = 'airo_initial_build_event_sent_';

export function postInitialBuildEvent(appId: string): void {
  const storageKey = `${INITIAL_BUILD_EVENT_SENT_KEY}${appId}`;

  if (typeof window === 'undefined') {
    return;
  }

  if (safeGetItem(storageKey) === 'true') {
    return;
  }

  // First build just completed — make initialBuildComplete reactive so the
  // feedback hook re-evaluates without waiting for a page reload.
  useDevelopPageStore.setState((state) => ({
    ...state,
    app: state.app ? { ...state.app, initialBuildComplete: true } : state.app,
  }));

  appFetch(`/api/apps/${appId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: 'build.initial_build_completed',
      occurredAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
    }),
  }).then((response: Response) => {
    if (response.ok) {
      safeSetItem(storageKey, 'true');
    } else {
      logger.warn('completionSideEffects.initial-build-event.http-error', {
        appId,
        status: response.status,
      });
    }
  }).catch((error: unknown) => {
    logger.warn('completionSideEffects.initial-build-event.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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

export function trackInitialBuildComplete(commitHash: string | undefined): void {
  if (commitHash) {
    trackBuildComplete(commitHash)
  }
}

export function trackError(errorType?: string): void {
  JourneyTracker.current()?.completeActivePrompt({ success: false, errorType: errorType ?? 'unknown' })
  sendToolImpressionEvent('error')
}

export function trackStepStart(): void {
  sendToolImpressionEvent('start')
}

/**
 * Fire the per-tool-call impression on tool_result. All variants live under
 * the `develop.tool.*` namespace so "all tool calls" stays a single query.
 *
 * Both skill cases are kept backward-compatible (additive) with the
 * pre-existing `develop.tool.*` emissions:
 *  - The wrapper `skill` tool keeps firing `develop.tool.skill.impression` for
 *    every action (preserving the existing count); we only add `action` and
 *    `skillName` properties.
 *  - Per-skill MCP tools gain a bounded, collapsed `develop.tool.skill_tool`
 *    impression but ALSO keep emitting the legacy per-name impression during a
 *    migration window so existing `develop.tool.{skill}__{tool}.impression`
 *    dashboards keep working.
 */
export function trackToolResult(tool: {
  name: string
  input?: { action?: string; skill?: string }
  skillName?: string
}): void {
  // Wrapper `skill` tool: fires for every action (list/load/install) exactly as
  // before — same EID, same cadence — now enriched with action + skillName so
  // the data is filterable. `tool_result` carries the parsed input.
  if (tool.name === 'skill') {
    const props: Record<string, string> = {}
    if (typeof tool.input?.action === 'string') props.action = tool.input.action
    if (typeof tool.input?.skill === 'string') props.skillName = tool.input.skill
    logImpressionEvent('develop.tool.skill', props)()
    return
  }
  // Per-skill MCP tool: emit the bounded collapsed event (skillName attached
  // server-side; recover the un-prefixed tool name by stripping `{skill}__`)…
  if (tool.skillName) {
    const prefix = `${tool.skillName}__`
    const toolName = tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name
    logImpressionEvent('develop.tool.skill_tool', { skillName: tool.skillName, toolName })()
    // …and keep the legacy per-name impression so existing dashboards keep
    // working. Migration shim — remove once consumers move to skill_tool.
    sendToolImpressionEvent(tool.name)
    return
  }
  // Normal tool: unchanged per-name impression.
  sendToolImpressionEvent(tool.name)
}
