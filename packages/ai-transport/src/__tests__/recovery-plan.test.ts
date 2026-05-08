import { describe, it, expect } from 'vitest'
import { computeRecoveryPlan } from '../recovery-plan.js'
import type { StreamingEvent } from '../interfaces.js'
import type { ConversationEventChannel } from '../conversation-event-channel.js'

function mockChannel(events: StreamingEvent[], metadata?: {
  firstSequence: number
  lastSequence: number
  pendingMessageIds: string[]
}): ConversationEventChannel {
  return {
    getEventsSince: (_cid: string, afterSeq: number) =>
      events.filter(e => e.sequence > afterSeq),
    getMetadata: (_cid: string) => metadata
      ? {
        conversationId: 'c',
        firstSequence: metadata.firstSequence,
        lastSequence: metadata.lastSequence,
        totalEvents: events.length,
        oldestTimestamp: new Date(),
        newestTimestamp: new Date(),
        pendingMessageIds: metadata.pendingMessageIds,
      }
      : null,
  } as unknown as ConversationEventChannel
}

function event(seq: number, type = 'chunk', messageId = 'm1', persisted = false): StreamingEvent {
  return {
    id: `e${seq}`,
    sequence: seq,
    type,
    content: '',
    conversationId: 'c',
    data: { messageId },
    timestamp: new Date(),
    agentName: 'a',
    persisted,
  } as unknown as StreamingEvent
}

describe('computeRecoveryPlan', () => {
  it('replays the full buffer when clientHasNoState=true, regardless of cursor', () => {
    const channel = mockChannel(
      [event(100), event(101), event(102)],
      { firstSequence: 100, lastSequence: 102, pendingMessageIds: ['m1'] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 101, // ignored for fresh clients
      clientHasNoState: true,
      hasActiveStream: true,
    })

    expect(plan.replayFromSequence).toBe(-1)
    expect(plan.eventsToReplay.length).toBeGreaterThan(0)
    expect(plan.streamCompleted).toBe(false)
  })

  it('replays only the tail when clientHasNoState=false', () => {
    const channel = mockChannel(
      [event(100), event(101), event(102)],
      { firstSequence: 100, lastSequence: 102, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 101,
      clientHasNoState: false,
      hasActiveStream: false,
    })

    expect(plan.replayFromSequence).toBe(101)
    expect(plan.eventsToReplay.some(e => e.sequence === 102)).toBe(true)
    expect(plan.eventsToReplay.some(e => e.sequence <= 101)).toBe(false)
    expect(plan.streamCompleted).toBe(true)
  })

  it('streamCompleted tracks hasActiveStream, not pending messages', () => {
    // Regression: mid-turn gap where pendingMessageIds is empty but a
    // producer is still running. The old signal would report completed;
    // the new signal must keep it alive.
    const channel = mockChannel(
      [],
      { firstSequence: 0, lastSequence: 1390, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 1390,
      clientHasNoState: false,
      hasActiveStream: true,
    })

    expect(plan.streamCompleted).toBe(false)
    expect(plan.eventsToReplay.length).toBe(0)
  })

  it('streamCompleted=true when no producer is attached, even if pending messages linger', () => {
    const channel = mockChannel(
      [],
      { firstSequence: 0, lastSequence: 1390, pendingMessageIds: ['stale'] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 1390,
      clientHasNoState: false,
      hasActiveStream: false,
    })

    expect(plan.streamCompleted).toBe(true)
  })

  it('filters persisted events that carry a messageId', () => {
    const persisted = event(100, 'chunk', 'm1', true)
    const live = event(101, 'chunk', 'm1', false)
    const channel = mockChannel(
      [persisted, live],
      { firstSequence: 100, lastSequence: 101, pendingMessageIds: ['m1'] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: true,
    })

    const seqs = plan.eventsToReplay.map(e => e.sequence)
    expect(seqs).toContain(101)
    expect(seqs).not.toContain(100)
  })

  it('keeps messageId-less control events regardless of persisted flag', () => {
    const control: StreamingEvent = {
      id: 'ctrl',
      sequence: 5,
      type: 'status',
      content: '',
      conversationId: 'c',
      data: {},
      timestamp: new Date(),
      agentName: 'a',
      persisted: true,
    } as unknown as StreamingEvent
    const channel = mockChannel(
      [control],
      { firstSequence: 5, lastSequence: 5, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: false,
    })

    expect(plan.eventsToReplay.map(e => e.id)).toContain('ctrl')
  })

  it('detects buffer loss when cursor lags buffer head for delta clients', () => {
    const channel = mockChannel(
      [event(50), event(51)],
      { firstSequence: 50, lastSequence: 51, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 10, // expected 11, buffer starts at 50 → 39 lost
      clientHasNoState: false,
      hasActiveStream: false,
    })

    expect(plan.lossDetected).toBe(true)
    expect(plan.lostEventCount).toBe(39)
  })

  it('coalesces consecutive same-message chunks before replay', () => {
    // Regression guard: if coalesceEvents is ever accidentally removed from
    // the plan, consecutive chunks for the same message would be replayed
    // individually — stuttering the client UI.
    const e1 = event(100, 'chunk', 'm1')
    const e2 = event(101, 'chunk', 'm1')
    const e3 = event(102, 'chunk', 'm1')
    const channel = mockChannel(
      [e1, e2, e3],
      { firstSequence: 100, lastSequence: 102, pendingMessageIds: ['m1'] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: true,
    })

    expect(plan.eventsToReplay.length).toBe(1)
  })

  it('does not flag loss for fresh clients (history snapshot covers gaps)', () => {
    const channel = mockChannel(
      [event(50)],
      { firstSequence: 50, lastSequence: 50, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: false,
    })

    expect(plan.lossDetected).toBe(false)
    expect(plan.lostEventCount).toBe(0)
  })
})
