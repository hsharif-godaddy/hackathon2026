import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { context as otelContext, trace as otelTrace } from '@opentelemetry/api'

// Mock the Langfuse invocation-span SDK so tests can assert the lifecycle
// (createAgentInvocationSpan → end) that MessageExecutionService now owns.
// Dropping an `invocation.end()` call on any exit path would leave the
// Langfuse span permanently open and zero tests would fail without this spy.
//
// The mock invocation context carries a wrapped SpanContext with a real
// traceId so `trace.getSpan(invocation.context).spanContext().traceId`
// resolves. Without this, `otelContext.active()` returns the root NOOP
// context, `getSpan` returns undefined, and the traceId-injection branch
// in streamAgentTurn (executionContext.metadata.traceId = …) never fires
// in any test — leaving the primary behavioral change of this PR
// untested. The traceId assertion in the success test pins that wiring.
const MOCK_TRACE_ID = 'abcdef1234567890abcdef1234567890'
const mockSpan = otelTrace.wrapSpanContext({
  traceId: MOCK_TRACE_ID,
  spanId: '0123456789abcdef',
  traceFlags: 1,
  isRemote: false,
})
const mockInvocationContext = otelTrace.setSpan(otelContext.active(), mockSpan)
const mockInvocationEnd = vi.fn()
const mockCreateAgentInvocationSpan = vi.fn(() => ({
  context: mockInvocationContext,
  end: mockInvocationEnd,
}))
vi.mock('@godaddy/agent-otel-sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-otel-sdk')
  return {
    ...actual,
    createAgentContext: vi.fn(() => otelContext.active()),
    createAgentInvocationSpan: (...args: any[]) => mockCreateAgentInvocationSpan(...args),
  }
})

import { MessageExecutionService } from '../MessageExecutionService.js'

// Mock ai-lib-websocket-server to avoid heavy dependency chain.
// `actionServiceMap` is module-local so tests can assert registry state
// without touching the production clientActionServices map.
const actionServiceMap = new Map<string, { cleanup: () => void }>()
vi.mock('../../ai-lib-websocket-server.js', () => ({
  registerExternalActionService: vi.fn((key: string, service: any) => {
    actionServiceMap.set(key, service)
  }),
  unregisterExternalActionService: vi.fn((key: string) => {
    const s = actionServiceMap.get(key)
    if (s) { s.cleanup(); actionServiceMap.delete(key) }
  }),
  getClientActionService: vi.fn((key: string) => actionServiceMap.get(key) ?? null),
}))

// Mock message-lifecycle helpers so the lifecycle-deps test can assert
// commitHash / usedFreeGrants propagation without running real git hooks.
const mockRunMessageEndHooks = vi.fn().mockResolvedValue({ commitHash: null, usedFreeGrants: false })
const mockAwaitOutcome = vi.fn().mockResolvedValue(undefined)
const mockStartParallelAssessment = vi.fn(() => ({ awaitOutcome: mockAwaitOutcome }))
vi.mock('../../message-lifecycle.js', () => ({
  runStartGitHook: vi.fn().mockResolvedValue(undefined),
  startParallelAssessment: (...args: any[]) => mockStartParallelAssessment(...args),
  runMessageEndHooks: (...args: any[]) => mockRunMessageEndHooks(...args),
}))

vi.mock('../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: vi.fn(() => null),
}))

// Mock context-builders to avoid heavy dependency chain (AppRepository, KnowB, Langfuse)
vi.mock('../../context-builders.js', () => ({
  buildDynamicDataMessage: vi.fn().mockReturnValue({
    role: 'user', content: '## Dynamic Context\n\nToday is Wednesday', insertionOrder: 'after_history',
  }),
  buildTodoContextMessage: vi.fn().mockResolvedValue(null),
  buildRagContextMessage: vi.fn().mockResolvedValue(null),
  collectImagesFromFormattedContexts: vi.fn().mockReturnValue([]),
  dataUrlsToProcessedFiles: vi.fn().mockReturnValue([]),
}))

function makeReadableStream(parts: any[]): ReadableStream {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < parts.length) {
        controller.enqueue({ part: parts[index++] })
      } else {
        controller.close()
      }
    }
  })
}

function createMockDeps(parts: any[] = []) {
  return {
    getAgent: vi.fn().mockReturnValue({
      streamGenerate: vi.fn().mockResolvedValue({
        textStream: (async function* () {})(),
        baseStream: makeReadableStream(parts)
      }),
      getName: vi.fn().mockReturnValue('AI Developer'),
    }),
    contextManager: {
      loadContextMessages: vi.fn().mockResolvedValue({ contextMessages: [], formattedContexts: [] })
    },
    loadConversationHistory: vi.fn().mockResolvedValue([]),
    conversationPersistence: {
      continueConversation: vi.fn().mockResolvedValue(undefined),
      startAgentTurn: vi.fn().mockResolvedValue('agent-msg-1'),
      completeConversation: vi.fn().mockResolvedValue(undefined),
      handleConversationError: vi.fn().mockResolvedValue(undefined),
    },
    eventChannel: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue({ sequence: 1 })
    },
    sseRegistry: {
      getSubscribers: vi.fn().mockReturnValue([]),
      hasConnections: vi.fn().mockReturnValue(true),
      sendToAll: vi.fn(),
    },
    stateManager: {
      getCurrentAgent: vi.fn().mockReturnValue(undefined),
      getLastHandoffPrompt: vi.fn().mockReturnValue(undefined),
      clearLastHandoffPrompt: vi.fn(),
      setSessionMetadata: vi.fn(),
      getSelectedTodoList: vi.fn().mockReturnValue(undefined),
      setSelectedTodoList: vi.fn(),
    },
    onAgentChanged: vi.fn().mockResolvedValue(undefined),
  }
}

const DEFAULT_PARAMS = {
  appId: 'app_1',
  conversationId: 'conv_1',
  content: 'Hello',
  siteId: 'site_1',
  agentId: 'develop',
}

describe('MessageExecutionService', () => {
  let service: MessageExecutionService
  let deps: ReturnType<typeof createMockDeps>

  beforeEach(() => {
    actionServiceMap.clear()
    mockInvocationEnd.mockReset()
    mockCreateAgentInvocationSpan.mockClear()
    deps = createMockDeps()
    service = new MessageExecutionService(deps as any)
  })

  it('registers SSE subscribers on the event channel', async () => {
    const mockSub = { id: 'sse-1', onEvent: vi.fn(), onError: vi.fn() }
    deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])

    await service.execute(DEFAULT_PARAMS)

    expect(deps.eventChannel.subscribe).toHaveBeenCalledWith('conv_1', mockSub)
  })

  describe('streaming loop', () => {
    it('publishes chunk event for text-delta parts', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'hello' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'chunk', content: 'hello' })
      )
    })

    it('publishes tool_start event for tool-input-start parts', async () => {
      deps = createMockDeps([{ type: 'tool-input-start', id: 'tid1', toolName: 'myTool' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_start',
          data: expect.objectContaining({ tool: expect.objectContaining({ id: 'tid1', name: 'myTool' }) })
        })
      )
    })

    it('publishes tool_input_delta event for tool-input-delta parts', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-input-delta', id: 'tid1', toolName: 'myTool', delta: '{"k":' }
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_input_delta',
          data: expect.objectContaining({ toolId: 'tid1', delta: '{"k":' })
        })
      )
    })

    it('publishes tool_call event with parsed input for tool-call parts', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-input-delta', id: 'tid1', toolName: 'myTool', delta: '{"key":"val"}' },
        { type: 'tool-call', id: 'tid1', toolName: 'myTool' }
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_call',
          data: expect.objectContaining({
            tool: expect.objectContaining({ id: 'tid1', name: 'myTool', input: { key: 'val' } })
          })
        })
      )
    })

    it('publishes tool_result event for tool-result parts', async () => {
      deps = createMockDeps([
        { type: 'tool-result', id: 'tid1', toolName: 'myTool', input: { k: 'v' }, output: 'done' }
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            tool: expect.objectContaining({ id: 'tid1', output: 'done' })
          })
        })
      )
    })

    it('publishes tool_result with is_error for tool-error parts', async () => {
      deps = createMockDeps([
        { type: 'tool-error', id: 'tid1', toolName: 'myTool', error: new Error('boom') }
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            tool: expect.objectContaining({ is_error: true, error: 'boom' })
          })
        })
      )
    })

    it('publishes complete event after stream finishes', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete' })
      )
    })

    it('publishes error event and does not throw when stream errors', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            start(controller) {
              controller.enqueue({ part: { type: 'error', error: new Error('stream failure') } })
              controller.close()
            }
          })
        })
      })
      service = new MessageExecutionService(deps as any)

      await expect(
        service.execute(DEFAULT_PARAMS)
      ).resolves.toBeUndefined()

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error', content: 'stream failure' })
      )
    })

    it('unsubscribes SSE subscribers in finally block', async () => {
      const mockSub = { id: 'sse-1', onEvent: vi.fn(), onError: vi.fn() }
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.unsubscribe).toHaveBeenCalledWith('conv_1', 'sse-1')
    })
  })

  describe('persistence via AgentsMessagePersistence', () => {
    it('calls continueConversation to save user message', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.continueConversation).toHaveBeenCalledWith(
        'conv_1',
        'Hello',
        expect.objectContaining({
          socketId: 'sse:conv_1',
          agentName: 'develop',
          appId: 'app_1',
        })
      )
    })

    it('calls startAgentTurn to create in-progress placeholder', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.startAgentTurn).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ socketId: 'sse:conv_1', agentName: 'develop' })
      )
    })

    it('calls completeConversation with captured streaming events after success', async () => {
      deps = createMockDeps([
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'world' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.completeConversation).toHaveBeenCalledWith(
        'conv_1',
        expect.arrayContaining([
          expect.objectContaining({ type: 'chunk', content: 'Hello ' }),
          expect.objectContaining({ type: 'chunk', content: 'world' }),
        ]),
        undefined, // finalResult (getFinalResult not mocked)
        expect.objectContaining({ socketId: 'sse:conv_1' })
      )
    })

    it('captures tool events for persistence', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-input-delta', id: 'tid1', toolName: 'myTool', delta: '{"k":"v"}' },
        { type: 'tool-call', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-result', id: 'tid1', toolName: 'myTool', input: { k: 'v' }, output: 'done' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const events = deps.conversationPersistence.completeConversation.mock.calls[0][1]
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool_start', data: expect.objectContaining({ tool: expect.objectContaining({ id: 'tid1', name: 'myTool' }) }) }),
        expect.objectContaining({ type: 'tool_result', data: expect.objectContaining({ tool: expect.objectContaining({ id: 'tid1', output: 'done' }) }) }),
      ]))
    })

    it('captures tool error events for persistence', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-error', id: 'tid1', toolName: 'myTool', error: new Error('boom') },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const events = deps.conversationPersistence.completeConversation.mock.calls[0][1]
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool_result', data: expect.objectContaining({ tool: expect.objectContaining({ is_error: true, error: 'boom' }) }) }),
      ]))
    })

    it("delivers error + complete events to a subscriber registered via sseRegistry when continueConversation throws pre-turn", async () => {
      // Regression: the bridge from sseRegistry -> eventChannel used to run
      // AFTER the pre-turn try/catch, so publish() during a persistence
      // failure went to zero subscribers and the /stream client hung. The
      // fix hoists the bridge above the try/catch; this test wires a real
      // pubsub through eventChannel and asserts the subscriber received
      // terminal events.
      const subscribers = new Map<string, { id: string; onEvent: (e: any) => Promise<void> }>()
      deps.eventChannel.subscribe.mockImplementation((_convId: string, sub: any) => {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.unsubscribe.mockImplementation((_convId: string, id: string) => {
        subscribers.delete(id)
      })
      deps.eventChannel.publish.mockImplementation(async (_convId: string, event: any) => {
        for (const sub of subscribers.values()) await sub.onEvent(event)
        return { sequence: 1 }
      })
      const mockSub = { id: 'sse-1', onEvent: vi.fn().mockResolvedValue(undefined), onError: vi.fn() }
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.conversationPersistence.continueConversation.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(mockSub.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', content: 'SQLITE_BUSY' })
      )
      expect(mockSub.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) })
      )
      expect(deps.getAgent().streamGenerate).not.toHaveBeenCalled()
    })

    it("delivers error event to subscriber when startAgentTurn throws pre-turn", async () => {
      const subscribers = new Map<string, { id: string; onEvent: (e: any) => Promise<void> }>()
      deps.eventChannel.subscribe.mockImplementation((_convId: string, sub: any) => {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.publish.mockImplementation(async (_convId: string, event: any) => {
        for (const sub of subscribers.values()) await sub.onEvent(event)
        return { sequence: 1 }
      })
      const mockSub = { id: 'sse-1', onEvent: vi.fn().mockResolvedValue(undefined), onError: vi.fn() }
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.conversationPersistence.startAgentTurn.mockRejectedValueOnce(new Error('schema mismatch'))
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(mockSub.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', content: 'schema mismatch' })
      )
      expect(deps.getAgent().streamGenerate).not.toHaveBeenCalled()
    })

    it('calls completeConversation even on error to persist partial results', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            start(controller) {
              controller.enqueue({ part: { type: 'error', error: new Error('stream failure') } })
              controller.close()
            }
          })
        })
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.completeConversation).toHaveBeenCalledWith(
        'conv_1',
        expect.any(Array),
        undefined,
        expect.objectContaining({ socketId: 'sse:conv_1' })
      )
    })
  })

  describe('conversation history loading', () => {
    it('loads history for the conversation', async () => {
      const historyMessages = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First reply' },
      ]
      deps.loadConversationHistory.mockResolvedValue(historyMessages)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.loadConversationHistory).toHaveBeenCalledWith('conv_1', 'app_1', 'develop')
      expect(deps.getAgent().streamGenerate).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ messages: expect.arrayContaining(historyMessages) })
      )
    })

    it('continues without history if loading fails', async () => {
      deps.loadConversationHistory.mockRejectedValue(new Error('DB error'))

      await service.execute(DEFAULT_PARAMS)

      expect(deps.getAgent().streamGenerate).toHaveBeenCalled()
    })
  })

  describe('agent selection', () => {
    it('uses agentId from params directly', async () => {
      await service.execute({ ...DEFAULT_PARAMS, agentId: 'marketing' })

      expect(deps.getAgent).toHaveBeenCalledWith('marketing')
    })
  })

  describe('context message ordering', () => {
    it('splits before_history and after_history context', async () => {
      deps.contextManager.loadContextMessages.mockResolvedValue({
        contextMessages: [
          { role: 'system', content: 'System prompt', insertionOrder: 'before_history', cachePoint: { type: 'ephemeral' } },
          { role: 'user', content: 'App context', insertionOrder: 'after_history' },
        ],
        formattedContexts: [],
      })

      await service.execute(DEFAULT_PARAMS)

      const call = deps.getAgent().streamGenerate.mock.calls[0]
      const opts = call[1]
      expect(opts.context).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'System prompt' })
      ]))
      expect(opts.context[0]).not.toHaveProperty('insertionOrder')
      expect(opts.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'App context' })
      ]))
    })
  })

  describe('subscribeStream (late-join)', () => {
    it('delivers subsequent events to a subscriber that joins after execute() has started', async () => {
      // Wire a pubsub through eventChannel so subscribe/publish actually fan out.
      const subscribers = new Map<string, { id: string; onEvent: (e: any) => Promise<void> }>()
      deps.eventChannel.subscribe.mockImplementation((_convId: string, sub: any) => {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.unsubscribe.mockImplementation((_convId: string, id: string) => {
        subscribers.delete(id)
      })
      deps.eventChannel.publish.mockImplementation(async (_convId: string, event: any) => {
        for (const sub of subscribers.values()) await sub.onEvent(event)
        return { sequence: 1 }
      })

      let releaseFirst: () => void = () => {}
      const firstGate = new Promise<void>(r => { releaseFirst = r })
      let releaseSecond: () => void = () => {}
      const secondGate = new Promise<void>(r => { releaseSecond = r })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await firstGate
              controller.enqueue({ part: { type: 'text-delta', text: 'late' } })
              await secondGate
              controller.close()
            }
          }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const exec = service.execute(DEFAULT_PARAMS)

      // Wait until the turn has registered itself so subscribeStream can attach.
      for (let i = 0; i < 100 && !service.hasActiveStream('conv_1'); i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      expect(service.hasActiveStream('conv_1')).toBe(true)

      const lateSub = { id: 'sse-late', onEvent: vi.fn().mockResolvedValue(undefined) }
      service.subscribeStream('conv_1', lateSub as any)

      releaseFirst()
      // Wait for the late subscriber to see the chunk before closing the stream.
      for (let i = 0; i < 100 && lateSub.onEvent.mock.calls.length === 0; i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      releaseSecond()
      await exec

      expect(lateSub.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'chunk', content: 'late' })
      )
      // Guard against regressing the finally-block cleanup: late subscribers
      // go into streamState.subscriberIds and must be unsubscribed too.
      expect(deps.eventChannel.unsubscribe).toHaveBeenCalledWith('conv_1', 'sse-late')
    })

    it('is a no-op when no active stream exists for the conversation', () => {
      const lateSub = { id: 'sse-late', onEvent: vi.fn() }
      service.subscribeStream('never-started', lateSub as any)

      expect(deps.eventChannel.subscribe).not.toHaveBeenCalled()
      expect(lateSub.onEvent).not.toHaveBeenCalled()
    })
  })

  describe('handoff-turn persistence failure', () => {
    it("logs sse.execution.persistence_handoff_turn_failed and rethrows into outer catch when startAgentTurn throws at iteration > 0", async () => {
      // Drive executeAgentLoop into a handoff: stateManager returns 'marketing'
      // as the next agent after the first turn, triggering iteration 1's
      // startAgentTurn. That second call rejects. The new catch branch must
      // tag the failure and rethrow so the outer catch emits terminal events.
      deps.conversationPersistence.startAgentTurn
        .mockResolvedValueOnce('agent-msg-1')
        .mockRejectedValueOnce(new Error('SQLITE_BUSY on handoff'))

      // Always return a different agent so executeAgentLoop does a handoff
      // after iteration 0. Once we're on 'marketing', getHandoffDetails bails
      // out (current === currentAgent) so the loop terminates instead of
      // handing off forever.
      deps.stateManager.getCurrentAgent.mockReturnValue('marketing')
      deps.stateManager.getLastHandoffPrompt.mockReturnValue('continue on marketing')

      deps.getAgent.mockImplementation((name?: string) => ({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }))
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')

      // Assertions live outside the try block so an unexpected execute()
      // throw fails the test loudly instead of being masked by the finally.
      // Capture calls before mockRestore clears them.
      let executeError: unknown
      let errorCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } catch (e) {
        executeError = e
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }
      expect(executeError).toBeUndefined()

      const handoffCall = errorCalls.find(
        c => c[0] === 'sse.execution.persistence_handoff_turn_failed'
      )
      expect(handoffCall).toBeDefined()
      expect(handoffCall?.[1]).toMatchObject({
        conversationId: 'conv_1',
        iteration: 1,
        agentName: 'marketing',
        error: 'SQLITE_BUSY on handoff',
      })

      // Without the rethrow, the success path would run and the client would
      // see a phantom success. The outer catch publishes error + complete.
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error', content: 'SQLITE_BUSY on handoff' })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) })
      )
    })
  })

  describe('StreamTimingTracker wiring', () => {
    it('calls tracker lifecycle methods and logs timing on completion', async () => {
      const { StreamTimingTracker } = await import('@airo/ai-transport')
      const loggerMod = await import('../../../logging/index.js')
      const recordChunkSpy = vi.spyOn(StreamTimingTracker.prototype, 'recordChunk')
      const recordTextChunkSpy = vi.spyOn(StreamTimingTracker.prototype, 'recordTextChunk')
      const pauseSpy = vi.spyOn(StreamTimingTracker.prototype, 'pauseGapTracking')
      const resumeSpy = vi.spyOn(StreamTimingTracker.prototype, 'resumeGapTracking')
      const finalizeSpy = vi.spyOn(StreamTimingTracker.prototype, 'finalize').mockReturnValue({
        chunksRead: 5, streamDurationMs: 1200, averageGapMs: 50, maxGapMs: 200, slowGapCount: 0,
      } as any)
      const infoSpy = vi.spyOn(loggerMod.logger, 'info')

      deps = createMockDeps([
        { type: 'text-delta', text: 'hi' },
        { type: 'tool-input-start', id: 'tc1', toolName: 'readFile' },
        { type: 'tool-input-delta', id: 'tc1', toolName: 'readFile', delta: '{}' },
        { type: 'tool-call', id: 'tc1', toolName: 'readFile', input: {} },
        { type: 'tool-result', id: 'tc1', toolName: 'readFile', result: 'ok' },
        { type: 'text-delta', text: ' world' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(recordTextChunkSpy).toHaveBeenCalled()
      expect(recordChunkSpy).toHaveBeenCalled()
      expect(pauseSpy).toHaveBeenCalledWith('readFile')
      expect(resumeSpy).toHaveBeenCalled()
      expect(finalizeSpy).toHaveBeenCalled()

      expect(infoSpy).toHaveBeenCalledWith('sse.stream.timing', expect.objectContaining({
        appId: 'app_1',
        conversationId: 'conv_1',
        agentName: 'develop',
        chunksRead: 5,
        streamDurationMs: 1200,
      }))

      recordChunkSpy.mockRestore()
      recordTextChunkSpy.mockRestore()
      pauseSpy.mockRestore()
      resumeSpy.mockRestore()
      finalizeSpy.mockRestore()
      infoSpy.mockRestore()
    })
  })

  describe('per-stream publish rejection isolation', () => {
    it('does not abort the turn when a single in-stream publish rejects', async () => {
      // Pre-guard, a blocking-subscriber rejection on a chunk publish would
      // propagate through Promise.all(pendingPublishes), reject
      // streamAgentTurn, and flip the outer catch into an error+complete.
      // Guard: each publish has its own .catch so rejections are logged
      // and Promise.all always resolves.
      let callCount = 0
      deps.eventChannel.publish.mockImplementation(async (_conv: string, event: any) => {
        callCount += 1
        if (event.type === 'chunk' && callCount === 1) throw new Error('subscriber boom')
        return { sequence: callCount }
      })
      deps = { ...deps }
      const localDeps = createMockDeps([
        { type: 'text-delta', text: 'hello ' },
        { type: 'text-delta', text: 'world' },
      ])
      localDeps.eventChannel.publish.mockImplementation(async (_conv: string, event: any) => {
        callCount += 1
        if (event.type === 'chunk' && callCount === 1) throw new Error('subscriber boom')
        return { sequence: callCount }
      })
      service = new MessageExecutionService(localDeps as any)

      const loggerMod = await import('../../../logging/index.js')
      const warnSpy = vi.spyOn(loggerMod.logger, 'warn')
      let warnCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        warnCalls = warnSpy.mock.calls.slice()
        warnSpy.mockRestore()
      }

      // The turn completes normally: we still get the terminal `complete`
      // with finishReason NOT 'error'.
      const completeCall = (localDeps.eventChannel.publish as any).mock.calls.find(
        (c: any[]) => c[1]?.type === 'complete'
      )
      expect(completeCall).toBeDefined()
      expect(completeCall?.[1]?.data?.finishReason).not.toBe('error')

      // Log-name contract: a per-stream publish rejection must be logged under
      // sse.execution.stream_publish_failed, not the terminal-path name.
      const streamWarn = warnCalls.find(c => c[0] === 'sse.execution.stream_publish_failed')
      expect(streamWarn).toBeDefined()
      expect(streamWarn?.[1]).toMatchObject({ eventType: 'chunk' })
    })
  })

  describe('onHandoff agent-changed failure', () => {
    it('logs sse.handoff.agent_changed_failed and rethrows when onAgentChanged rejects', async () => {
      deps.stateManager.getCurrentAgent.mockReturnValue('marketing')
      deps.stateManager.getLastHandoffPrompt.mockReturnValue('continue')
      deps.onAgentChanged.mockRejectedValueOnce(new Error('notifier down'))
      deps.getAgent.mockImplementation((name?: string) => ({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }))
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')

      let executeError: unknown
      let errorCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } catch (e) {
        executeError = e
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }
      expect(executeError).toBeUndefined()

      const tagged = errorCalls.find(
        c => c[0] === 'sse.handoff.agent_changed_failed'
      )
      expect(tagged).toBeDefined()
      expect(tagged?.[1]).toMatchObject({
        conversationId: 'conv_1',
        toAgent: 'marketing',
        error: 'notifier down',
      })
      // Rethrow means outer catch publishes terminal error events.
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'error', content: 'notifier down' })
      )
    })
  })

  describe('textStream fallback path', () => {
    it('processes text deltas when streamResult.baseStream is absent', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          baseStream: undefined,
          textStream: (async function* () {
            yield 'hello '
            yield 'world'
          })(),
        }),
        getName: vi.fn().mockReturnValue('develop'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'chunk', content: 'hello ' })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'chunk', content: 'world' })
      )
    })
  })

  describe('error-path end-hook guard', () => {
    it('still runs completeConversation + terminal publishes when runMessageEndHooks rejects on the error path', async () => {
      // streamGenerate throws -> outer catch runs -> runMessageEndHooks rejects
      // -> inner try/catch must swallow so completeConversation + publishes fire.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('stream boom')),
        getName: vi.fn().mockReturnValue('develop'),
      })
      mockRunMessageEndHooks.mockRejectedValueOnce(new Error('end hook boom'))
      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession: vi.fn(),
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      service = new MessageExecutionService({ ...deps, lifecycle } as any)

      await expect(service.execute(DEFAULT_PARAMS)).resolves.toBeUndefined()

      expect(deps.conversationPersistence.completeConversation).toHaveBeenCalled()
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'error' })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) })
      )
    })
  })

  describe('terminal publish .catch on error path', () => {
    it("does not let a subscriber rejection prevent the final 'complete' from being attempted when the error publish rejects", async () => {
      // The error path publishes `error` then `complete`. If `error` publish
      // rejects and we don't swallow, `complete` is skipped and the client
      // hangs. publishTerminal wraps each call with .catch so the second
      // publish always attempts.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('streamGenerate boom')),
        getName: vi.fn().mockReturnValue('develop'),
      })
      let publishCalls = 0
      deps.eventChannel.publish.mockImplementation(async (_convId: string, event: any) => {
        publishCalls += 1
        if (event.type === 'error') throw new Error('subscriber rejected')
        return { sequence: publishCalls }
      })
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await expect(service.execute(DEFAULT_PARAMS)).resolves.toBeUndefined()
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) })
      )

      // Severity contract: terminal publish failures strand the client
      // (they never get a stream-end signal) so they MUST be logged at
      // error level, not warn. Also verify log-event name.
      const terminalError = errorCalls.find(c => c[0] === 'sse.execution.terminal_publish_failed')
      expect(terminalError).toBeDefined()
      expect(terminalError?.[1]).toMatchObject({ eventType: 'error' })
    })
  })

  describe('errorFields helper (via catch-block logs)', () => {
    it('includes stack when the thrown value is an Error with a stack', async () => {
      // errorFields is module-private; exercise it through the pre-turn
      // persistence catch, which we know logs error-level with errorFields.
      const thrown = new Error('pre-turn boom')
      deps.conversationPersistence.continueConversation.mockRejectedValueOnce(thrown)
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      const log = errorCalls.find(c => c[0] === 'sse.execution.persistence_pre_turn_failed')
      expect(log).toBeDefined()
      expect(log?.[1]).toMatchObject({
        error: 'pre-turn boom',
        stack: expect.stringContaining('pre-turn boom'),
      })
    })

    it('omits stack gracefully for non-Error throws', async () => {
      deps.conversationPersistence.continueConversation.mockRejectedValueOnce('just a string')
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      const log = errorCalls.find(c => c[0] === 'sse.execution.persistence_pre_turn_failed')
      expect(log).toBeDefined()
      expect(log?.[1]).toMatchObject({ error: 'just a string' })
      expect(log?.[1]).not.toHaveProperty('stack')
    })
  })

  describe('concurrent execute()', () => {
    it('does not cleanup a replacement service when the first turn\'s finally runs', async () => {
      // Simulate the race: turn 1 finishes and runs its finally while a new
      // service has already been registered under the same key (as if a
      // second execute() had raced in and replaced the map entry). The guard
      // at MessageExecutionService.ts:finally must detect the map entry is
      // no longer this turn's service and skip unregisterExternalActionService.
      let resolveStream: (v: any) => void
      const streamGate = new Promise<void>(r => { resolveStream = () => r() })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await streamGate
              controller.close()
            }
          }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })

      const turn1 = service.execute(DEFAULT_PARAMS)

      // Wait for turn 1 to reach the point of registering its service
      for (let i = 0; i < 100 && !actionServiceMap.has('sse:conv_1'); i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      expect(actionServiceMap.has('sse:conv_1')).toBe(true)

      // Swap the map entry to a different service (simulating concurrent execute()
      // registering its own service). The replacement must not be cleaned up by turn 1.
      const replacementCleanup = vi.fn()
      actionServiceMap.set('sse:conv_1', { cleanup: replacementCleanup })

      // Release turn 1's stream so its finally runs
      resolveStream!(undefined)
      const loggerMod = await import('../../../logging/index.js')
      const warnSpy = vi.spyOn(loggerMod.logger, 'warn')

      try {
        await turn1

        expect(replacementCleanup).not.toHaveBeenCalled()
        expect(actionServiceMap.get('sse:conv_1')).toEqual({ cleanup: replacementCleanup })

        // The displaced-turn finally logs sse.execution.concurrent_submit_cleanup
        // when it detects that another turn has taken over the registry slot.
        // This is the only observable signal that the identity-guard branch
        // was taken — without this assertion a regression that dropped the
        // guard would not be caught.
        const raceLog = warnSpy.mock.calls.find(c => c[0] === 'sse.execution.concurrent_submit_cleanup')
        expect(raceLog).toBeDefined()
        expect(raceLog?.[1]).toMatchObject({ conversationId: 'conv_1' })
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('success-path completeConversation rejection', () => {
    it('still emits terminal step_complete + complete events when completeConversation rejects', async () => {
      // Symmetric to the error-path test: a DB failure during the success
      // path's completeConversation must be logged but must NOT prevent
      // the terminal events from reaching the client.
      deps.conversationPersistence.completeConversation.mockRejectedValueOnce(new Error('DB down'))
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await expect(service.execute(DEFAULT_PARAMS)).resolves.toBeUndefined()
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      const persistLog = errorCalls.find(c => c[0] === 'sse.execution.persistence_failed')
      expect(persistLog).toBeDefined()
      expect(persistLog?.[1]).toMatchObject({ error: 'DB down' })

      // Terminal events still published (finishReason !== 'error' since the
      // loop itself succeeded — only persistence failed).
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1', expect.objectContaining({ type: 'step_complete' })
      )
      const complete = (deps.eventChannel.publish as any).mock.calls.find(
        (c: any[]) => c[1]?.type === 'complete'
      )
      expect(complete).toBeDefined()
      expect(complete?.[1]?.data?.finishReason).not.toBe('error')
    })
  })

  describe('parallel assessment outcome flow', () => {
    const lifecycle = {
      gitHookService: {} as any,
      getAssessmentAgent: () => ({}) as any,
      sessionStore: {
        getLastUserMessage: vi.fn(),
        setLastUserMessage: vi.fn(),
        getLastAssessmentTaskType: vi.fn(),
        setLastAssessmentTaskType: vi.fn(),
        clearSession: vi.fn(),
      },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }

    beforeEach(() => {
      mockAwaitOutcome.mockReset()
      mockAwaitOutcome.mockResolvedValue(undefined)
      mockRunMessageEndHooks.mockReset()
      mockRunMessageEndHooks.mockResolvedValue({ commitHash: null, usedFreeGrants: false })
    })

    afterEach(() => {
      // Restore the file-level defaults so later describes don't inherit a
      // mock that returns undefined (which would make `.catch(...)` on the
      // awaited promise throw).
      mockAwaitOutcome.mockReset()
      mockAwaitOutcome.mockResolvedValue(undefined)
      mockRunMessageEndHooks.mockReset()
      mockRunMessageEndHooks.mockResolvedValue({ commitHash: null, usedFreeGrants: false })
    })

    it('forwards the awaited outcome to runMessageEndHooks on the success path', async () => {
      const outcome = { result: { taskType: 'publish', confidence: 0.9 }, overrideApplied: true } as any
      mockAwaitOutcome.mockResolvedValueOnce(outcome)

      const svc = new MessageExecutionService({ ...createMockDeps(), lifecycle } as any)
      await svc.execute(DEFAULT_PARAMS)

      const completeCall = mockRunMessageEndHooks.mock.calls.find(
        (c: any[]) => c[1]?.reason === 'complete'
      )
      expect(completeCall).toBeDefined()
      expect(completeCall?.[1]?.assessmentOutcome).toBe(outcome)
    })

    it('skips the error-path awaitOutcome when the success-path await already populated the outcome', async () => {
      // Scenario: success-path awaitOutcome resolves with an outcome, then a
      // post-turn step throws into the outer catch. The error-path guard must
      // NOT re-call awaitOutcome, and the end-hooks call on the error path
      // must still receive the already-resolved outcome.
      const outcome = { result: { taskType: 'fix', confidence: 0.8 } } as any
      mockAwaitOutcome.mockResolvedValueOnce(outcome)

      // First runMessageEndHooks call is the success-path attempt — make it
      // throw so control jumps to the outer catch with assessmentOutcome already set.
      mockRunMessageEndHooks
        .mockRejectedValueOnce(new Error('end hook boom'))
        .mockResolvedValue({ commitHash: null, usedFreeGrants: false })

      const svc = new MessageExecutionService({ ...createMockDeps(), lifecycle } as any)
      await svc.execute(DEFAULT_PARAMS)

      // Exactly one awaitOutcome call (success-path); error-path guard short-circuited.
      expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)

      // Error-path end-hooks got the already-resolved outcome.
      const errorCall = mockRunMessageEndHooks.mock.calls.find(
        (c: any[]) => c[1]?.reason === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall?.[1]?.assessmentOutcome).toBe(outcome)
    })

    it('falls back to the error-path awaitOutcome when stream throws before the success-path await', async () => {
      // Scenario: streamGenerate throws before the success-path awaitOutcome
      // ever runs. The error-path guard sees assessmentOutcome === undefined
      // and awaits the handle with the shorter error-path timeout.
      const outcome = { result: { taskType: 'publish', confidence: 0.9 } } as any
      mockAwaitOutcome.mockResolvedValueOnce(outcome)

      const d = createMockDeps() as any
      d.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async () => {
          throw new Error('stream boom')
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      const svc = new MessageExecutionService({ ...d, lifecycle } as any)
      await svc.execute(DEFAULT_PARAMS)

      expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)
      const errorCall = mockRunMessageEndHooks.mock.calls.find(
        (c: any[]) => c[1]?.reason === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall?.[1]?.assessmentOutcome).toBe(outcome)
    })
  })

  describe('lifecycle deps', () => {
    it('propagates commitHash and usedFreeGrants to complete event', async () => {
      mockRunMessageEndHooks.mockResolvedValueOnce({ commitHash: 'deadbeef', usedFreeGrants: true })
      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession: vi.fn(),
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      const depsWithLifecycle = { ...createMockDeps(), lifecycle }
      const serviceWithLifecycle = new MessageExecutionService(depsWithLifecycle as any)

      await serviceWithLifecycle.execute(DEFAULT_PARAMS)

      expect(depsWithLifecycle.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ commitHash: 'deadbeef', usedFreeGrants: true }),
        }),
      )
    })
  })

  describe('concurrent-submit session-store guard', () => {
    // Regression: the finally block used to call
    //   sessionStore.clearSession(sseSocketId)
    // unconditionally, which meant Turn A erased Turn B's seed data
    // (lastUserMessage/lastAssessmentTaskType) whenever Turn A's finally ran
    // after Turn B had already registered its own service. Now that
    // clearSession is inside the identity-check branch, the replacement
    // turn's session state must be preserved.
    it('does not call clearSession when a replacement service has taken over', async () => {
      let resolveStream: (v: any) => void
      const streamGate = new Promise<void>(r => { resolveStream = () => r() })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await streamGate
              controller.close()
            }
          }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })

      const clearSession = vi.fn()
      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession,
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      service = new MessageExecutionService({ ...deps, lifecycle } as any)

      const turn1 = service.execute(DEFAULT_PARAMS)

      for (let i = 0; i < 100 && !actionServiceMap.has('sse:conv_1'); i++) {
        await new Promise(r => setTimeout(r, 5))
      }

      // Replacement turn wins the map slot.
      const replacementCleanup = vi.fn()
      actionServiceMap.set('sse:conv_1', { cleanup: replacementCleanup })

      resolveStream!(undefined)
      await turn1

      expect(clearSession).not.toHaveBeenCalled()
      expect(replacementCleanup).not.toHaveBeenCalled()
    })

    it('calls clearSession exactly once when the turn owns the registry slot', async () => {
      const clearSession = vi.fn()
      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession,
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      service = new MessageExecutionService({ ...deps, lifecycle } as any)

      await service.execute(DEFAULT_PARAMS)

      expect(clearSession).toHaveBeenCalledTimes(1)
      expect(clearSession).toHaveBeenCalledWith('sse:conv_1')
    })
  })

  describe('abort reason propagation', () => {
    it("invokes runMessageEndHooks with reason: 'disconnection' when aborted", async () => {
      mockRunMessageEndHooks.mockClear()
      let resolveStream: (v: any) => void
      const streamGate = new Promise<void>(r => { resolveStream = () => r() })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async (_content: string, opts: any) => ({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              // Make the stream error once we're aborted so the catch branch fires.
              await streamGate
              if (opts?.abortSignal?.aborted) {
                controller.error(new Error('AbortError'))
              } else {
                controller.close()
              }
            }
          }),
        })),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })

      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession: vi.fn(),
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      service = new MessageExecutionService({ ...deps, lifecycle } as any)

      const execPromise = service.execute(DEFAULT_PARAMS)
      // Wait until execute() has reached streamGenerate — i.e. the stream loop
      // is active and stop() will actually abort mid-stream. The previous
      // implementation polled for runMessageEndHooks.mock.calls.length === 0
      // and broke immediately, so the wait was a no-op and the test passed
      // on timing luck.
      const streamGenerate = deps.getAgent().streamGenerate as any
      for (let i = 0; i < 100; i++) {
        if (streamGenerate.mock.calls.length > 0) break
        await new Promise(r => setTimeout(r, 5))
      }
      expect(streamGenerate.mock.calls.length).toBeGreaterThan(0)

      service.stop('conv_1')
      resolveStream!(undefined)
      await execPromise

      const disconnectCall = mockRunMessageEndHooks.mock.calls.find(
        c => c[1]?.reason === 'disconnection'
      )
      expect(disconnectCall).toBeDefined()

      // Also assert the terminal complete event carries finishReason:
      // 'user_stopped'. stop() vacates the activeStreams slot and publishes
      // the user_stopped complete immediately; execute()'s later aborted
      // publish is skipped by the superseded-slot guard. A regression that
      // dropped the publish (or set the wrong finishReason) would slip past
      // the disconnect-reason assertion alone.
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'user_stopped' }),
        })
      )
    })
  })

  describe('stop', () => {
    it('aborts an in-flight execution', async () => {
      let resolveRead: (v: any) => void
      const readPromise = new Promise(r => { resolveRead = r })

      const slowStream = new ReadableStream({
        async pull(controller) {
          await readPromise
          controller.close()
        }
      })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: slowStream
        })
      })
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute(DEFAULT_PARAMS)

      // Abort before the stream resolves - keyed by conversationId
      service.stop('conv_1')
      resolveRead!({ done: true, value: undefined })

      await execPromise

      // After stop, controller is removed
      service.stop('conv_1') // Should not throw for missing key
    })

    it('is a no-op when called for an unknown conversation', () => {
      service = new MessageExecutionService(deps as any)
      expect(() => service.stop('never-started')).not.toThrow()
    })
  })

  // These pin the Langfuse invocation-span lifecycle that streamAgentTurn now
  // owns. A future refactor that drops an invocation.end() on any exit path
  // (success, abort, getFinalResult failure, stream error) would leave the
  // Langfuse span permanently open; without these assertions, the test suite
  // would stay green while observability silently regressed.
  describe('Langfuse invocation span lifecycle', () => {
    it('ends the invocation span with success:true on a clean stream', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'hi' }]),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(mockCreateAgentInvocationSpan).toHaveBeenCalledTimes(1)
      expect(mockInvocationEnd).toHaveBeenCalledTimes(1)
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, finishReason: 'complete' }),
      )

      // Pin the x-trace-id wiring: streamAgentTurn must extract the
      // invocation-span traceId and inject it into executionContext.metadata
      // so unified-provider sets x-trace-id on outgoing GoCode requests.
      // Without the mock SpanContext set up at the top of this file, this
      // branch would never fire and the assertion would silently pass if
      // reworded — keep it keyed to MOCK_TRACE_ID.
      const streamCall = (deps.getAgent().streamGenerate as any).mock.calls[0]
      expect(streamCall[1].executionContext.metadata.traceId).toBe(MOCK_TRACE_ID)
    })

    it('ends the invocation span with success:false, finishReason:aborted when the client aborts', async () => {
      let resolveStream: () => void
      const streamGate = new Promise<void>(r => { resolveStream = r })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async (_content: string, opts: any) => ({
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await streamGate
              // Client aborted -> close cleanly so the happy path falls through
              // to the `abortSignal.aborted` branch and ends the span as aborted.
              if (opts?.abortSignal?.aborted) controller.close()
              else controller.close()
            },
          }),
        })),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute(DEFAULT_PARAMS)
      const sg = deps.getAgent().streamGenerate as any
      for (let i = 0; i < 100; i++) {
        if (sg.mock.calls.length > 0) break
        await new Promise(r => setTimeout(r, 5))
      }
      service.stop('conv_1')
      resolveStream!()
      await execPromise

      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'aborted' }),
      )
    })

    it('ends the invocation span with success:false, finishReason:result_fetch_failed when getFinalResult throws', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'partial' }]),
          getFinalResult: vi.fn().mockRejectedValue(new Error('result fetch boom')),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'result_fetch_failed' }),
      )
    })

    it('ends the invocation span with error:<err>, success:false when streamGenerate throws', async () => {
      const boom = new Error('streamGenerate boom')
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(boom),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: boom }),
      )
    })
  })

  describe('BMS metadata propagation', () => {
    it('includes budgetServiceEnabled, bmsBudgetId, and budgetSessionId in executionContext.metadata', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      const streamCall = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
      expect(streamCall).toHaveBeenCalled()

      const callArgs = streamCall.mock.calls[0]
      const execContext = callArgs[1]?.executionContext
      expect(execContext?.metadata).toEqual(expect.objectContaining({
        bmsBudgetId: 'budget-abc',
        budgetServiceEnabled: true,
        budgetSessionId: 'session-xyz',
      }))
    })

    it('includes subscriptionId in executionContext.metadata when provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
        subscriptionId: 'sub-123',
      })

      const streamCall = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
      const execContext = streamCall.mock.calls[0][1]?.executionContext
      expect(execContext?.metadata).toEqual(expect.objectContaining({
        subscriptionId: 'sub-123',
      }))
    })
  })

  describe('budget_status event', () => {
    it('does not publish budget_status for fast reconciliation (timer cleared)', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      // getBudgetServiceClient returns null → budget block completes instantly,
      // timer is cleared before 10s fires
      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      const publishCalls = (deps.eventChannel.publish as ReturnType<typeof vi.fn>).mock.calls
      const budgetStatusCall = publishCalls.find(
        ([, event]: [string, any]) => event.type === 'budget_status'
      )
      expect(budgetStatusCall).toBeUndefined()
    })

    it('creates a 10s delayed timer for budget_status (matching WS gating)', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      // Verify setTimeout was called with 10_000ms for budget reconciliation
      const budgetTimerCall = setTimeoutSpy.mock.calls.find(
        ([, delay]) => delay === 10_000
      )
      expect(budgetTimerCall).toBeDefined()

      setTimeoutSpy.mockRestore()
    })
  })

  describe('grant budget recovery wiring', () => {
    it('registers grant session and wraps stream with recovery when grants-mode active', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(() => {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(() => {})

      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-grant-1',
        // No bmsBudgetId or budgetSessionId → grants mode
      })

      expect(grantSessionManager.registerSession).toHaveBeenCalledWith(
        expect.stringContaining('sse:'),
        'sub-grant-1',
      )
      expect(grantSessionManager.removeSession).toHaveBeenCalledWith(
        expect.stringContaining('sse:'),
      )
    })

    it('skips grant registration when BMS session is active', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(() => {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(() => {})

      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-bms-1',
        bmsBudgetId: 'bms-budget-id',
        budgetSessionId: 'bms-session-id',
      })

      expect(grantSessionManager.registerSession).not.toHaveBeenCalled()
      expect(grantSessionManager.removeSession).not.toHaveBeenCalled()
    })

    it('cleans up grant session even when execution throws', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(() => {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(() => {})

      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('stream exploded')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-grant-2',
      })

      expect(grantSessionManager.removeSession).toHaveBeenCalledWith(
        expect.stringContaining('sse:'),
      )
    })
  })

  describe('postStreamValidator + stopAfterTools', () => {
    it('skips validation when last tool call is a stop-after tool', async () => {
      const postStreamValidator = vi.fn().mockResolvedValue(undefined)
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid-ask', toolName: 'askQuestion' },
        { type: 'tool-call', id: 'tid-ask', toolName: 'askQuestion', args: JSON.stringify({ question: 'What theme?' }) },
      ])
      deps.getAgent.mockReturnValue({
        streamGenerate: deps.getAgent().streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ stopAfterTools: ['askQuestion'] }),
      })
      ;(deps as any).postStreamValidator = postStreamValidator
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(postStreamValidator).not.toHaveBeenCalled()
    })

    it('runs validation when last tool call is NOT a stop-after tool', async () => {
      const postStreamValidator = vi.fn().mockResolvedValue(undefined)
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid-edit', toolName: 'editFile' },
        { type: 'tool-call', id: 'tid-edit', toolName: 'editFile', args: JSON.stringify({ path: 'index.ts' }) },
      ])
      deps.getAgent.mockReturnValue({
        streamGenerate: deps.getAgent().streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ stopAfterTools: ['askQuestion'] }),
      })
      ;(deps as any).postStreamValidator = postStreamValidator
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(postStreamValidator).toHaveBeenCalled()
    })
  })
})
