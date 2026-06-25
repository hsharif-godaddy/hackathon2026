import { describe, it, expect, vi } from 'vitest'
import type { CareBridge, BridgeEvent } from '../../../care/index.js'
import { MessageExecutionService } from '../MessageExecutionService.js'

interface CompleteConversationCall {
  streamingEvents: unknown[]
  result: unknown
}

/**
 * Minimal stubs for the deps MessageExecutionService consumes. We only
 * exercise the support-turn branch; other deps are touched only insofar
 * as the support path uses them (persistence, eventChannel, stateManager,
 * sseRegistry).
 */
function makeDeps(careBridge: CareBridge | null, isCareEnabled?: () => boolean) {
  const publishedEvents: BridgeEvent[] = []
  const persistenceCalls: string[] = []
  const completeCalls: CompleteConversationCall[] = []
  const eventChannel = {
    publish: vi.fn(async (_convId: string, event: BridgeEvent) => {
      publishedEvents.push(event)
      return undefined as never
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }
  const persistence = {
    continueConversation: vi.fn(async () => { persistenceCalls.push('continueConversation'); return 'msg-user-1' }),
    startAgentTurn: vi.fn(async () => { persistenceCalls.push('startAgentTurn'); return 'msg-agent-1' }),
    completeConversation: vi.fn(async (_convId: string, streamingEvents: unknown[], result: unknown) => {
      persistenceCalls.push('completeConversation')
      completeCalls.push({ streamingEvents, result })
    }),
    captureStreamingEvent: vi.fn(async () => undefined),
    startConversation: vi.fn(async () => 'conv-1'),
    handleConversationError: vi.fn(async () => undefined),
    handleDisconnection: vi.fn(async () => undefined),
  }
  // Fake SSE subscriber with a stable id so setupStreamState adds it to
  // subscriberIds and the finally block calls eventChannel.unsubscribe.
  const fakeSseSubscriber = { id: 'sub-test-1' }
  return {
    publishedEvents, persistenceCalls, completeCalls,
    deps: {
      getAgent: vi.fn(),
      contextManager: { loadContextMessages: vi.fn(async () => ({ contextMessages: [] })) },
      loadConversationHistory: vi.fn(async () => []),
      conversationPersistence: persistence as any,
      eventChannel: eventChannel as any,
      sseRegistry: { getSubscribers: () => [fakeSseSubscriber] } as any,
      stateManager: {
        getCurrentAgent: () => undefined,
        getLastHandoffPrompt: () => undefined,
        clearLastHandoffPrompt: () => undefined,
        setSessionMetadata: () => undefined,
        getSelectedTodoList: () => undefined,
        setSelectedTodoList: () => undefined,
      } as any,
      careBridge,
      ...(isCareEnabled ? { isCareEnabled } : {}),
    } as any,
  }
}

async function* yieldEvents(events: BridgeEvent[]): AsyncGenerator<BridgeEvent, void, void> {
  for (const e of events) yield e
}

function execParamsSupport(overrides: Partial<{ visitorId: string | undefined }> = {}): any {
  const visitorId = 'visitorId' in overrides ? overrides.visitorId : 'vis-1'
  return {
    appId: 'app-1', conversationId: 'aab-1', content: 'help me', siteId: 'site-1',
    agentId: 'support', authType: 'basic',
    lifecycleContext: { agentContext: { visitorId } },
  }
}

describe('MessageExecutionService — support turn', () => {
  it('forwards bridge events to the event channel for a /agent support turn', async () => {
    const { publishedEvents, deps, persistenceCalls, completeCalls } = makeDeps({
      streamSupportTurn: () => yieldEvents([
        { type: 'chunk', content: 'hello ', data: {}, agentName: 'support', conversationId: 'aab-1' },
        { type: 'chunk', content: 'world', data: {}, agentName: 'support', conversationId: 'aab-1' },
        { type: 'complete', content: '', data: { finishReason: 'stop' }, agentName: 'support', conversationId: 'aab-1' },
      ]),
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'chunk', 'complete'])
    expect(persistenceCalls).toContain('continueConversation')
    expect(persistenceCalls).toContain('startAgentTurn')
    // C1: care responses must be persisted via completeConversation
    expect(persistenceCalls).toContain('completeConversation')
    expect(completeCalls).toHaveLength(1)
    // 3 events: 2 chunks + 1 complete from the bridge fixture
    expect(completeCalls[0]?.streamingEvents).toHaveLength(3)
    // finishReason threaded from bridge's complete event
    expect((completeCalls[0]?.result as { finishReason: string }).finishReason).toBe('stop')
    // Cleanup: eventChannel.unsubscribe must be called so subscriber bridge is torn down
    expect(deps.eventChannel.unsubscribe).toHaveBeenCalled()
  })

  it('reflects finishReason=error in completeConversation when bridge emits error complete', async () => {
    const { deps, completeCalls } = makeDeps({
      streamSupportTurn: () => yieldEvents([
        { type: 'chunk', content: 'sorry', data: {}, agentName: 'support', conversationId: 'aab-1' },
        { type: 'complete', content: '', data: { finishReason: 'error' }, agentName: 'support', conversationId: 'aab-1' },
      ]),
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(completeCalls).toHaveLength(1)
    // finishReason threaded from bridge's complete event — must be 'error', not hardcoded 'stop'
    expect((completeCalls[0]?.result as { finishReason: string }).finishReason).toBe('error')
  })

  it('emits "visitor session missing" inline error when visitorId is absent', async () => {
    const { publishedEvents, deps, persistenceCalls, completeCalls } = makeDeps({
      streamSupportTurn: () => { throw new Error('bridge should not be called') },
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport({ visitorId: undefined }))
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/visitor session missing|support is unavailable/i)
    // Guard paths must persist the chunk+complete so agent message has segments in DB
    expect(persistenceCalls).toContain('completeConversation')
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0]?.streamingEvents).toHaveLength(2)
    expect((completeCalls[0]?.streamingEvents as Array<{ type: string }>).map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((completeCalls[0]?.result as { finishReason: string }).finishReason).toBe('error')
    // Cleanup must run on guard paths too
    expect(deps.eventChannel.unsubscribe).toHaveBeenCalled()
  })

  it('emits "Care not configured" inline error when careBridge dep is null', async () => {
    const { publishedEvents, deps, persistenceCalls, completeCalls } = makeDeps(null)
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/not configured/i)
    // Guard paths must persist the chunk+complete so agent message has segments in DB
    expect(persistenceCalls).toContain('completeConversation')
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0]?.streamingEvents).toHaveLength(2)
    expect((completeCalls[0]?.streamingEvents as Array<{ type: string }>).map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((completeCalls[0]?.result as { finishReason: string }).finishReason).toBe('error')
    // Cleanup must run on guard paths too
    expect(deps.eventChannel.unsubscribe).toHaveBeenCalled()
  })

  it('emits "temporarily unavailable" inline error when kill-switch is disabled', async () => {
    const { publishedEvents, deps, persistenceCalls, completeCalls } = makeDeps(
      { streamSupportTurn: () => { throw new Error('bridge should not be called when killswitch is off') } },
      () => false,
    )
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/temporarily unavailable/i)
    // Guard paths must persist the chunk+complete so agent message has segments in DB
    expect(persistenceCalls).toContain('completeConversation')
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0]?.streamingEvents).toHaveLength(2)
    expect((completeCalls[0]?.streamingEvents as Array<{ type: string }>).map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((completeCalls[0]?.result as { finishReason: string }).finishReason).toBe('error')
    // Cleanup must run on guard paths too
    expect(deps.eventChannel.unsubscribe).toHaveBeenCalled()
  })

  it('forwards bridge events when kill-switch is wired and returns true', async () => {
    const { publishedEvents, deps } = makeDeps(
      {
        streamSupportTurn: () => yieldEvents([
          { type: 'chunk', content: 'ok', data: {}, agentName: 'support', conversationId: 'aab-1' },
          { type: 'complete', content: '', data: { finishReason: 'stop' }, agentName: 'support', conversationId: 'aab-1' },
        ]),
      },
      () => true,
    )
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    // Predicate present and true → guard transparent, bridge runs to completion.
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).not.toMatch(/temporarily unavailable/i)
  })

  it('runs cleanup when continueConversation throws (persist-failure path)', async () => {
    const { publishedEvents, deps, completeCalls } = makeDeps({
      streamSupportTurn: () => { throw new Error('bridge should not be called') },
    })
    deps.conversationPersistence.continueConversation = vi.fn(async () => {
      throw new Error('db locked')
    })
    const svc = new MessageExecutionService(deps)
    await svc.execute(execParamsSupport())
    // Error chunk + complete must still be published
    expect(publishedEvents.map(e => e.type)).toEqual(['chunk', 'complete'])
    expect((publishedEvents[0] as { content: string }).content).toMatch(/something went wrong/i)
    // Persist-failure path must also pass chunk+complete to completeConversation
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0]?.streamingEvents).toHaveLength(2)
    // Cleanup must run even on persist failure
    expect(deps.eventChannel.unsubscribe).toHaveBeenCalled()
  })
})
