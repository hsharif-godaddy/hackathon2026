import type { StreamMessageEvents } from '@airo-care/client'
import type { StreamingEvent } from '@airo/ai-transport'
import { CARE_REPORTED_ERROR } from './errors.js'

export type BridgeEvent = Omit<
  StreamingEvent,
  'id' | 'sequence' | 'timestamp' | 'deliveredTo' | 'persisted'
>

export interface TranslateCtx {
  agentName: string
  conversationId: string
}

/**
 * Translate one Care stream event into an AAB BridgeEvent suitable for
 * direct passthrough to ConversationEventChannel.publish, or null when
 * the event has no AAB-visible analog (start/progress/heartbeat/data/
 * artifact for this iteration).
 *
 * `error` is translated to a user-facing chunk using a controlled string
 * (never Care's raw event.message, which may contain internal diagnostics).
 * The bridge logs care.stream.error_event with the raw message/code/fatal for
 * operator visibility. The bridge does NOT automatically follow an in-stream
 * error with a terminal complete — the for-await loop in CareBridge drains
 * until the queue closes (or throws) and the post-loop synthetic-complete
 * guard emits the terminal if needed.
 */
export function translateCareEvent(
  event: StreamMessageEvents,
  ctx: TranslateCtx,
): BridgeEvent | null {
  switch (event.type) {
    case 'delta':
      return {
        type: 'chunk',
        content: event.textDelta,
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'result':
      return terminalCompleteEvent(ctx)
    case 'error':
      return {
        type: 'chunk',
        content: CARE_REPORTED_ERROR,
        data: {},
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      }
    case 'start':
    case 'progress':
    case 'heartbeat':
    case 'data':
    case 'artifact':
      return null
  }
}

export function terminalCompleteEvent(
  ctx: TranslateCtx,
  finishReason: 'stop' | 'error' = 'stop',
): BridgeEvent {
  return {
    type: 'complete',
    content: '',
    data: { finishReason },
    agentName: ctx.agentName,
    conversationId: ctx.conversationId,
  }
}
