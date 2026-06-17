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
  return { ...actual, createAgentContext: vi.fn(function () { return otel.context.active(); }) }
})

vi.mock('../../agent-runtime.js', () => ({
  registerActionService: vi.fn(),
  cleanupActionService: vi.fn(),
  getActionService: vi.fn(function () { return null; }),
}))

vi.mock('../../message-lifecycle.js', () => ({
  runStartGitHook: vi.fn().mockResolvedValue(undefined),
  startParallelAssessment: vi.fn(function () { return { awaitOutcome: vi.fn().mockResolvedValue(undefined) }; }),
  runMessageEndHooks: vi.fn().mockResolvedValue({ commitHash: null, usedFreeGrants: false }),
}))

vi.mock('../../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: vi.fn(function () { return null; }),
}))

vi.mock('../../context-builders.js', () => ({
  buildDynamicDataMessage: vi.fn().mockReturnValue({ role: 'user', content: '', insertionOrder: 'after_history' }),
  buildTodoContextMessage: vi.fn().mockResolvedValue(null),
  buildRagContextMessage: vi.fn().mockResolvedValue(null),
  collectImagesFromFormattedContexts: vi.fn().mockReturnValue([]),
  dataUrlsToProcessedFiles: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../agents/sub-agent-job-registry.js', () => ({
  subAgentJobRegistry: { abort: vi.fn(), register: vi.fn(), unregister: vi.fn() },
}))

import { MessageExecutionService } from '../MessageExecutionService.js'
import { logger } from '../../../logging/index.js'
import { subAgentJobRegistry } from '../../../agents/sub-agent-job-registry.js'

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

function seedActiveStream(service: MessageExecutionService, conversationId: string): AbortController {
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

// AIROBUILD-2623: a disconnected client must NOT abort an in-flight build. Closing
// the tab leaves the stream running to completion; reconnect/replay still work, but
// there is no longer a grace-then-abort deadline. These tests pin that contract.
describe('MessageExecutionService — disconnect does not abort active stream', () => {
  let service: MessageExecutionService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new MessageExecutionService(createMinimalDeps() as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('logs that the stream continues when the last subscriber leaves', () => {
    seedActiveStream(service, CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'sse.execution.subscribers_left_stream_continues',
      { conversationId: CONV_ID }
    )
  })

  it('does not abort the stream after the former no-subscriber window elapses', () => {
    const ac = seedActiveStream(service, CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)

    // Well past the old 120s grace window.
    vi.advanceTimersByTime(600_000)

    expect(ac.signal.aborted).toBe(false)
  })

  it('does not publish a no_subscriber_timeout terminal event', async () => {
    const publishMock = vi.fn().mockResolvedValue(undefined)
    const deps = createMinimalDeps({
      eventChannel: {
        publish: publishMock,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        markMessageEventsPersisted: vi.fn().mockReturnValue(1),
      },
    })
    const svc = new MessageExecutionService(deps as any)
    const internals = svc as any
    internals.activeStreams.set(CONV_ID, { appId: 'app_1', convId: CONV_ID, subscriberIds: new Set() })
    internals.abortControllers.set(CONV_ID, new AbortController())

    svc.onLastSubscriberLeft(CONV_ID)
    await vi.advanceTimersByTimeAsync(600_000)

    expect(publishMock).not.toHaveBeenCalled()
  })

  it('does not tear down sub-agent jobs on disconnect', () => {
    seedActiveStream(service, CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    vi.advanceTimersByTime(600_000)
    expect(vi.mocked(subAgentJobRegistry.abort)).not.toHaveBeenCalled()
  })

  it('onLastSubscriberLeft is a no-op when no active stream exists', () => {
    expect(() => service.onLastSubscriberLeft(CONV_ID)).not.toThrow()
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      'sse.execution.subscribers_left_stream_continues',
      { conversationId: CONV_ID }
    )
  })

  it('onSubscriberAdded is a harmless no-op', () => {
    seedActiveStream(service, CONV_ID)
    expect(() => service.onSubscriberAdded(CONV_ID)).not.toThrow()
  })
})

describe('MessageExecutionService — stop() still aborts explicitly', () => {
  let service: MessageExecutionService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new MessageExecutionService(createMinimalDeps() as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('aborts with user_stopped and tears down sub-agent jobs', () => {
    const ac = seedActiveStream(service, CONV_ID)
    service.stop(CONV_ID)
    expect(ac.signal.aborted).toBe(true)
    expect(ac.signal.reason).toBe('user_stopped')
    expect(vi.mocked(subAgentJobRegistry.abort)).toHaveBeenCalledWith(CONV_ID)
  })

  it('a disconnect that preceded stop() does not change the user_stopped reason', () => {
    const ac = seedActiveStream(service, CONV_ID)
    service.onLastSubscriberLeft(CONV_ID)
    vi.advanceTimersByTime(60_000)
    expect(ac.signal.aborted).toBe(false)

    service.stop(CONV_ID)
    expect(ac.signal.reason).toBe('user_stopped')
  })
})
