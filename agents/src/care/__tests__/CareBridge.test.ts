import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AgentClientError } from '@airo-care/client'
import type { AiroCareClient } from '@airo-care/client'
import { createCareBridge } from '../CareBridge.js'
import type { BridgeEvent } from '../CareBridge.js'
import { makeFakeClient, makeScriptedFakeClient } from './fixtures/fake-airo-care-client.js'
import * as idpCache from '../../utils/idp-token-cache.js'
import * as careAuth from '../careAuth.js'

vi.mock('../../utils/idp-token-cache.js', () => ({
  getIdpToken: vi.fn(),
}))
vi.mock('../careAuth.js', () => ({
  getCareS2SToken: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(idpCache.getIdpToken).mockReturnValue('eyJ.mock.idp-token')
  vi.mocked(careAuth.getCareS2SToken).mockResolvedValue('eyJ.s2s.token')
})

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
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
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
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
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
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[0] as { content: string }).content.length).toBeGreaterThan(0)
    expect((events[1] as { data: unknown }).data).toEqual({ finishReason: 'error' })
    await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'retry' }))
    expect(fake.createCalls).toHaveLength(2)
  })

  it('stream-mid throw yields error chunk + complete with finishReason=error, invalidates session', async () => {
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
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect((events[0] as { content: string }).content).toBe('partial')
    expect((events[2] as { data: unknown }).data).toEqual({ finishReason: 'error' })
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
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((events[1] as { data: unknown }).data).toEqual({ finishReason: 'stop' })
  })

  it('caller abort: emits exactly one complete with finishReason=stop, does NOT invalidate the session', async () => {
    const abortController = new AbortController()
    abortController.abort(new DOMException('Aborted', 'AbortError'))

    const fake = makeScriptedFakeClient({
      createScript: [
        { kind: 'success', conversationId: 'care-conv-1' },
        { kind: 'success', conversationId: 'care-conv-SHOULD-NOT-APPEAR' },
      ],
      streamScript: [
        {
          kind: 'throwAfter',
          events: [{ eventId: 1, timestamp: 1, type: 'delta', textDelta: 'partial answer' }],
          error: new DOMException('Aborted', 'AbortError'),
        },
        { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
      ],
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
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

    const completeEvents = collectedEvents.filter(e => e.type === 'complete')
    expect(completeEvents).toHaveLength(1)
    expect((completeEvents[0] as { data: unknown }).data).toEqual({ finishReason: 'stop' })

    const errorChunks = collectedEvents
      .filter(e => e.type === 'chunk')
      .map(e => (e as { content: string }).content)
      .filter(c => /lost connection|sorry.*problem/i.test(c))
    expect(errorChunks).toHaveLength(0)

    await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1',
      visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      message: 'follow-up',
    }))
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
        ],
      },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({ aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi' }))
    expect(events.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect((events[0] as { content: string }).content).toBe('partial answer')
    const errorContent: string = (events[1] as { content: string }).content
    expect(errorContent).not.toContain('backend overloaded')
    expect(errorContent.length).toBeGreaterThan(0)
  })
})

describe('streamSupportTurn — dual-auth', () => {
  it('IDP cache miss yields error chunk + complete with finishReason=error', async () => {
    vi.mocked(idpCache.getIdpToken).mockReturnValue(null)
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: '' }] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: (_idpToken: string) => fake as unknown as AiroCareClient,
    })!
    const events = await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi',
    }))
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'chunk', content: expect.stringContaining('authentication expired') })
    expect(events[1]).toMatchObject({ type: 'complete', data: { finishReason: 'error' } })
    expect(fake.createCalls).toHaveLength(0)
  })

  it('IDP token from cache is forwarded to the client factory', async () => {
    vi.mocked(idpCache.getIdpToken).mockReturnValue('eyJ.customer.token')
    let receivedIdpToken: string | undefined
    const fake = makeFakeClient({
      create: { kind: 'success', conversationId: 'care-conv-1' },
      stream: { kind: 'events', events: [{ eventId: 1, timestamp: 1, type: 'result', output: 'ok' }] },
    })
    const bridge = createCareBridge({
      baseURL: 'https://care.example', executor: 'v1/test',
      clientFactory: (idpToken: string) => { receivedIdpToken = idpToken; return fake as unknown as AiroCareClient },
    })!
    await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi',
    }))
    expect(vi.mocked(idpCache.getIdpToken)).toHaveBeenCalledWith('aab-1')
    expect(receivedIdpToken).toBe('eyJ.customer.token')
  })

  it('default factory invokes getCareS2SToken with idpToken as delegatedFor', async () => {
    vi.mocked(idpCache.getIdpToken).mockReturnValue('eyJ.customer.token')
    vi.mocked(careAuth.getCareS2SToken).mockResolvedValue('eyJ.s2s.token')
    // Stub fetch so the real AiroCareClient fails fast after auth headers are applied —
    // applyAuth (which calls getCareS2SToken) runs before the fetch, so the mock is still called.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })))
    const bridge = createCareBridge({ baseURL: 'https://care.example', executor: 'v1/test' })!
    const events = await drain(bridge.streamSupportTurn({
      aabConversationId: 'aab-1', visitorId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', message: 'hi',
    }))
    vi.unstubAllGlobals()
    expect(vi.mocked(careAuth.getCareS2SToken)).toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'complete', data: { finishReason: 'error' } })
  })
})
