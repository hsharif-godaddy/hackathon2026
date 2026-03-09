/**
 * Complete Handler
 *
 * Handles stream completion messages.
 * Finalizes the stream, clears state, and triggers post-completion actions.
 */

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { LifecycleHandlerContext, MessageHandler, WebSocketMessage } from './types'

// Session storage keys for tracking prompts and feedback
const SESSION_PROMPT_COUNT_KEY = 'airo_session_prompt_count'
const SESSION_FEEDBACK_SHOWN_KEY = 'airo_session_feedback_shown'
const SESSION_FEEDBACK_TRIGGER_THRESHOLD = 10 // Number of user prompts before showing feedback

/**
 * Check if session feedback feature is enabled
 */
function isSessionFeedbackEnabled(): boolean {
  // For client-side code, Next.js requires NEXT_PUBLIC_ prefix
  // In production, this should be controlled by Switchboard via a server-side check
  return process.env.NEXT_PUBLIC_ENABLE_SESSION_FEEDBACK === 'true'
}

/**
 * Check if we should show the feedback widget
 */
function shouldShowFeedbackWidget(): boolean {
  if (!isSessionFeedbackEnabled()) {
    return false
  }

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
 * Increment session prompt counter
 */
function incrementPromptCount(): void {
  const countStr = sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY)
  const count = countStr ? parseInt(countStr, 10) : 0
  sessionStorage.setItem(SESSION_PROMPT_COUNT_KEY, String(count + 1))
}

/**
 * Mark feedback as shown for this session
 */
function markFeedbackShown(): void {
  sessionStorage.setItem(SESSION_FEEDBACK_SHOWN_KEY, 'true')
}

/**
 * Inject feedback widget into the active stream
 */
function injectFeedbackWidget(appId: string, conversationId: string | undefined, promptCount: number): void {
  const store = useStreamingConversationStore.getState()

  // Create a synthetic widgetRender tool call result for the feedback widget
  const feedbackToolCall = {
    id: `feedback_${Date.now()}`,
    name: 'widgetRender',
    input: {},
    result: {
      success: true,
      widgetType: 'feedback',
      widgetData: {
        type: 'feedback',
        conversationId,
        appId
      }
    },
    status: 'completed' as const
  }

  // Add the feedback widget as both a tool call AND a tool result segment
  // The UI renders from segments, so we need both
  store.addToolToStream(feedbackToolCall)
  store.addToolResultSegment(feedbackToolCall)

  markFeedbackShown()

  // Log feedback widget shown
  logger.info('feedback.widget.shown', {
    appId,
    conversationId,
    promptCount,
  })

  // Trigger scroll event for the chat to show newly injected widget
  // Use setTimeout to ensure the widget is rendered before scrolling
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('widget-injected'))
  }, 500)
}

export class CompleteHandler implements MessageHandler {
  readonly type = 'complete'

  async handle(data: WebSocketMessage, context: LifecycleHandlerContext): Promise<void> {
    // Flush any buffered tool input deltas
    context.actions.flushToolDeltaBufferImmediate()

    // Increment session prompt count and check if we should show feedback widget BEFORE finalizing
    incrementPromptCount()

    const shouldShowWidget = shouldShowFeedbackWidget()
    if (shouldShowWidget) {
      // Try to get conversationId from the message data, fallback to cookie
      const conversationId = (data.data?.conversationId as string | undefined) || undefined
      const appId = context.currentAppId

      // Get current prompt count for logging
      const countStr = sessionStorage.getItem(SESSION_PROMPT_COUNT_KEY)
      const promptCount = countStr ? parseInt(countStr, 10) : 0

      injectFeedbackWidget(appId, conversationId, promptCount)
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
    })

    // Send analytics
    context.helpers.sendToolImpression('complete')

    // Machine handles UI state transitions via STREAM_COMPLETE event
    // Adapter syncs: setWebSocketState, setStreamingState, setIsLoading, finalizeStream

    const commitHash = data.data?.commitHash as string | undefined

    if (commitHash) {
      // Handle commit selection and preview refresh.
      // handleCommitComplete posts MESSAGE_COMPLETE, which triggers page.tsx
      // to detect new-page creation and navigate the preview.
      await context.helpers.handleCommitComplete(commitHash)
    } else {
      // No commit hash — check if the agent created a new page.
      // Vite HMR handles the file-change refresh but won't navigate to the
      // new route, so we fire MESSAGE_COMPLETE ourselves when a page was created.
      const { messages: finalizedMessages } = useStreamingConversationStore.getState()
      const lastMsg = finalizedMessages[finalizedMessages.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.toolCalls?.length) {
        const { extractNewPageRoute } = await import('@/app/develop/components/utils')
        if (extractNewPageRoute(lastMsg.toolCalls)) {
          window.postMessage(
            { type: 'MESSAGE_COMPLETE', source: 'websocket' },
            window.location.origin
          )
        }
      }
    }

    // Update site's updated_at timestamp so it moves to top of apps list
    // Call the backend API to persist a lastInteractionAt variable, then update frontend stores
    const appId = context.currentAppId
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

    // Trigger usage refresh after message completes with delays
    // mgmt-airo spend data may take time to propagate after chat completion
    for (const delay of [5_000, 30_000]) {
      setTimeout(function dispatchRefresh() {
        window.dispatchEvent(new CustomEvent('usage-refresh'))
      }, delay)
    }

    // Note: We intentionally do NOT clear the stored socket ID here anymore.
    // Preserving it allows for recovery if the user reloads the page shortly after completion.
    // The server handles stale recovery attempts gracefully with "Recovery attempted but no buffered events found".
    // We only clear the conversationId cookie if it's no longer valid.
  }
}
