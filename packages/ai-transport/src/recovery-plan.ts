import type { ConversationEventChannel } from './conversation-event-channel.js'
import type { StreamingEvent } from './interfaces.js'
import { coalesceEvents } from './coalesce-events.js'

export interface RecoveryPlanInput {
  conversationId: string
  channel: ConversationEventChannel
  /**
   * The client's last known event sequence. -1 (or null) means "no cursor".
   * Ignored when clientHasNoState is true.
   */
  lastDeliveredSequence: number | null
  /**
   * True when the client has no in-memory state (manual/initial recovery,
   * fresh page load). Forces a full-buffer replay so the client can
   * reconstruct the in-progress turn from the history snapshot (for
   * persisted content) plus non-persisted tail events (for the live
   * delta). Persisted events tied to a message are still filtered out —
   * the history snapshot already covers them.
   */
  clientHasNoState: boolean
  /**
   * Authoritative "is a producer still attached?" signal. Callers should
   * pass executionService.hasActiveStream(conversationId) on SSE, or
   * ConnectionStateManager.hasActiveStreamForConversation(...) on WS.
   * This is the only correct "is the turn done?" signal — buffer-level
   * heuristics that look at the pending-message set go transiently empty
   * between agent steps and misreport a still-running turn as completed.
   */
  hasActiveStream: boolean
}

export interface RecoveryPlan {
  /** The sequence we replayed from (-1 for full replay). */
  replayFromSequence: number
  /** Events to send on the wire (filtered + coalesced). */
  eventsToReplay: StreamingEvent[]
  /** Highest sequence in eventsToReplay; falls back to preReplaySequence. */
  lastReplaySequence: number
  /** True iff no producer is attached. Safe to tell the client the turn is done. */
  streamCompleted: boolean
  /**
   * True when the buffer has been truncated past what the client expected
   * AND this is not a fresh-state client (which loads history separately).
   */
  lossDetected: boolean
  lostEventCount: number
}

export function computeRecoveryPlan(input: RecoveryPlanInput): RecoveryPlan {
  const { conversationId, channel, clientHasNoState, hasActiveStream } = input
  const preReplaySequence = input.lastDeliveredSequence ?? -1
  const replayFromSequence = clientHasNoState ? -1 : preReplaySequence

  const filtered = channel
    .getEventsSince(conversationId, replayFromSequence)
    .filter(e => {
      // Events tied to a message are already in the history snapshot once
      // persisted — only their non-persisted tail needs to flow so the
      // client can keep rendering the active turn. Control events carry no
      // messageId and always pass since they aren't persisted as history.
      const messageId = e.data?.messageId as string | undefined
      return !messageId || !e.persisted
    })

  const eventsToReplay = coalesceEvents(filtered)

  const lastReplaySequence = eventsToReplay.length > 0
    ? eventsToReplay[eventsToReplay.length - 1]!.sequence
    : preReplaySequence

  let lossDetected = false
  let lostEventCount = 0
  if (!clientHasNoState) {
    // Loss detection only matters for delta clients; fresh clients rebuild
    // via the history snapshot, which covers any gap.
    const metadata = channel.getMetadata(conversationId)
    if (metadata) {
      const missing = metadata.firstSequence - (preReplaySequence + 1)
      if (missing > 0) {
        lossDetected = true
        lostEventCount = missing
      }
    }
  }

  return {
    replayFromSequence,
    eventsToReplay,
    lastReplaySequence,
    streamCompleted: !hasActiveStream,
    lossDetected,
    lostEventCount,
  }
}
