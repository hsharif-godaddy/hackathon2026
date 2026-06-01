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

function actionEvent(seq: number, requestId: string): StreamingEvent {
  return {
    id: `ca-${requestId}`,
    sequence: seq,
    type: 'client_action',
    content: '',
    conversationId: 'c',
    data: { requestId },
    timestamp: new Date(),
    agentName: 'system',
    persisted: false,
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

  it('filters persisted completed-turn events while preserving unpersisted terminal tail', () => {
    const persistedChunk = event(100, 'chunk', 'm1', true)
    const persistedToolResult = event(101, 'tool_result', 'm1', true)
    const terminal = event(102, 'complete', 'm1', false)
    const channel = mockChannel(
      [persistedChunk, persistedToolResult, terminal],
      { firstSequence: 100, lastSequence: 102, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 99,
      clientHasNoState: false,
      hasActiveStream: false,
    })

    expect(plan.streamCompleted).toBe(true)
    expect(plan.eventsToReplay.map(e => e.sequence)).toEqual([102])
  })

  it('drops resolved client_action events on full replay', () => {
    const channel = mockChannel(
      [actionEvent(10, 'req-resolved'), actionEvent(11, 'req-pending')],
      { firstSequence: 10, lastSequence: 11, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: false,
      isClientActionPending: (rid) => rid === 'req-pending',
    })

    const ids = plan.eventsToReplay.map(e => e.id)
    expect(ids).toContain('ca-req-pending')
    expect(ids).not.toContain('ca-req-resolved')
  })

  it('drops resolved client_action events on delta replay too (clientHasNoState=false)', () => {
    // Same filter must apply on the delta path — a future refactor that
    // branches the filter under clientHasNoState would silently regress
    // reconnects, since reconnects without a fresh page load also flow here.
    const channel = mockChannel(
      [actionEvent(10, 'req-resolved'), actionEvent(11, 'req-pending')],
      { firstSequence: 10, lastSequence: 11, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: 9,
      clientHasNoState: false,
      hasActiveStream: true,
      isClientActionPending: (rid) => rid === 'req-pending',
    })

    const ids = plan.eventsToReplay.map(e => e.id)
    expect(ids).toContain('ca-req-pending')
    expect(ids).not.toContain('ca-req-resolved')
  })

  it('passes through client_action events that lack a string requestId (no oracle to consult)', () => {
    // Producers always emit string requestIds today, but if a malformed
    // event somehow lands in the buffer the filter must err on "keep" —
    // dropping a payload we can't identify is worse than replaying it.
    const malformed: StreamingEvent = {
      id: 'ca-malformed',
      sequence: 10,
      type: 'client_action',
      content: '',
      conversationId: 'c',
      data: { /* no requestId */ },
      timestamp: new Date(),
      agentName: 'system',
      persisted: false,
    } as unknown as StreamingEvent
    const channel = mockChannel(
      [malformed],
      { firstSequence: 10, lastSequence: 10, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: false,
      isClientActionPending: () => false, // would drop everything if consulted
    })

    expect(plan.eventsToReplay.map(e => e.id)).toEqual(['ca-malformed'])
  })

  it('keeps all client_action events when isClientActionPending is omitted (WS path)', () => {
    const channel = mockChannel(
      [actionEvent(10, 'r1'), actionEvent(11, 'r2')],
      { firstSequence: 10, lastSequence: 11, pendingMessageIds: [] }
    )

    const plan = computeRecoveryPlan({
      conversationId: 'c',
      channel,
      lastDeliveredSequence: null,
      clientHasNoState: true,
      hasActiveStream: false,
      // isClientActionPending intentionally omitted
    })

    expect(plan.eventsToReplay.map(e => e.id).sort()).toEqual(['ca-r1', 'ca-r2'])
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
