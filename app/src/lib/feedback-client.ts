/**
 * Shared client for the agents `POST /feedback` route.
 *
 * One helper backs every feedback surface in the app so callers don't
 * reimplement the cookie lookup, agent-base-url resolution, or POST body
 * shape. The server emits an `urn:shared:ai:event:/agent/user-feedback/v1`
 * event via the events team's shared schema.
 *
 * Backend route: `agents/src/server/routes/feedback.ts`
 */

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { getConversationIdFromCookie } from '@/hooks/chat/useChatHelpers'
import { agentFetch } from '@/lib/agent-fetch'

/** Scope of what's being rated. Matches the events-team schema enum. */
export type FeedbackTargetLevel = 'conversation' | 'invocation' | 'artifact' | 'general'

/** Thumbs up / thumbs down — matches the events-team schema enum. */
export type FeedbackValue = 'positive' | 'negative'

export interface SubmitFeedbackInput {
  /** Thumbs up/down signal. Passed straight through to the schema. */
  feedback: FeedbackValue
  /** What's being rated — 'artifact' for app-generation, 'invocation' for
   * per-turn, etc. Each surface picks. */
  targetLevel: FeedbackTargetLevel
  /** Stable identifier for the rated target. For app-generation this is the
   * appId; for invocation-level feedback it's the rated invocation's id; for
   * conversation-level feedback it's the conversationId (same value as on the POST). */
  targetId: string
  /** OTel trace ID of the turn being rated. 32-char hex. Optional — only
   * present when the backend emitted it on the complete WS event. */
  traceId?: string
  /** OTel span ID of the turn being rated. 16-char hex. Optional for the
   * same reason as traceId. */
  observationId?: string
  appId: string
  /** When the client triggered feedback (ISO-8601 UTC). Server defaults if omitted. */
  eventCreationTimestamp?: string
  /** Optional numeric rating (e.g. 1–5). */
  rating?: number
  /** Optional category (e.g. UI dropdown). */
  feedbackCategory?: string
  /** Optional free-form user feedback. */
  feedbackText?: string
  /** Whether detailed feedback (text/category) is included. Server defaults false. */
  hasDetailedFeedback?: boolean
}

export interface SubmitFeedbackResult {
  /** True when the agents route accepted the POST (2xx). */
  ok: boolean
  /** Populated when the call did not succeed. */
  reason?:
    | 'missing_conversation_id'
    | 'network_error'
    | 'http_error'
    | 'no_app_id'
    | 'in_flight'
}

/**
 * Submit a feedback signal to agents. Resolves the agents base URL, reads
 * the per-app conversationId cookie, and POSTs the body that the backend
 * route expects.
 *
 * Fail-closed on missing conversationId — the WS connect flow always writes
 * this cookie before any turn completes, so a missing value means something
 * upstream broke; callers should treat it as a non-recoverable dismiss.
 */
export interface InvocationFeedbackTraceIds {
  traceId?: string;
  observationId?: string;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const conversationId = getConversationIdFromCookie(input.appId)
  if (!conversationId) return { ok: false, reason: 'missing_conversation_id' }

  try {
    const config = await dynamicApiConfigService.getConfigForSite(input.appId)
    const response = await agentFetch(`${config.baseUrl}/feedback`, {
      method: 'POST',
      siteId: input.appId,
      body: JSON.stringify({
        feedback: input.feedback,
        targetLevel: input.targetLevel,
        targetId: input.targetId,
        appId: input.appId,
        conversationId,
        ...(input.traceId !== undefined && { traceId: input.traceId }),
        ...(input.observationId !== undefined && { observationId: input.observationId }),
        ...(input.eventCreationTimestamp !== undefined && {
          eventCreationTimestamp: input.eventCreationTimestamp,
        }),
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.feedbackCategory !== undefined && { feedbackCategory: input.feedbackCategory }),
        ...(input.feedbackText !== undefined && { feedbackText: input.feedbackText }),
        ...(input.hasDetailedFeedback !== undefined && {
          hasDetailedFeedback: input.hasDetailedFeedback,
        }),
      }),
    })
    if (!response.ok) {
      return { ok: false, reason: 'http_error' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'network_error' }
  }
}
