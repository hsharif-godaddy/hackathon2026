import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../logging/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    errorFields: (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
  }
})

vi.mock('@godaddy/agent-otel-sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-otel-sdk')
  const otel = await vi.importActual<any>('@opentelemetry/api')
  return { ...actual, createAgentContext: vi.fn(() => otel.context.active()) }
})

vi.mock('../../agent-runtime.js', () => ({
  registerActionService: vi.fn(),
  cleanupActionService: vi.fn(),
  getActionService: vi.fn(() => null),
}))

vi.mock('../../message-lifecycle.js', () => ({
  runStartGitHook: vi.fn().mockResolvedValue(undefined),
  startParallelAssessment: vi.fn(() => ({ awaitOutcome: vi.fn().mockResolvedValue(undefined) })),
  runMessageEndHooks: vi.fn().mockResolvedValue({ commitHash: null, usedFreeGrants: false }),
}))

vi.mock('../../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: vi.fn(() => null),
}))

vi.mock('../../context-builders.js', () => ({
  buildDynamicDataMessage: vi.fn().mockReturnValue({ role: 'user', content: '', insertionOrder: 'after_history' }),
  buildTodoContextMessage: vi.fn().mockResolvedValue(null),
  buildRagContextMessage: vi.fn().mockResolvedValue(null),
  collectImagesFromFormattedContexts: vi.fn().mockReturnValue([]),
  dataUrlsToProcessedFiles: vi.fn().mockReturnValue([]),
}))

import { MessageExecutionService } from '../MessageExecutionService.js'
import { logger } from '../../../logging/index.js'

function createMinimalDeps(overrides: Record<string, unknown> = {}) {
  return {
    getAgent: vi.fn().mockReturnValue({
      streamGenerate: vi.fn().mockResolvedValue({
        textStream: (async function* () {})(),
        baseStream: new ReadableStream({ start(c) { c.close() } }),
      }),
      getName: vi.fn().mockReturnValue('DevelopAgent'),
    }),
    contextManager: {
      loadContextMessages: vi.fn().mockResolvedValue({ contextMessages: [], formattedContexts: [] }),
    },
    loadConversationHistory: vi.fn().mockResolvedValue([]),
    conversationPersistence: {
      continueConversation: vi.fn().mockResolvedValue(undefined),
      startAgentTurn: vi.fn().mockResolvedValue('agent-msg-1'),
      updateAgentTurn: vi.fn().mockResolvedValue(undefined),
      completeConversation: vi.fn().mockResolvedValue(undefined),
      handleConversationError: vi.fn().mockResolvedValue(undefined),
    },
    eventChannel: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue({ sequence: 1 }),
      markMessageEventsPersisted: vi.fn(),
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
    ...overrides,
  }
}

const CONV_ID = 'conv_test_1'

describe('MessageExecutionService — no-subscriber abort timer', () => {
  let service: MessageExecutionService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new MessageExecutionService(createMinimalDeps() as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function seedActiveStream(conversationId: string): AbortController {
    const ac = new AbortController()
    const internals = service as any
    internals.activeStreams.set(conversationId, {
      appId: 'app_1',
      convId: conversationId,
      subscriberIds: new Set(['sub-1']),
    })
    internals.abortControllers.set(conversationId, ac)
    return ac
  }

  it('starts timer on last subscriber leave during active stream', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    expect((service as any).noSubscriberTimers.has(CONV_ID)).toBe(true)
  })

  it('does not start timer when no active stream exists', () => {
    service.onLastSubscriberLeft(CONV_ID)
    expect((service as any).noSubscriberTimers.has(CONV_ID)).toBe(false)
  })

  it('cancels timer on subscriber added', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    expect((service as any).noSubscriberTimers.has(CONV_ID)).toBe(true)

    service.onSubscriberAdded(CONV_ID)
    expect((service as any).noSubscriberTimers.has(CONV_ID)).toBe(false)
  })

  it('fires and aborts with no_subscriber_timeout', () => {
    const ac = seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    vi.advanceTimersByTime(120000)

    expect(ac.signal.aborted).toBe(true)
    expect(ac.signal.reason).toBe('no_subscriber_timeout')
  })

  it('does not abort if timer was cancelled by reconnect', () => {
    const ac = seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    service.onSubscriberAdded(CONV_ID)

    vi.advanceTimersByTime(120000)

    expect(ac.signal.aborted).toBe(false)
  })

  it('cleans up timer map entry after timer fires', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    vi.advanceTimersByTime(120000)

    expect((service as any).noSubscriberTimers.has(CONV_ID)).toBe(false)
  })

  it('replaces existing timer if onLastSubscriberLeft called twice (resets window)', () => {
    const ac = seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    // Advance partway through first timer
    vi.advanceTimersByTime(60000)
    expect(ac.signal.aborted).toBe(false)

    // Second call resets the 120s window
    service.onLastSubscriberLeft(CONV_ID)

    // Advance another 60s — first timer would have fired but second is still running
    vi.advanceTimersByTime(60000)
    expect(ac.signal.aborted).toBe(false)

    // Advance the remaining 60s for the second timer to fire
    vi.advanceTimersByTime(60000)
    expect(ac.signal.aborted).toBe(true)
    expect(ac.signal.reason).toBe('no_subscriber_timeout')
  })

  it('logs sse.execution.no_subscriber_timer_started when timer starts', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('sse.execution.no_subscriber_timer_started', { conversationId: CONV_ID })
  })

  it('logs sse.execution.no_subscriber_abort when timer fires', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    vi.advanceTimersByTime(120000)
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('sse.execution.no_subscriber_abort', {
      conversationId: CONV_ID,
      appId: 'app_1',
      timeoutMs: 120000,
    })
  })

  it('logs sse.execution.no_subscriber_timer_cancelled when subscriber reconnects', () => {
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    service.onSubscriberAdded(CONV_ID)
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('sse.execution.no_subscriber_timer_cancelled', { conversationId: CONV_ID })
  })

  it('publishes complete event with no_subscriber_timeout finishReason when timer fires', async () => {
    const publishMock = vi.fn().mockResolvedValue(undefined)
    const deps = createMinimalDeps({
      eventChannel: {
        publish: publishMock,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        markMessageEventsPersisted: vi.fn().mockReturnValue(1),
      },
    })
    const service = new MessageExecutionService(deps as any)

    const activeStreams = (service as any).activeStreams as Map<string, unknown>
    const abortControllers = (service as any).abortControllers as Map<string, AbortController>
    const controller = new AbortController()
    activeStreams.set('conv_1', { appId: 'app_1', convId: 'conv_1', subscriberIds: new Set() })
    abortControllers.set('conv_1', controller)

    service.onLastSubscriberLeft('conv_1')
    await vi.advanceTimersByTimeAsync(120_000)

    const completeCalls = publishMock.mock.calls.filter(
      ([, ev]) => (ev as { type: string }).type === 'complete'
    )
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0]![1]).toMatchObject({
      type: 'complete',
      conversationId: 'conv_1',
      data: expect.objectContaining({ finishReason: 'no_subscriber_timeout' }),
    })
  })

  it('stop() cancels a pending no-subscriber timer', () => {
    const ac = seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    const timers = (service as any).noSubscriberTimers as Map<string, NodeJS.Timeout>
    expect(timers.has(CONV_ID)).toBe(true)

    service.stop(CONV_ID)

    expect(timers.has(CONV_ID)).toBe(false)

    // Timer should not fire after stop
    vi.advanceTimersByTime(120_000)
    expect(ac.signal.reason).toBe('user_stopped')
  })

  it('does not abort a newer turn when execute() supersedes the armed stream', () => {
    // Arm timer for Turn A
    seedActiveStream(CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    // Simulate Turn B superseding Turn A (new execute() replaces the slot)
    const controllerB = new AbortController()
    const streamStateB = { appId: 'app_1', convId: CONV_ID, subscriberIds: new Set(['sub-2']) }
    const internals = service as any
    internals.activeStreams.set(CONV_ID, streamStateB)
    internals.abortControllers.set(CONV_ID, controllerB)

    // Timer fires — should detect identity mismatch and bail
    vi.advanceTimersByTime(120_000)

    expect(controllerB.signal.aborted).toBe(false)
  })
})
