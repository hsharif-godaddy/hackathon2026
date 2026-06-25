import { describe, it, expect } from 'vitest'
import { AgentClientError } from '@airo-care/client'
import type { AiroCareClient } from '@airo-care/client'
import { createCareBridge } from '../CareBridge.js'
import type { BridgeEvent } from '../CareBridge.js'
import { makeFakeClient, makeScriptedFakeClient } from './fixtures/fake-airo-care-client.js'

async function drain(iter: AsyncIterable<BridgeEvent>): Promise<BridgeEvent[]> {
  const out: BridgeEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

describe('createCareBridge', () => {
  it('returns null when baseURL is empty', () => {
    const bridge = createCareBridge({ baseURL: '', executor: 'v1/test' })
    expect(bridge).toBeNull()
  })

  it('returns a bridge when baseURL is set', () => {
    const bridge = createCareBridge({ baseURL: 'https://care.example', executor: 'v1/test' })
    expect(bridge).not.toBeNull()
  })
})

describe('streamSupportTurn — happy path', () => {
  it('creates a Care conversation on first turn, streams delta chunks, ends with one complete', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'events',
        events: [
          { eventId: 1, timestamp: 1, type: 'start', conversationId: 'care-conv-1' },
          { eventId: 2, timestamp: 2, type: 'delta', textDelta: 'Hello ' },
          { eventId: 3, timestamp: 3, type: 'delta', textDelta: 'world' },
          { eventId: 4, timestamp: 4, type: 'result', output: 'Hello world' },
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi',
    }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect(events[0]).toMatchObject({ type: 'chunk', content: 'Hello ', agentName: 'support', conversationId: 'aab-1' })
    expect(events[1]).toMatchObject({ type: 'chunk', content: 'world' })
    expect(events[2]).toMatchObject({ type: 'complete', data: { finishReason: 'stop' } })
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.createCalls[0]?.ucid).toMatch(/^[0-9a-f-]+$/i)
    expect(fake.streamCalls).toHaveLength(1)
    expect(fake.streamCalls[0]?.conversationId).toBe('care-conv-1')
  })

  it('reuses the same careConversationId on a second turn (no second create)', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi 1' }))
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi 2' }))
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.streamCalls).toHaveLength(2)
    expect(fake.streamCalls.every(c => c.conversationId === 'care-conv-1')).toBe(true)
  })
})

describe('streamSupportTurn — failure paths', () => {
  it('createConversation failure yields error chunk + complete with finishReason=error, invalidates session', async () => {
    // Use a single bridge instance with a scripted fake: first create throws,
    // second create succeeds. Driving two turns on the SAME bridge proves that
    // invalidate() was called after the first failure.
    const fake = makeScriptedFakeClient({
      createScript: [
        { kind: 'throw', error: new AgentClientError('down', { fault: 'server', type: 'SERVICE_UNAVAILABLE', statusCode: 503 }) },
        { kind: 'success', conversationId: 'care-conv-2' },
      ],
      streamScript: [
        { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
      ],
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    // First turn: create fails → error chunk + complete.
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[0] as { content: string }).content.length).toBeGreaterThan(0)
    expect((events[1] as { data: unknown }).data).toEqual({ finishReason: 'error' })
    // Second turn on the SAME bridge: session was invalidated, so createConversation
    // must be called again (total creates = 2).
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'retry' }))
    expect(fake.createCalls).toHaveLength(2)
  })

  it('stream-mid throw yields error chunk + complete with finishReason=error, invalidates session', async () => {
    // Use a single bridge instance with a scripted fake: first stream throws
    // mid-way, second stream succeeds. Two turns on the SAME bridge prove
    // invalidate() was called after the mid-stream failure.
    const fake = makeScriptedFakeClient({
      createScript: [
        { kind: 'success', conversationId: 'care-conv-1' },
        { kind: 'success', conversationId: 'care-conv-2' },
      ],
      streamScript: [
        {
          kind: 'throwAfter',
          events: [{ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'partial' }],
          error: new Error('disconnected'),
        },
        { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
      ],
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    // First turn: stream throws after one delta → partial chunk, error chunk, complete.
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect((events[0] as { content: string }).content).toBe('partial')
    expect((events[2] as { data: unknown }).data).toEqual({ finishReason: 'error' })
    // Second turn on the SAME bridge: session was invalidated, so createConversation
    // must be called again (total creates = 2).
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'retry' }))
    expect(fake.createCalls).toHaveLength(2)
  })

  it('emits a synthetic terminal complete with finishReason=stop when the stream closes without a result event', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'events',
        events: [
          { eventId: 1, timestamp: 1, type: 'delta', textDelta: 'hi' },
          // no 'result'
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[1] as { data: unknown }).data).toEqual({ finishReason: 'stop' })
  })

  it.each([
    ['empty string', ''],
    ['non-UUID string', 'vis-1'],
    ['contains semicolon', '3fa85f64-5717-4562-b3fc-2c963f66afa6;evil=1'],
    ['contains comma', '3fa85f64-5717-4562-b3fc-2c963f66afa6,other'],
  ])('invalid visitorId (%s) yields visitor-missing error chunk + complete with finishReason=error without calling Care', async (_label, badVisitorId) => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: { kind: 'events', events: [] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: badVisitorId, message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[0] as { content: string }).content).toMatch(/visitor session missing/i)
    expect((events[1] as { data: unknown }).data).toEqual({ finishReason: 'error' })
    // Care client must never be called for an invalid visitorId
    expect(fake.createCalls).toHaveLength(0)
    expect(fake.streamCalls).toHaveLength(0)
  })

  it('caller abort: emits exactly one complete with finishReason=stop, does NOT invalidate the session', async () => {
    // Simulate the SDK rejecting its streamMessage promise because AbortSignal fired.
    // The bridge's outer catch block must branch on abortSignal.aborted:
    //   - emit a clean complete (finishReason='stop'), not an error chunk
    //   - do NOT invalidate the session (second turn still reuses careConversationId)
    const abortController = new AbortController()
    abortController.abort(new DOMException('Aborted', 'AbortError'))

    const fake = makeScriptedFakeClient({
      createScript: [
        { kind: 'success', conversationId: 'care-conv-1' },
        // second turn create (reuse — should NOT be called if session is preserved)
        { kind: 'success', conversationId: 'care-conv-SHOULD-NOT-APPEAR' },
      ],
      streamScript: [
        // First turn: push one delta then throw an AbortError (simulates SDK abort)
        {
          kind: 'throwAfter',
          events: [{ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'partial answer' }],
          error: new DOMException('Aborted', 'AbortError'),
        },
        // Second turn (non-aborted): completes normally
        { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
      ],
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!

    const collectedEvents: BridgeEvent[] = []
    for await (const e of bridge.streamSupportTurn({
      aabConversationId: 'aab-1',
      visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      message: 'hi',
      abortSignal: abortController.signal,
    })) {
      collectedEvents.push(e)
    }

    // Terminal complete must be present with finishReason='stop'
    const completeEvents = collectedEvents.filter(e => e.type === 'complete')
    expect(completeEvents).toHaveLength(1)
    expect((completeEvents[0] as { data: unknown }).data).toEqual({ finishReason: 'stop' })

    // No user-facing error copy — abort is a clean termination, not a failure
    const errorChunks = collectedEvents
      .filter(e => e.type === 'chunk')
      .map(e => (e as { content: string }).content)
      .filter(c => /lost connection|sorry.*problem/i.test(c))
    expect(errorChunks).toHaveLength(0)

    // Session must NOT have been invalidated — a second turn on the SAME bridge
    // with the same aabConversationId should NOT call createConversation again.
    await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1',
      visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      message: 'follow-up',
    }))
    // Only 1 createConversation call total across both turns
    expect(fake.createCalls).toHaveLength(1)
  })
})

describe('streamSupportTurn — in-stream Care error event', () => {
  it('translates in-stream error event to a controlled user-facing chunk (not raw Care message)', async () => {
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: {
        kind: 'events',
        events: [
          { eventId: 1, timestamp: 1, type: 'delta', textDelta: 'partial answer' },
          { eventId: 2, timestamp: 2, type: 'error', message: 'backend overloaded', fatal: false } as never,
          // no 'result' — stream closes; post-loop guard emits synthetic complete
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: () => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    // delta chunk + error chunk + synthetic complete (no result event)
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect((events[0] as { content: string }).content).toBe('partial answer')
    // The error chunk must use a controlled string — NOT Care's raw diagnostic message
    const errorContent: string = (events[1] as { content: string }).content
    expect(errorContent).not.toContain('backend overloaded')
    expect(errorContent.length).toBeGreaterThan(0)
  })
})
