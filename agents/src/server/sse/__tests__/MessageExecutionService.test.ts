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
const mockSpanContext = {
  traceId: MOCK_TRACE_ID,
  spanId: '0123456789abcdef',
  traceFlags: 1,
  isRemote: false,
}
// A spy-able span: streamAgentTurn reads spanContext().traceId for x-trace-id
// wiring AND calls setAttribute('langfuse.trace.metadata.fullStorySessionId', …)
// so the id lands on the Langfuse trace. wrapSpanContext alone yields a
// non-recording span whose setAttribute is an unobservable no-op, so we hand
// roll a minimal span that satisfies both reads and records setAttribute calls.
const mockSpanSetAttribute = vi.fn()
const mockSpan = {
  spanContext: () => mockSpanContext,
  setAttribute: mockSpanSetAttribute,
} as unknown as Parameters<typeof otelTrace.setSpan>[1]
const mockInvocationContext = otelTrace.setSpan(otelContext.active(), mockSpan)
const mockInvocationEnd = vi.fn()
const mockCreateAgentInvocationSpan = vi.fn(function () { return {
  context: mockInvocationContext,
  end: mockInvocationEnd,
  run: (fn: () => Promise<unknown>) => fn(),
}; })
const mockGetBudgetServiceClient = vi.hoisted(() => vi.fn(function () { return null; }))
const mockEmitConversationStart = vi.hoisted(() => vi.fn())
vi.mock('@godaddy/agent-otel-sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-otel-sdk')
  return {
    ...actual,
    createAgentContext: vi.fn(function () { return otelContext.active(); }),
    createAgentInvocationSpan: (...args: any[]) => mockCreateAgentInvocationSpan(...args),
    emitConversationStart: (...args: any[]) => mockEmitConversationStart(...args),
  }
})

import { MessageExecutionService, pickForcedInstallAgent } from '../MessageExecutionService.js'
import { skillToolManager, resolveSkillToolMetadata } from '../../../tools/skill-tool-manager.js'
import { BudgetServiceConflictError } from '@airo/ai-lib/budget'
import { BudgetExceededError } from '@airo/ai-common'
import { APICallError, RetryError, TypeValidationError } from 'ai'

// Mock agent-runtime action service registry.
// `actionServiceMap` is module-local so tests can assert registry state
// without touching the production actionServices map.
const actionServiceMap = new Map<string, { cleanup: () => void }>()
vi.mock('../../agent-runtime.js', () => ({
  registerActionService: vi.fn(function (key: string, service: any) {
    actionServiceMap.set(key, service)
  }),
  cleanupActionService: vi.fn(function (key: string) {
    const s = actionServiceMap.get(key)
    if (s) { s.cleanup(); actionServiceMap.delete(key) }
  }),
  getActionService: vi.fn(function (key: string) { return actionServiceMap.get(key) ?? null; }),
}))

// Mock message-lifecycle helpers so the lifecycle-deps test can assert
// commitHash / usedFreeGrants propagation without running real git hooks.
const mockRunMessageEndHooks = vi.fn().mockResolvedValue({ commitHash: null, usedFreeGrants: false })
const mockAwaitOutcome = vi.fn().mockResolvedValue(undefined)
const mockStartParallelAssessment = vi.fn(function () { return { awaitOutcome: mockAwaitOutcome }; })
vi.mock('../../message-lifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../message-lifecycle.js')>()
  return {
    runStartGitHook: vi.fn().mockResolvedValue(undefined),
    startParallelAssessment: (...args: any[]) => mockStartParallelAssessment(...args),
    runMessageEndHooks: (...args: any[]) => mockRunMessageEndHooks(...args),
    isOverrideApplicable: actual.isOverrideApplicable,
  }
})

const mockResolveRebuildBuildPagePrompt = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../rebuild-build-page-message.js', () => ({
  resolveRebuildBuildPagePrompt: (...args: any[]) => mockResolveRebuildBuildPagePrompt(...args),
}))

// Spy the forced design-kit install so the gating decision (run once on the
// initial kit turn; never on follow-ups or without a slug) is observable without
// hitting the real catalog/workspace.
const mockEnrichWithForcedDesignKit = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('../../../services/design-system/forced-install.js', () => ({
  enrichWithForcedDesignKit: (...args: any[]) => mockEnrichWithForcedDesignKit(...args),
}))
vi.mock('../../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: mockGetBudgetServiceClient,
}))

// Mock context-builders to avoid heavy dependency chain (AppRepository, KnowB, Langfuse)
vi.mock('../../context-builders.js', () => ({
  buildDynamicDataMessage: vi.fn().mockReturnValue({
    role: 'user', content: '## Dynamic Context\n\nToday is Wednesday', insertionOrder: 'after_history',
  }),
  buildTodoContextMessage: vi.fn().mockResolvedValue(null),
  buildMemoryContextMessage: vi.fn().mockResolvedValue(null),
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
      switchAgent: vi.fn().mockResolvedValue(true),
    },
    onAgentChanged: vi.fn().mockResolvedValue(undefined),
    persistAgentId: vi.fn().mockResolvedValue(undefined),
    // Mirror the production wiring (app.ts): inject the shared resolver so the
    // SSE seam exercises the same skillName-enrichment path as the WS transport.
    resolveToolMetadata: resolveSkillToolMetadata,
  }
}

function createBudgetClient(overrides: Record<string, unknown> = {}) {
  return {
    getSession: vi.fn().mockResolvedValue({
      costTotal: 1.25,
      sessionItems: [{ callRequestId: 'corr-1', cost: 1.25 }],
    }),
    createReport: vi.fn().mockResolvedValue({
      reportId: 'report-1',
      budgetId: 'budget-abc',
      sessionId: 'session-xyz',
      productKey: 'airo-builder',
      budgetCostTotal: 1.25,
      productCostTotal: 0,
      creditsAvailable: 98.75,
      reportItems: [{
        budgetCost: 1.25,
        productCost: 0,
        category: 'airo-builder:general',
        budgetItems: [{ budgetItemId: 'item-1', creditsUsed: 1.25 }],
      }],
    }),
    getBudget: vi.fn().mockResolvedValue({
      budgetId: 'budget-abc',
      productKey: 'airo-builder',
      creditsTotal: '100.000000',
      creditsUsed: '1.250000',
      creditsPending: '0.000000',
      items: [{
        budgetItemId: 'item-1',
        creditsTotal: '100.000000',
        creditsUsed: '1.250000',
        costToCreditRatio: '1.000000',
        startsAt: null,
        expiresAt: null,
        resetInterval: null,
      }],
    }),
    ...overrides,
  }
}

const DEFAULT_PARAMS = {
  appId: 'app_1',
  conversationId: 'conv_1',
  content: 'Hello',
  siteId: 'site_1',
  agentId: 'develop',
}

describe('pickForcedInstallAgent', () => {
  // The real factory's getAgent THROWS "Agent config not found" for unknown ids.
  const makeGetAgent = (known: Record<string, { id: string }>) => (id: string) => {
    if (!(id in known)) throw new Error(`Agent config not found for id: ${id}`)
    return known[id]
  }

  it('finds the -attached sibling for a base design-system variant', () => {
    const getAgent = makeGetAgent({
      'initial-design-system-homepage-build': { id: 'base' },
      'initial-design-system-homepage-build-attached': { id: 'attached' },
    })
    const r = pickForcedInstallAgent({ resolvedAgentId: 'initial-design-system-homepage-build', getAgent })
    expect(r.agent).toEqual({ id: 'attached' })
    expect(r.hasAttachedSibling).toBe(true)
  })

  it('does NOT double-suffix when already resolved to the -attached variant (regression)', () => {
    // The build is frozen on the -attached variant, so every turn resolves it.
    // Looking up `<id>-attached-attached` must not happen — that id has no config
    // and getAgent would throw, which previously killed the forced install.
    const getAgent = makeGetAgent({
      'initial-design-system-homepage-build-attached': { id: 'attached' },
    })
    const r = pickForcedInstallAgent({ resolvedAgentId: 'initial-design-system-homepage-build-attached', getAgent })
    expect(r.agent).toEqual({ id: 'attached' })
    expect(r.hasAttachedSibling).toBe(false)
  })

  it('falls back to the resolved agent (no throw) when no -attached sibling exists', () => {
    const getAgent = makeGetAgent({ 'initial-design-system': { id: 'self' } })
    const r = pickForcedInstallAgent({ resolvedAgentId: 'initial-design-system', getAgent })
    expect(r.agent).toEqual({ id: 'self' })
    expect(r.hasAttachedSibling).toBe(false)
  })
})

describe('MessageExecutionService', () => {
  let service: MessageExecutionService
  let deps: ReturnType<typeof createMockDeps>

  beforeEach(() => {
    actionServiceMap.clear()
    mockGetBudgetServiceClient.mockReturnValue(null)
    mockInvocationEnd.mockReset()
    mockCreateAgentInvocationSpan.mockClear()
    mockSpanSetAttribute.mockClear()
    mockEmitConversationStart.mockClear()
    deps = createMockDeps()
    service = new MessageExecutionService(deps as any)
  })

  it('registers SSE subscribers on the event channel', async () => {
    const mockSub = { id: 'sse-1', onEvent: vi.fn(), onError: vi.fn() }
    deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])

    await service.execute(DEFAULT_PARAMS)

    expect(deps.eventChannel.subscribe).toHaveBeenCalledWith('conv_1', mockSub)
  })

  describe('conversation-start observability event', () => {
    it('emits conversation-start on the first turn (isInitialPrompt)', async () => {
      await service.execute({ ...DEFAULT_PARAMS, lifecycleContext: { isInitialPrompt: true } })

      expect(mockEmitConversationStart).toHaveBeenCalledTimes(1)
      expect(mockEmitConversationStart).toHaveBeenCalledWith({
        conversationId: 'conv_1',
        specialistKey: 'develop',
      })
    })

    it('does not emit conversation-start on follow-up turns', async () => {
      await service.execute({ ...DEFAULT_PARAMS, lifecycleContext: { isInitialPrompt: false } })

      expect(mockEmitConversationStart).not.toHaveBeenCalled()
    })

    it('does not emit conversation-start when lifecycleContext is absent', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(mockEmitConversationStart).not.toHaveBeenCalled()
    })
  })

  // Charles PR #5167 🟡#5: lock the central gating promise (flag-off / non-kit
  // turns are a no-op) and the multi-turn lifecycle (no re-install after the
  // parked interview). The feature is reachable only when a designKitSlug is
  // present, which only the flag-gated gallery produces.
  describe('forced design-kit install gating', () => {
    beforeEach(() => { mockEnrichWithForcedDesignKit.mockClear() })

    it('is a no-op on the initial turn when no designKitSlug is present (flag off / no selection)', async () => {
      await service.execute({ ...DEFAULT_PARAMS, lifecycleContext: { isInitialPrompt: true } })
      expect(mockEnrichWithForcedDesignKit).not.toHaveBeenCalled()
    })

    it('does not re-install on a follow-up turn even with a slug (multi-turn -attached lifecycle)', async () => {
      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'initial-design-system-homepage-build-attached',
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: false },
      })
      expect(mockEnrichWithForcedDesignKit).not.toHaveBeenCalled()
    })

    it('runs the forced install exactly once on the initial kit-attach turn', async () => {
      // The install agent must expose getConfig() for the install to proceed.
      const agentWithConfig = {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({
          id: 'initial-design-system-homepage-build-attached',
          tools: { loadUiKit: {} },
          metadata: {},
        }),
      }
      deps.getAgent.mockReturnValue(agentWithConfig)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'initial-design-system-homepage-build',
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      expect(mockEnrichWithForcedDesignKit).toHaveBeenCalledTimes(1)
      expect(mockEnrichWithForcedDesignKit).toHaveBeenCalledWith(
        expect.objectContaining({ designKitSlug: 'modern-bento', appId: 'app_1', transport: 'sse' }),
      )
    })

    it('recovers to the base variant when frozen to -attached but the install produced nothing', async () => {
      // The route freezes to -attached before the install runs; if the install yields
      // no messages (failure), the turn must fall back to the base variant — which has
      // the select/install tools — instead of building on a missing kit.
      const agentWithConfig = {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ id: 'x', tools: { loadUiKit: {} }, metadata: {} }),
      }
      const known: Record<string, unknown> = {
        'initial-design-system-homepage-build': agentWithConfig,
        'initial-design-system-homepage-build-attached': agentWithConfig,
      }
      deps.getAgent.mockImplementation((id: string) => {
        if (!(id in known)) throw new Error(`Agent config not found for id: ${id}`)
        return known[id]
      })
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([]) // install produced nothing

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'initial-design-system-homepage-build-attached',
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      // The turn ran the BASE variant (only requested on the recovery path), not the
      // frozen -attached one.
      expect(deps.getAgent).toHaveBeenCalledWith('initial-design-system-homepage-build')
      // And the revert is written to BOTH caches the freeze wrote to, or it's shadowed:
      // the persisted store AND the warm session cache (which the agent router reads
      // first). Without the session reset, turn 2+ resurrects the frozen -attached.
      expect(deps.persistAgentId).toHaveBeenCalledWith('conv_1', 'initial-design-system-homepage-build')
      expect(deps.stateManager.switchAgent).toHaveBeenCalledWith(expect.any(String), 'initial-design-system-homepage-build')
    })

    it('does not persist any agent revert on the happy path (install produced messages)', async () => {
      const agentWithConfig = {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ id: 'x', tools: { loadUiKit: {} }, metadata: {} }),
      }
      const known: Record<string, unknown> = {
        'initial-design-system-homepage-build': agentWithConfig,
        'initial-design-system-homepage-build-attached': agentWithConfig,
      }
      deps.getAgent.mockImplementation((id: string) => {
        if (!(id in known)) throw new Error(`Agent config not found for id: ${id}`)
        return known[id]
      })
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([{ role: 'user', content: 'installed' }]) // success

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'initial-design-system-homepage-build-attached',
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      expect(deps.persistAgentId).not.toHaveBeenCalled()
      expect(deps.stateManager.switchAgent).not.toHaveBeenCalled()
    })

    it('multi-turn: a failed install on turn 1 does not resurrect the frozen -attached variant on turn 2', async () => {
      // Models the REAL turn-2 resolution: the agent router (agent-router.ts step 1)
      // reads the warm SESSION cache BEFORE the persisted store and returns it verbatim.
      // So turn 2's agent must be resolved from the session cache, not the store map —
      // otherwise the test can't catch a revert that updates only the store. The route
      // freeze dual-wrote both caches to -attached at create; recovery must reset both.
      const BASE = 'initial-design-system-homepage-build'
      const ATTACHED = 'initial-design-system-homepage-build-attached'
      const store: Record<string, string> = { conv_1: ATTACHED }
      let sessionAgent = ATTACHED // warm session cache — what the router consults FIRST

      const agentWithConfig = {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ id: 'x', tools: { loadUiKit: {} }, metadata: {} }),
      }
      const known: Record<string, unknown> = { [BASE]: agentWithConfig, [ATTACHED]: agentWithConfig }
      deps.getAgent.mockImplementation((id: string) => {
        if (!(id in known)) throw new Error(`Agent config not found for id: ${id}`)
        return known[id]
      })
      deps.persistAgentId.mockImplementation(async (convId: string, id: string) => { store[convId] = id })
      deps.stateManager.switchAgent.mockImplementation(async (_sessionId: string, id: string) => { sessionAgent = id })

      // --- Turn 1: initial build, forced install produces nothing ---
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([])
      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: sessionAgent, // router resolved -attached from the warm session cache
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })
      // Recovery reverted BOTH caches to base — the store AND the session cache.
      expect(store.conv_1).toBe(BASE)
      expect(sessionAgent).toBe(BASE)

      // --- Turn 2: user answers the parked interview (follow-up, not initial) ---
      deps.getAgent.mockClear()
      mockEnrichWithForcedDesignKit.mockClear()
      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: sessionAgent, // router precedence: resolve from the session cache (now BASE)
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: false },
      })

      // Turn 2 runs the base variant and never touches the stranded -attached one,
      // and does not re-attempt the forced install.
      expect(deps.getAgent).toHaveBeenCalledWith(BASE)
      expect(deps.getAgent).not.toHaveBeenCalledWith(ATTACHED)
      expect(mockEnrichWithForcedDesignKit).not.toHaveBeenCalled()
    })
  })

  // AIROBUILD-2665 / A2 — pin the activation seam the leaf tests miss. The runner
  // (post-stream-validation-runner.test.ts) and the validator (post-stream-validator
  // .test.ts) both test that `forcedInstallThisTurn` is honored, but the derivation
  // `forcedInstallThisTurn = forcedKitMessages.length > 0` and its forwarding through
  // runPostStreamValidation into the validator live only here — a regression in this
  // predicate/spread would pass every leaf test. These drive the REAL runner and assert
  // the validator received the flag MES derived.
  describe('forcedInstallThisTurn forwarding to the post-stream validator', () => {
    it('forwards forcedInstallThisTurn=true when the forced install produced messages this turn', async () => {
      const postStreamValidator = vi.fn().mockResolvedValue(undefined)
      const agentWithConfig = {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({ id: 'x', tools: { loadUiKit: {} }, metadata: {} }),
      }
      const known: Record<string, unknown> = {
        'initial-design-system-homepage-build': agentWithConfig,
        'initial-design-system-homepage-build-attached': agentWithConfig,
      }
      deps.getAgent.mockImplementation((id: string) => {
        if (!(id in known)) throw new Error(`Agent config not found for id: ${id}`)
        return known[id]
      })
      ;(deps as any).postStreamValidator = postStreamValidator
      service = new MessageExecutionService(deps as any)
      // install ran this turn (produced a synthesized message). Note this keys on
      // "install produced messages", which is BROADER than the kit-lock marker — an
      // install that succeeds but applies no tokens still grants validator immunity.
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([{ role: 'user', content: 'installed' }])

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'initial-design-system-homepage-build-attached',
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      expect(postStreamValidator).toHaveBeenCalledWith(
        expect.objectContaining({ forcedInstallThisTurn: true }),
      )
    })

    it('forwards forcedInstallThisTurn=false on a normal turn (no forced install)', async () => {
      const postStreamValidator = vi.fn().mockResolvedValue(undefined)
      ;(deps as any).postStreamValidator = postStreamValidator
      service = new MessageExecutionService(deps as any)

      // DEFAULT_PARAMS: agentId 'develop', no designKitSlug → prepareForcedDesignKit
      // early-returns forcedKitMessages: [] → predicate is false.
      await service.execute(DEFAULT_PARAMS)

      expect(postStreamValidator).toHaveBeenCalledWith(
        expect.objectContaining({ forcedInstallThisTurn: false }),
      )
    })
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

    it('prefers SDK-normalized tool input/name for tool_result events', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'legacyTool' },
        { type: 'tool-input-delta', id: 'tid1', toolName: 'legacyTool', delta: '{"foo":"' },
        { type: 'tool-result', id: 'tid1', toolName: 'normalizedTool', input: { foo: 'bar', normalized: true }, output: 'done' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            toolName: 'normalizedTool',
            tool: expect.objectContaining({
              id: 'tid1',
              name: 'normalizedTool',
              input: { foo: 'bar', normalized: true },
            }),
          }),
        })
      )
    })

    it('redacts skill output fields before publishing tool_result', async () => {
      deps = createMockDeps([
        {
          type: 'tool-result',
          id: 'tid1',
          toolName: 'skill',
          input: {},
          output: { instructions: 'secret', dependentInstructions: 'secret2', publicSummary: 'ok' },
        }
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_result',
          data: expect.objectContaining({
            tool: expect.objectContaining({
              output: expect.objectContaining({
                instructions: '[redacted]',
                dependentInstructions: '[redacted]',
                publicSummary: 'ok',
              }),
            }),
          }),
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

    describe('skillName metadata on terminal tool frames', () => {
      let skillNameSpy: ReturnType<typeof vi.spyOn>

      beforeEach(() => {
        // Resolve a single per-skill MCP tool to its parent skill and
        // everything else to undefined — mirrors the real
        // SkillToolManager.getSkillNameForTool reverse lookup. This is the
        // SSE-path mirror of the WS `resolveToolMetadata` hook.
        skillNameSpy = vi
          .spyOn(skillToolManager, 'getSkillNameForTool')
          .mockImplementation((name: string) =>
            name === 'commerce__commerce_store_list' ? 'commerce' : undefined,
          )
      })

      afterEach(() => {
        skillNameSpy.mockRestore()
      })

      it('attaches skillName to tool_result for a per-skill MCP tool', async () => {
        deps = createMockDeps([
          { type: 'tool-result', id: 'tid1', toolName: 'commerce__commerce_store_list', input: {}, output: 'ok' },
        ])
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'tool_result',
            data: expect.objectContaining({
              tool: expect.objectContaining({
                name: 'commerce__commerce_store_list',
                skillName: 'commerce',
              }),
            }),
          })
        )
      })

      it('attaches skillName to tool_error for a per-skill MCP tool', async () => {
        deps = createMockDeps([
          { type: 'tool-error', id: 'tid1', toolName: 'commerce__commerce_store_list', error: new Error('boom') },
        ])
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'tool_result',
            data: expect.objectContaining({
              tool: expect.objectContaining({
                is_error: true,
                error: 'boom',
                skillName: 'commerce',
              }),
            }),
          })
        )
      })

      it('omits skillName for a non-skill tool', async () => {
        deps = createMockDeps([
          { type: 'tool-result', id: 'tid1', toolName: 'editFile', input: {}, output: 'ok' },
        ])
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        const resultCall = deps.eventChannel.publish.mock.calls.find(
          (c: any[]) => c[1]?.type === 'tool_result',
        )
        expect(resultCall).toBeDefined()
        expect(resultCall![1].data.tool).not.toHaveProperty('skillName')
      })

      it('still publishes tool_result when the resolver throws (additive enrichment must not derail the turn)', async () => {
        deps = createMockDeps([
          { type: 'tool-result', id: 'tid1', toolName: 'commerce__commerce_store_list', input: {}, output: 'ok' },
        ])
        // A misbehaving resolver must not abort the terminal frame.
        deps.resolveToolMetadata = () => {
          throw new Error('resolver boom')
        }
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        const resultCall = deps.eventChannel.publish.mock.calls.find(
          (c: any[]) => c[1]?.type === 'tool_result',
        )
        expect(resultCall).toBeDefined()
        expect(resultCall![1].data.tool.name).toBe('commerce__commerce_store_list')
        expect(resultCall![1].data.tool).not.toHaveProperty('skillName')
      })
    })

    it('logs tool.input.parse_failure when parsedInput is a string (invalid JSON)', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tc1', toolName: 'editFile' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{invalid json' },
        { type: 'tool-call', id: 'tc1', toolCallId: 'tc1', toolName: 'editFile' },
      ])
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        const parseFailureLog = errorSpy.mock.calls.find(c => c[0] === 'tool.input.parse_failure')
        expect(parseFailureLog).toBeDefined()
        expect(parseFailureLog?.[1]).toMatchObject({
          toolCallId: 'tc1',
          toolName: 'editFile',
        })
        errorSpy.mockRestore()
      }
    })

    it('adds messageId, source, and agentId metadata to live events', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'hello' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'chunk',
          data: expect.objectContaining({
            source: 'ai_response',
            agentId: 'develop',
            messageId: 'agent-msg-1',
          }),
        })
      )
    })

    it('publishes complete event after stream finishes', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ messageId: 'agent-msg-1' }),
        })
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
        expect.objectContaining({
          type: 'error',
          content: 'stream failure',
          data: expect.objectContaining({ messageId: 'agent-msg-1' }),
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'error', messageId: 'agent-msg-1' }),
        })
      )
    })

    it('publishes non-terminal error event and processes mock stream for resolved tool validation', async () => {
      const streamGenerate = vi.fn()
        .mockResolvedValueOnce({
          isToolValidationError: true,
          validationErrorMessage: 'JSON parsing failed',
          textStream: (async function* () { yield 'corrective feedback text' })(),
          baseStream: null,
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'error', usage: { totalTokens: 0 }, toolCalls: [] }),
        })
      deps.getAgent.mockReturnValue({
        streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(streamGenerate).toHaveBeenCalledTimes(1)
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'error',
          content: 'Tool call failed due to invalid input format. The agent is retrying with corrections.',
          data: expect.objectContaining({
            errorType: 'TOOL_VALIDATION_ERROR',
            statusCode: 400,
          }),
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'chunk',
          content: 'corrective feedback text',
        })
      )
    })

    it('retries with events when streamGenerate throws a tool validation error', async () => {
      const streamGenerate = vi.fn()
        .mockRejectedValueOnce(new Error('toolUse.input is invalid: expected object'))
        .mockResolvedValueOnce({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'retried response' }]),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
        })
      deps.getAgent.mockReturnValue({
        streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      deps.contextManager.loadContextMessages.mockResolvedValue({
        contextMessages: [
          { role: 'system', content: 'System prompt', insertionOrder: 'before_history', cachePoint: { type: 'ephemeral' } },
          { role: 'user', content: 'App context', insertionOrder: 'after_history' },
        ],
        formattedContexts: [],
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(streamGenerate).toHaveBeenCalledTimes(2)
      const retryOpts = streamGenerate.mock.calls[1]![1]
      expect(retryOpts.context).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'System prompt' }),
        expect.objectContaining({ content: 'App context', insertionOrder: 'after_history' }),
      ]))
      expect(retryOpts.messages ?? []).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'App context' }),
      ]))
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'step_start' })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'tool_result',
          content: 'Tool call failed - invalid JSON format',
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'step_complete',
          data: expect.objectContaining({ isFinal: false }),
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'chunk',
          content: 'retried response',
        })
      )
    })

    it('emits budget error when streamGenerate throws a budget-exceeded APICallError', async () => {
      const budgetError = new APICallError({
        message: 'budget limit',
        url: 'https://x',
        requestBodyValues: {},
        statusCode: 401,
        responseBody: 'ExceededBudget: team limit reached',
      })
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(budgetError),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const errorCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall![1]).toMatchObject({
        content: 'Your AI usage budget has been reached.',
        data: expect.objectContaining({
          errorType: 'BUDGET_EXCEEDED',
          statusCode: 401,
        }),
      })
    })

    it('normalizes budget errors thrown during tool validation retry', async () => {
      const budgetError = new APICallError({
        message: 'budget failed',
        url: 'https://x',
        requestBodyValues: {},
        statusCode: 401,
        responseBody: 'LiteLLM exceeded budget',
      })
      const streamGenerate = vi.fn()
        .mockRejectedValueOnce(new Error('JSON parsing failed: unexpected token'))
        .mockRejectedValueOnce(budgetError)
      deps.getAgent.mockReturnValue({
        streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const errorCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall![1]).toMatchObject({
        content: 'Your AI usage budget has been reached.',
        data: expect.objectContaining({
          errorType: 'BUDGET_EXCEEDED',
          statusCode: 401,
        }),
      })
    })

    it('aborts stalled streams on chunk-timeout and emits terminal error + complete', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) {
            return {
              textStream: (async function* () {})(),
              baseStream: new ReadableStream({
                start(controller) {
                  opts.abortSignal.addEventListener('abort', () => {
                    controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                  }, { once: true })
                },
              }),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'error',
            content: expect.stringContaining('Stream chunk timeout'),
          }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'error' }),
          }),
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
      }
    })

    it('soft-commits accumulated content on chunk-timeout (complete:incomplete, no error)', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_m: string, opts: { abortSignal: AbortSignal }) {
            return {
              textStream: (async function* () {})(),
              baseStream: new ReadableStream({
                start(controller) {
                  // Deliver content, then go silent so the guard fires.
                  controller.enqueue({ part: { type: 'text-delta', text: 'partial answer' } })
                  opts.abortSignal.addEventListener('abort', () => {
                    controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                  }, { once: true })
                },
              }),
              // Backed by the dead socket — never resolves; must NOT be awaited.
              getFinalResult: vi.fn().mockImplementation(() => new Promise(() => {})),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'incomplete' }),
          }),
        )
      } finally {
        if (previous === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = previous
      }
    })

    it('soft-commits as stop when a finish frame was seen before the stall', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_m: string, opts: { abortSignal: AbortSignal }) {
            return {
              textStream: (async function* () {})(),
              baseStream: new ReadableStream({
                start(controller) {
                  controller.enqueue({ part: { type: 'text-delta', text: 'full answer' } })
                  controller.enqueue({ part: { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 7, outputTokens: 3 } } })
                  // Frame seen, but socket goes silent — guard fires.
                  opts.abortSignal.addEventListener('abort', () => {
                    controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                  }, { once: true })
                },
              }),
              getFinalResult: vi.fn().mockImplementation(() => new Promise(() => {})),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'stop' }),
          }),
        )
      } finally {
        if (previous === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = previous
      }
    })

    // Premature upstream close (undici `terminated`) — flag-independent: these
    // do NOT set AI_CHUNK_TIMEOUT_MS, so the gap-timer never arms. The soft
    // commit must come from isNetworkError handling in the stream/getFinalResult
    // catches, not the guard.
    const makeTerminatedError = (): Error => {
      const error = new Error('terminated')
      error.name = 'TypeError'
      Object.defineProperty(error, 'cause', {
        value: { code: 'UND_ERR_SOCKET', message: 'other side closed' },
      })
      return error
    }

    // GoCode's ~304s request-timeout HTTP response: a real APICallError-shaped
    // error (isNetworkError:false) carrying statusCode 408. isUpstreamTimeoutError matches it.
    const make408Error = (): Error =>
      Object.assign(new Error('request timeout'), { statusCode: 408, responseBody: 'request timeout' })

    it('soft-commits accumulated content on a 408 upstream timeout (complete:incomplete, getFinalResult skipped)', async () => {
      deps = createMockDeps()
      const getFinalResult = vi.fn().mockImplementation(() => new Promise(() => {}))
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          textStream: (async function* () {
            yield 'partial answer'
            throw make408Error()
          })(),
          getFinalResult,
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      expect(getFinalResult).not.toHaveBeenCalled()
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('fails fast (error terminal) on a 408 upstream timeout with no content', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          // eslint-disable-next-line require-yield
          textStream: (async function* () {
            throw make408Error()
          })(),
          getFinalResult: vi.fn(),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('soft-commits accumulated content on premature close (complete:incomplete, no error, getFinalResult skipped)', async () => {
      deps = createMockDeps()
      const getFinalResult = vi.fn().mockImplementation(() => new Promise(() => {}))
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          // No baseStream → SSE iterates textStream directly. It yields content,
          // then the upstream drops (terminated) — not an abort.
          textStream: (async function* () {
            yield 'partial answer'
            throw makeTerminatedError()
          })(),
          getFinalResult,
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      // Dead socket: getFinalResult would hang — the soft-commit path must skip it.
      expect(getFinalResult).not.toHaveBeenCalled()
      // Honest span: the upstream DID fail, so the invocation ends as an error
      // even though the wire-facing finishReason is the soft 'incomplete'.
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('soft-commits on a premature close via the baseStream reader path (complete:incomplete, honest error span)', async () => {
      deps = createMockDeps()
      const getFinalResult = vi.fn().mockImplementation(() => new Promise(() => {}))
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          textStream: (async function* () {})(),
          // baseStream delivers content, then the reader errors (terminated) —
          // exercises the reader.read() catch → handlePrematureClose path. The
          // chunk must be delivered on a separate pull from the error;
          // controller.error() resets the queue, so enqueue+error in one tick
          // would discard the content (and miss the soft-commit path).
          baseStream: (() => {
            let sentContent = false
            return new ReadableStream({
              pull(controller) {
                if (!sentContent) {
                  sentContent = true
                  controller.enqueue({ part: { type: 'text-delta', text: 'partial answer' } })
                } else {
                  controller.error(makeTerminatedError())
                }
              },
            })
          })(),
          getFinalResult,
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      expect(getFinalResult).not.toHaveBeenCalled()
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('soft-commits when getFinalResult throws a network error after content (complete:incomplete, honest error span)', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          // Stream completes cleanly with content, but getFinalResult hits the
          // upstream close — exercises the getFinalResult catch network-error branch.
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'partial answer' }]),
          getFinalResult: vi.fn().mockRejectedValue(makeTerminatedError()),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      // Honest error span (getFinalResult failed) behind the soft 'incomplete' wire reason.
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('soft-commits when getFinalResult throws a 408 upstream timeout after content (complete:incomplete, honest error span)', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'partial answer' }]),
          getFinalResult: vi.fn().mockRejectedValue(make408Error()),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('fails fast (error terminal) on a premature close with no content', async () => {
      deps = createMockDeps()
      const getFinalResult = vi.fn()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          // Upstream drops before any content arrives.
          // eslint-disable-next-line require-yield
          textStream: (async function* () {
            throw makeTerminatedError()
          })(),
          getFinalResult,
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'incomplete' }),
        }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) }),
      )
    })

    it('does not count streamGenerate connection time against chunk timeout', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(async function () {
            await new Promise(r => setTimeout(r, 20))
            return {
              textStream: (async function* () {})(),
              baseStream: new ReadableStream({
                start(controller) {
                  controller.enqueue({ part: { type: 'text-delta', text: 'connected' } })
                  controller.close()
                },
              }),
              getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'complete' }),
          }),
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
      }
    })

    it('does not keep chunk timeout armed while awaiting getFinalResult', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockResolvedValue({
            textStream: (async function* () {})(),
            baseStream: new ReadableStream({
              start(controller) {
                controller.enqueue({ part: { type: 'text-delta', text: 'done' } })
                controller.close()
              },
            }),
            getFinalResult: vi.fn().mockImplementation(async function () {
              await new Promise(r => setTimeout(r, 20))
              return { finishReason: 'complete' }
            }),
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'complete' }),
          }),
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
      }
    })

    it('resets chunk timeout on non-part baseStream frames', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '25'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockResolvedValue({
            textStream: (async function* () {})(),
            baseStream: new ReadableStream({
              start(controller) {
                setTimeout(() => controller.enqueue({ metadata: { keepalive: true } }), 20)
                setTimeout(() => {
                  controller.enqueue({ part: { type: 'text-delta', text: 'alive' } })
                  controller.close()
                }, 35)
              },
            }),
            getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'chunk', content: 'alive' }),
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
      }
    })

    it('reports chunk-timeout errors from textStream iterator aborts', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) {
            return {
              textStream: {
                [Symbol.asyncIterator]() {
                  return {
                    next: () => new Promise<IteratorResult<string>>((_resolve, reject) => {
                      opts.abortSignal.addEventListener('abort', () => {
                        reject(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                      }, { once: true })
                    }),
                  }
                },
              },
              getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'error',
            content: expect.stringContaining('Stream chunk timeout'),
          }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'error' }),
          }),
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
      }
    })

    it('falls back to textStream when baseStream read() throws a retryable error', async () => {
      deps = createMockDeps()
      let readCount = 0
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {
            yield 'fallback chunk 1'
            yield 'fallback chunk 2'
          })(),
          baseStream: new ReadableStream({
            pull(controller) {
              readCount++
              if (readCount === 1) {
                controller.enqueue({ part: { type: 'text-delta', text: 'base chunk' } })
              } else {
                const err: any = new Error('Service Unavailable')
                err.statusCode = 503
                throw err
              }
            },
          }),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
          response: Promise.resolve({ id: 'resp-1', modelId: 'claude-sonnet-4-6' }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      // Base stream delivered first chunk, then fallback delivered the rest
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'chunk', content: 'base chunk' }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'chunk', content: 'fallback chunk 1' }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'chunk', content: 'fallback chunk 2' }),
      )
      // Should complete successfully, not error
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'complete',
          data: expect.objectContaining({ finishReason: 'complete' }),
        }),
      )
    })

    it('does not fallback on non-retryable baseStream read() errors', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () { yield 'should not appear' })(),
          baseStream: new ReadableStream({
            pull() {
              // 403 Forbidden is always non-retryable
              throw new APICallError({
                message: 'Forbidden',
                statusCode: 403,
                url: 'https://api.example.com',
                requestBodyValues: {},
              })
            },
          }),
          response: Promise.resolve({}),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      // Should produce an error terminal event (non-retryable propagates)
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'error',
          content: 'Forbidden',
        }),
      )
      // Fallback text should NOT appear
      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ content: 'should not appear' }),
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

    it('substitutes agent content with the source-built page prompt while persisting the original (rebuild Build Page)', async () => {
      mockResolveRebuildBuildPagePrompt.mockResolvedValueOnce({
        prompt: 'SOURCE PAGE PROMPT',
        confirmation: {
          pageSlug: 'about',
          pageTitle: 'About',
          sourceUrl: 'https://example.com/about',
          imageCount: 2,
        },
      })
      const streamGenerate = vi.fn().mockResolvedValue({
        textStream: (async function* () { yield 'ok' })(),
        baseStream: null,
        getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'stop', usage: { totalTokens: 0 }, toolCalls: [] }),
      })
      deps.getAgent.mockReturnValue({ streamGenerate, getName: vi.fn().mockReturnValue('AI Developer') })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, content: 'Build the about page', rebuildBuildPageSlug: 'about' })

      // The persisted/displayed user message stays the original friendly text...
      expect(deps.conversationPersistence.continueConversation).toHaveBeenCalledWith(
        'conv_1',
        'Build the about page',
        expect.anything()
      )
      // ...the resolver was consulted with the slug + appId...
      expect(mockResolveRebuildBuildPagePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ appId: 'app_1', rebuildBuildPageSlug: 'about' }),
        })
      )
      // ...and the SUBSTITUTED prompt is what the agent loop actually receives.
      expect(streamGenerate.mock.calls[0][0]).toBe('SOURCE PAGE PROMPT')
    })

    it('feeds the agent the original content when the resolver returns undefined', async () => {
      mockResolveRebuildBuildPagePrompt.mockResolvedValueOnce(undefined)
      const streamGenerate = vi.fn().mockResolvedValue({
        textStream: (async function* () { yield 'ok' })(),
        baseStream: null,
        getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'stop', usage: { totalTokens: 0 }, toolCalls: [] }),
      })
      deps.getAgent.mockReturnValue({ streamGenerate, getName: vi.fn().mockReturnValue('AI Developer') })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, content: 'Build the about page', rebuildBuildPageSlug: 'about' })

      expect(streamGenerate.mock.calls[0][0]).toBe('Build the about page')
    })

    it('does not consult the rebuild resolver when no slug is provided', async () => {
      await service.execute(DEFAULT_PARAMS)
      expect(mockResolveRebuildBuildPagePrompt).not.toHaveBeenCalled()
    })

    it('passes customerId from lifecycle context into persistence metadata', async () => {
      await service.execute({
        ...DEFAULT_PARAMS,
        authType: 'basic',
        lifecycleContext: {
          agentContext: {
            customerId: '11111111-1111-4111-8111-111111111111',
          },
        },
      })

      const continueContext = deps.conversationPersistence.continueConversation.mock.calls[0][2]
      expect(continueContext.metadata).toEqual(expect.objectContaining({
        authType: 'basic',
        customerId: '11111111-1111-4111-8111-111111111111',
      }))

      const startContext = deps.conversationPersistence.startAgentTurn.mock.calls[0][1]
      expect(startContext.metadata).toEqual(expect.objectContaining({
        authType: 'basic',
        customerId: '11111111-1111-4111-8111-111111111111',
      }))
    })

    it('calls startAgentTurn to create in-progress placeholder', async () => {
      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.startAgentTurn).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ socketId: 'sse:conv_1', agentName: 'develop' })
      )
    })

    it('omits contextAttachments from pre-turn persistence when no attachments are present', async () => {
      await service.execute(DEFAULT_PARAMS)

      const continueContext = deps.conversationPersistence.continueConversation.mock.calls[0][2]
      expect(continueContext.contextAttachments).toBeUndefined()

      const startContext = deps.conversationPersistence.startAgentTurn.mock.calls[0][1]
      expect(startContext.contextAttachments).toBeUndefined()
    })

    it('omits ephemeral-only contextAttachments from pre-turn persistence', async () => {
      await service.execute({
        ...DEFAULT_PARAMS,
        selectedAssets: [{ imageUrl: '//img.example.com/a.png' }],
        customContext: {
          referencedFiles: [{ path: 'src/App.tsx', content: '<App />' }],
        },
      })

      const continueContext = deps.conversationPersistence.continueConversation.mock.calls[0][2]
      expect(continueContext.contextAttachments).toBeUndefined()

      const startContext = deps.conversationPersistence.startAgentTurn.mock.calls[0][1]
      expect(startContext.contextAttachments).toBeUndefined()

      const executionContext = deps.getAgent().streamGenerate.mock.calls[0][1].executionContext
      expect(executionContext.contextAttachments.map((attachment: { type: string }) => attachment.type)).toEqual([
        'selected_assets',
        'referenced_files',
      ])
    })

    it('passes only save-worthy context attachments to pre-turn persistence', async () => {
      await service.execute({
        ...DEFAULT_PARAMS,
        aiEditContexts: [{ id: 'ctx-1' }],
        selectedAssets: [{ imageUrl: '//img.example.com/a.png' }],
        customContext: {
          referencedFiles: [{ path: 'src/App.tsx', content: '<App />' }],
          type: 'custom_saved_context',
          data: { source: 'test' },
          persistence: 'save',
        },
      })

      const continueContext = deps.conversationPersistence.continueConversation.mock.calls[0][2]
      expect(continueContext.contextAttachments.map((attachment: { type: string }) => attachment.type)).toEqual([
        'ai_edit_contexts',
        'custom_saved_context',
      ])
      expect(continueContext.contextAttachments).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_edit_contexts',
          data: [{ id: 'ctx-1' }],
          persistence: 'save',
        }),
        expect.objectContaining({
          type: 'custom_saved_context',
          data: { source: 'test' },
          persistence: 'save',
        }),
      ]))

      const startContext = deps.conversationPersistence.startAgentTurn.mock.calls[0][1]
      expect(startContext.contextAttachments).toEqual(continueContext.contextAttachments)

      const executionContext = deps.getAgent().streamGenerate.mock.calls[0][1].executionContext
      expect(executionContext.contextAttachments.map((attachment: { type: string }) => attachment.type)).toEqual(expect.arrayContaining([
        'ai_edit_contexts',
        'selected_assets',
        'referenced_files',
        'custom_saved_context',
      ]))
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
        { finishReason: 'result_fetch_failed' }, // getFinalResult not mocked → throws → only finishReason stored
        expect.objectContaining({ socketId: 'sse:conv_1' })
      )
    })

    it('marks buffered message events persisted after completeConversation succeeds', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'Hello' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.markMessageEventsPersisted).toHaveBeenCalledWith('conv_1', 'agent-msg-1')
    })

    it('debug-logs when completeConversation succeeds but no buffered events are marked persisted', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'Hello' }])
      deps.eventChannel.markMessageEventsPersisted.mockReturnValueOnce(0)
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const debugSpy = vi.spyOn(loggerMod.logger, 'debug')
      let debugCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        debugCalls = debugSpy.mock.calls.slice()
        debugSpy.mockRestore()
      }

      const markerLog = debugCalls.find(c => c[0] === 'sse.execution.persisted_marker.no_events_marked')
      expect(markerLog).toBeDefined()
      expect(markerLog?.[1]).toMatchObject({ conversationId: 'conv_1', messageId: 'agent-msg-1' })
    })

    it('does not mark buffered events persisted when completeConversation fails', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'Hello' }])
      deps.conversationPersistence.completeConversation.mockRejectedValueOnce(new Error('DB down'))
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.markMessageEventsPersisted).not.toHaveBeenCalled()
    })

    it('updates the in-progress agent turn after tool_result for recovery history', async () => {
      deps = createMockDeps([
        { type: 'text-delta', text: 'Before tool. ' },
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-result', id: 'tid1', toolName: 'myTool', input: { k: 'v' }, output: 'done' },
        { type: 'text-delta', text: 'After tool.' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.updateAgentTurn).toHaveBeenCalledWith(
        'conv_1',
        'agent-msg-1',
        expect.objectContaining({
          content: 'Before tool. ',
          segments: expect.arrayContaining([
            expect.objectContaining({ type: 'content', content: 'Before tool. ' }),
            expect.objectContaining({
              type: 'tool_call',
              toolCall: expect.objectContaining({
                id: 'tid1',
                name: 'myTool',
                input: { k: 'v' },
                result: 'done',
                status: 'completed',
              }),
            }),
          ]),
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              id: 'tid1',
              name: 'myTool',
              input: { k: 'v' },
              result: 'done',
              status: 'completed',
            }),
          ]),
        }),
        expect.objectContaining({ socketId: 'sse:conv_1' }),
      )
      expect(deps.conversationPersistence.completeConversation.mock.calls[0][1]).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'chunk', content: 'Before tool. ' }),
        expect.objectContaining({ type: 'tool_start' }),
        expect.objectContaining({ type: 'tool_result' }),
        expect.objectContaining({ type: 'chunk', content: 'After tool.' }),
      ]))
    })

    it('updates the in-progress agent turn after tool_error for recovery history', async () => {
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid1', toolName: 'myTool' },
        { type: 'tool-error', id: 'tid1', toolName: 'myTool', input: { k: 'v' }, error: new Error('boom') },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.conversationPersistence.updateAgentTurn).toHaveBeenCalledWith(
        'conv_1',
        'agent-msg-1',
        expect.objectContaining({
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              id: 'tid1',
              name: 'myTool',
              input: { k: 'v' },
              result: {},
              error: 'boom',
              status: 'error',
            }),
          ]),
        }),
        expect.objectContaining({ socketId: 'sse:conv_1' }),
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
      deps.eventChannel.subscribe.mockImplementation(function (_convId: string, sub: any) {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.unsubscribe.mockImplementation(function (_convId: string, id: string) {
        subscribers.delete(id)
      })
      deps.eventChannel.publish.mockImplementation(async function (_convId: string, event: any) {
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
      deps.eventChannel.subscribe.mockImplementation(function (_convId: string, sub: any) {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.publish.mockImplementation(async function (_convId: string, event: any) {
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
      expect(deps.eventChannel.markMessageEventsPersisted).toHaveBeenCalledWith('conv_1', 'agent-msg-1')
    })

    it('logs error-path completeConversation failures with the error persistence log event', async () => {
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
      deps.conversationPersistence.completeConversation.mockRejectedValueOnce(new Error('DB down on error path'))
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

      const persistLog = errorCalls.find(c => c[0] === 'sse.execution.error_persistence_failed')
      expect(persistLog).toBeDefined()
      expect(persistLog?.[1]).toMatchObject({ conversationId: 'conv_1', error: 'DB down on error path' })
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

      expect(deps.loadConversationHistory).toHaveBeenCalledWith('conv_1', 'app_1', 'develop', ['interactiveSubAgent'])
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

    it('drops the trailing history copy of the current message so it is not sent twice', async () => {
      // The user message is persisted before history loads, so it comes back as
      // the last history entry. It is also appended as the prompt by
      // streamGenerate, so without dedup it would appear twice.
      deps.loadConversationHistory.mockResolvedValue([
        { role: 'user', content: 'Earlier turn' },
        { role: 'assistant', content: 'Earlier reply' },
        { role: 'user', content: 'Hello' },
      ])

      await service.execute(DEFAULT_PARAMS)

      const opts = deps.getAgent().streamGenerate.mock.calls[0][1]
      const userHellos = opts.messages.filter(
        (m: { role: string; content: unknown }) => m.role === 'user' && m.content === 'Hello'
      )
      expect(userHellos).toHaveLength(0)
      expect(opts.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: 'Earlier turn' }),
          expect.objectContaining({ content: 'Earlier reply' }),
        ])
      )
    })
  })

  describe('first-turn preflight', () => {
    function agentWithPreflight(execute: ReturnType<typeof vi.fn>) {
      return {
        streamGenerate: deps.getAgent().streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
        getConfig: vi.fn().mockReturnValue({
          metadata: { preflightTools: ['scaffold'] },
          tools: { scaffold: { execute } },
        }),
      }
    }

    it('runs preflight tools when the only history entry is the just-persisted current message', async () => {
      // The current message is persisted (continueConversation) before history
      // loads, so on a genuine first turn it is the sole trailing entry. It must
      // be dropped before computing isFirstTurn or preflight never runs.
      const execute = vi.fn().mockResolvedValue('scaffolded')
      deps.getAgent.mockReturnValue(agentWithPreflight(execute))
      deps.loadConversationHistory.mockResolvedValue([{ role: 'user', content: 'Hello' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(execute).toHaveBeenCalledTimes(1)
    })

    it('does not run preflight on a continuation turn with prior history', async () => {
      const execute = vi.fn().mockResolvedValue('scaffolded')
      deps.getAgent.mockReturnValue(agentWithPreflight(execute))
      deps.loadConversationHistory.mockResolvedValue([
        { role: 'user', content: 'Earlier turn' },
        { role: 'assistant', content: 'Earlier reply' },
        { role: 'user', content: 'Hello' },
      ])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('agent selection', () => {
    it('uses agentId from params directly', async () => {
      await service.execute({ ...DEFAULT_PARAMS, agentId: 'marketing' })

      expect(deps.getAgent).toHaveBeenCalledWith('marketing')
    })
  })

  describe('context message ordering', () => {
    it('routes both before_history and after_history through context (after_history tagged), keeping messages free of volatile content', async () => {
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
      // before_history rides context first, untagged (defaults to before in the pipeline)
      expect(opts.context).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'System prompt' })
      ]))
      expect(opts.context[0]).not.toHaveProperty('insertionOrder')
      // after_history also rides context, tagged so the pipeline places it past the cache breakpoint
      expect(opts.context).toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'App context', insertionOrder: 'after_history' })
      ]))
      // volatile after_history must NOT leak into the cacheable conversation array
      expect(opts.messages ?? []).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ content: 'App context' })
      ]))
    })

    it('builds SSE execution context attachments with WS-equivalent shapes', async () => {
      await service.execute({
        ...DEFAULT_PARAMS,
        aiEditContexts: [{ id: 'ctx-1' }],
        selectedAssets: [{ imageUrl: '//img.example.com/a.png', thumbnailUrl: '//img.example.com/thumb.png' }],
        todoListContext: { todos: [{ title: 'Ship parity' }] },
        isActionRequest: true,
        customContext: {
          referencedFiles: [{ path: 'src/App.tsx', content: '<App />' }],
        },
        buildErrorContext: { error: 'build failed', details: 'stack trace', exitCode: 1 },
        uploadedFileName: 'logo.png',
      })

      const call = deps.getAgent().streamGenerate.mock.calls[0]
      const executionContext = call[1].executionContext
      expect(executionContext.metadata.uploadedFileName).toBe('logo.png')
      expect(executionContext.contextAttachments).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_edit_contexts',
          data: [{ id: 'ctx-1' }],
          persistence: 'save',
          renderStrategy: 'before_prompt',
        }),
        expect.objectContaining({
          type: 'selected_assets',
          data: [expect.objectContaining({
            imageUrl: 'https://img.example.com/a.png',
            thumbnailUrl: 'https://img.example.com/thumb.png',
          })],
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
        }),
        expect.objectContaining({
          type: 'todo_list_context',
          data: { todos: [{ title: 'Ship parity' }] },
          persistence: 'save',
          renderStrategy: 'before_prompt',
        }),
        expect.objectContaining({
          type: 'action_request',
          data: { instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.' },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
        }),
        expect.objectContaining({
          type: 'referenced_files',
          data: [{ path: 'src/App.tsx', content: '<App />' }],
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
        }),
        expect.objectContaining({
          type: 'build_error',
          data: { error: 'build failed', details: 'stack trace', exitCode: 1 },
          persistence: 'ephemeral',
          renderStrategy: 'before_prompt',
        }),
      ]))
    })
  })

  describe('userTimezone metadata', () => {
    it('includes userTimezone in executionContext metadata when provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, userTimezone: 'Europe/Berlin' })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.userTimezone).toBe('Europe/Berlin')
    })

    it('omits userTimezone from metadata when not provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.userTimezone).toBeUndefined()
    })

    it('threads rebuildDesignDirection into executionContext metadata for the rebuild tool', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, rebuildDesignDirection: 'modernize' })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildDesignDirection).toBe('modernize')
    })

    it('omits rebuildDesignDirection from metadata when not provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildDesignDirection).toBeUndefined()
    })

    it('threads rebuildBringOverChoice into executionContext metadata when provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      const bringOverChoice = { direction: 'modernize', keepLogo: false, keepImages: false, keepColors: true, keepFonts: false }
      await service.execute({ ...DEFAULT_PARAMS, rebuildBringOverChoice: bringOverChoice })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildBringOverChoice).toEqual(bringOverChoice)
    })

    it('omits rebuildBringOverChoice from metadata when not provided', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildBringOverChoice).toBeUndefined()
    })

    it('threads rebuildBuildPageSlug and isRebuildFlow into executionContext metadata', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, rebuildBuildPageSlug: 'about' })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildBuildPageSlug).toBe('about')
      expect(executionContext.metadata.isRebuildFlow).toBe(true)
    })

    it('threads _userMessage into executionContext metadata for rebuild prompt inference', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        content: 'rebuild my site, keep a similar look',
      })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata._userMessage).toBe('rebuild my site, keep a similar look')
    })

    it('omits _userMessage from metadata when content is empty', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, content: '' })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata._userMessage).toBeUndefined()
    })
  })

  describe('subscribeStream (late-join)', () => {
    it('delivers subsequent events to a subscriber that joins after execute() has started', async () => {
      // Wire a pubsub through eventChannel so subscribe/publish actually fan out.
      const subscribers = new Map<string, { id: string; onEvent: (e: any) => Promise<void> }>()
      deps.eventChannel.subscribe.mockImplementation(function (_convId: string, sub: any) {
        subscribers.set(sub.id, sub)
      })
      deps.eventChannel.unsubscribe.mockImplementation(function (_convId: string, id: string) {
        subscribers.delete(id)
      })
      deps.eventChannel.publish.mockImplementation(async function (_convId: string, event: any) {
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

      deps.getAgent.mockImplementation(function (name?: string) { return {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }; })
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
        expect.objectContaining({
          type: 'error',
          content: 'SQLITE_BUSY on handoff',
          data: expect.not.objectContaining({ messageId: 'agent-msg-1' }),
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) })
      )
    })

    it('uses the new agent turn messageId after a successful handoff', async () => {
      deps.conversationPersistence.startAgentTurn
        .mockResolvedValueOnce('agent-msg-1')
        .mockResolvedValueOnce('agent-msg-2')

      deps.stateManager.getCurrentAgent.mockReturnValue('marketing')
      deps.stateManager.getLastHandoffPrompt.mockReturnValue('continue on marketing')

      deps.getAgent.mockImplementation(function (name?: string) { return {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([
            { type: 'text-delta', text: `${name ?? 'develop'} chunk` },
          ]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }; })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'chunk',
          content: 'develop chunk',
          agentName: 'develop',
          data: expect.objectContaining({
            agentId: 'develop',
            messageId: 'agent-msg-1',
          }),
        })
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'chunk',
          content: 'marketing chunk',
          agentName: 'marketing',
          data: expect.objectContaining({
            agentId: 'marketing',
            messageId: 'agent-msg-2',
          }),
        })
      )
      expect(deps.eventChannel.markMessageEventsPersisted).toHaveBeenCalledWith('conv_1', 'agent-msg-1')
      expect(deps.eventChannel.markMessageEventsPersisted).toHaveBeenCalledWith('conv_1', 'agent-msg-2')
    })

    it('preserves isRebuildFlow on executionContext metadata across handoff turns', async () => {
      deps.stateManager.getCurrentAgent.mockReturnValue('develop')
      deps.stateManager.getLastHandoffPrompt.mockReturnValue('Build the homepage')

      const streamGenerate = vi.fn().mockImplementation(function (_message: string, opts: { executionContext: { metadata: Record<string, unknown> } }) {
        opts.executionContext.metadata.isRebuildFlow = true
        return Promise.resolve({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([
            { type: 'text-delta', text: 'chunk' },
          ]),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
        })
      })
      deps.getAgent.mockImplementation(function (name?: string) {
        return {
          streamGenerate,
          getName: vi.fn().mockReturnValue(name ?? 'initial'),
        }
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'initial' })

      expect(streamGenerate).toHaveBeenCalledTimes(2)
      const firstMetadata = streamGenerate.mock.calls[0][1].executionContext.metadata
      const secondMetadata = streamGenerate.mock.calls[1][1].executionContext.metadata
      expect(firstMetadata.isRebuildFlow).toBe(true)
      expect(secondMetadata.isRebuildFlow).toBe(true)
      expect(firstMetadata).toBe(secondMetadata)
    })

    it("invokes runMessageEndHooks with reason: 'error' when chunk timeout aborts the stream", async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      mockRunMessageEndHooks.mockReset()
      mockRunMessageEndHooks.mockResolvedValue({ commitHash: null, usedFreeGrants: false })
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) { return {
            textStream: (async function* () {})(),
            baseStream: new ReadableStream({
              start(controller) {
                opts.abortSignal.addEventListener('abort', () => {
                  controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                }, { once: true })
              },
            }),
          }; }),
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

        await service.execute(DEFAULT_PARAMS)

        const errorCall = mockRunMessageEndHooks.mock.calls.find(
          c => c[1]?.reason === 'error'
        )
        expect(errorCall).toBeDefined()
        expect(mockRunMessageEndHooks.mock.calls).not.toContainEqual(
          expect.arrayContaining([
            expect.anything(),
            expect.objectContaining({ reason: 'disconnection' }),
          ])
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'error',
            content: expect.stringContaining('Stream chunk timeout'),
          })
        )
      } finally {
        if (previous === undefined) {
          delete process.env.AI_CHUNK_TIMEOUT_MS
        } else {
          process.env.AI_CHUNK_TIMEOUT_MS = previous
        }
        mockRunMessageEndHooks.mockReset()
        mockRunMessageEndHooks.mockResolvedValue({ commitHash: null, usedFreeGrants: false })
      }
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

  describe('SOCKET_DIAGNOSTICS diagnostic events (AIROBUILD-2681)', () => {
    const ORIGINAL_DIAGNOSTICS = process.env.SOCKET_DIAGNOSTICS

    afterEach(() => {
      if (ORIGINAL_DIAGNOSTICS === undefined) {
        delete process.env.SOCKET_DIAGNOSTICS
      } else {
        process.env.SOCKET_DIAGNOSTICS = ORIGINAL_DIAGNOSTICS
      }
    })

    function createUsageDeps() {
      const d = createMockDeps()
      d.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'hello' }]),
          getFinalResult: vi.fn().mockResolvedValue({
            finishReason: 'complete',
            totalUsage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
          }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      return d
    }

    it('publishes token_usage_summary and stream_timing_summary when the flag is on', async () => {
      process.env.SOCKET_DIAGNOSTICS = 'true'
      deps = createUsageDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'token_usage_summary',
          data: expect.objectContaining({
            inputTokens: 100,
            outputTokens: 40,
            totalTokens: 140,
            modelName: 'unknown',
            totalCost: expect.any(Number),
            inputCost: expect.any(Number),
            outputCost: expect.any(Number),
            savings: expect.any(Number),
            currency: 'USD',
          }),
        }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'stream_timing_summary',
          data: expect.objectContaining({
            timeToStreamStartMs: expect.any(Number),
            chunksRead: expect.any(Number),
            streamDurationMs: expect.any(Number),
            maxChunkGapMs: expect.any(Number),
          }),
        }),
      )
    })

    it('reports timeToStreamStartMs covering pre-stream init time', async () => {
      process.env.SOCKET_DIAGNOSTICS = 'true'
      const d = createMockDeps()
      d.getAgent.mockReturnValue({
        // ~30ms of pre-stream work (agent init + LLM connect) before the stream
        // handle resolves; timeToStreamStartMs must reflect at least that.
        streamGenerate: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return {
            textStream: (async function* () {})(),
            baseStream: makeReadableStream([{ type: 'text-delta', text: 'hi' }]),
            getFinalResult: vi.fn().mockResolvedValue({
              finishReason: 'complete',
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            }),
          }
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      deps = d
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const summary = deps.eventChannel.publish.mock.calls
        .map((c) => c[1] as { type: string; data?: { timeToStreamStartMs?: number } })
        .find((e) => e.type === 'stream_timing_summary')
      expect(summary?.data?.timeToStreamStartMs).toBeGreaterThanOrEqual(20)
    })

    it('publishes neither diagnostic event when the flag is unset', async () => {
      delete process.env.SOCKET_DIAGNOSTICS
      deps = createUsageDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const publishedTypes = deps.eventChannel.publish.mock.calls.map((c) => (c[1] as { type: string }).type)
      expect(publishedTypes).not.toContain('token_usage_summary')
      expect(publishedTypes).not.toContain('stream_timing_summary')
    })

    it('publishes neither diagnostic event when the flag is "false"', async () => {
      process.env.SOCKET_DIAGNOSTICS = 'false'
      deps = createUsageDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const publishedTypes = deps.eventChannel.publish.mock.calls.map((c) => (c[1] as { type: string }).type)
      expect(publishedTypes).not.toContain('token_usage_summary')
      expect(publishedTypes).not.toContain('stream_timing_summary')
    })

    // Stalls the stream so the chunk-timeout guard aborts, driving
    // handleChunkTimeout() → tracker.recordTimeout().
    function createTimeoutDeps() {
      const d = createMockDeps()
      d.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) {
          return {
            textStream: (async function* () {})(),
            baseStream: new ReadableStream({
              start(controller) {
                opts.abortSignal.addEventListener('abort', () => {
                  controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                }, { once: true })
              },
            }),
          }
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      return d
    }

    it('publishes stream_chunk_timeout on a chunk-timeout when the flag is on', async () => {
      const previousTimeout = process.env.AI_CHUNK_TIMEOUT_MS
      process.env.SOCKET_DIAGNOSTICS = 'true'
      process.env.AI_CHUNK_TIMEOUT_MS = '5'
      try {
        deps = createTimeoutDeps()
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'stream_chunk_timeout',
            data: expect.objectContaining({
              error: expect.stringContaining('Stream chunk timeout'),
              chunksRead: expect.any(Number),
              streamElapsedMs: expect.any(Number),
              maxChunkGapMs: expect.any(Number),
            }),
          }),
        )
      } finally {
        if (previousTimeout === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = previousTimeout
      }
    })

    it('does not publish stream_chunk_timeout on a chunk-timeout when the flag is unset', async () => {
      const previousTimeout = process.env.AI_CHUNK_TIMEOUT_MS
      delete process.env.SOCKET_DIAGNOSTICS
      process.env.AI_CHUNK_TIMEOUT_MS = '5'
      try {
        deps = createTimeoutDeps()
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        const publishedTypes = deps.eventChannel.publish.mock.calls.map((c) => (c[1] as { type: string }).type)
        expect(publishedTypes).not.toContain('stream_chunk_timeout')
      } finally {
        if (previousTimeout === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = previousTimeout
      }
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
      deps.eventChannel.publish.mockImplementation(async function (_conv: string, event: any) {
        callCount += 1
        if (event.type === 'chunk' && callCount === 1) throw new Error('subscriber boom')
        return { sequence: callCount }
      })
      deps = { ...deps }
      const localDeps = createMockDeps([
        { type: 'text-delta', text: 'hello ' },
        { type: 'text-delta', text: 'world' },
      ])
      localDeps.eventChannel.publish.mockImplementation(async function (_conv: string, event: any) {
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
      deps.getAgent.mockImplementation(function (name?: string) { return {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }; })
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
      deps.eventChannel.publish.mockImplementation(async function (_convId: string, event: any) {
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
      // no longer this turn's service and skip cleanupActionService.
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
        streamGenerate: vi.fn().mockImplementation(async function () {
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
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: any) { return {
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
        }; }),
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

    it("completes with reason: 'complete' (not aborted) when the last subscriber leaves mid-stream (AIROBUILD-2623)", async () => {
      mockRunMessageEndHooks.mockClear()
      let resolveStream: (v: any) => void
      const streamGate = new Promise<void>(r => { resolveStream = () => r() })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: any) { return {
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await streamGate
              // Mirrors the disconnection test: if a disconnect had aborted the
              // stream this would error. AIROBUILD-2623 removes that abort, so the
              // signal stays clear and the stream closes normally.
              if (opts?.abortSignal?.aborted) {
                controller.error(new Error('AbortError'))
              } else {
                controller.close()
              }
            }
          }),
        }; }),
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
      const streamGenerate = deps.getAgent().streamGenerate as any
      for (let i = 0; i < 100; i++) {
        if (streamGenerate.mock.calls.length > 0) break
        await new Promise(r => setTimeout(r, 5))
      }
      expect(streamGenerate.mock.calls.length).toBeGreaterThan(0)

      // Client closes its tab mid-build: the last subscriber leaves. This must NOT
      // abort the stream — the build runs to completion.
      service.onLastSubscriberLeft('conv_1')
      const abortController = (service as any).abortControllers.get('conv_1') as AbortController
      resolveStream!(undefined)
      await execPromise

      expect(abortController?.signal.aborted).toBe(false)
      // End hook runs as a normal completion, not a disconnection/abort — this is
      // what drives wasUserAborted=false / normal per-call attribution.
      const completeCall = mockRunMessageEndHooks.mock.calls.find(c => c[1]?.reason === 'complete')
      expect(completeCall).toBeDefined()
      const disconnectCall = mockRunMessageEndHooks.mock.calls.find(c => c[1]?.reason === 'disconnection')
      expect(disconnectCall).toBeUndefined()
      // No no_subscriber_timeout terminal event is published.
      const noSubscriberPublish = deps.eventChannel.publish.mock.calls.find(
        ([, ev]: [unknown, any]) => ev?.data?.finishReason === 'no_subscriber_timeout'
      )
      expect(noSubscriberPublish).toBeUndefined()
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
      // Pin the _userMessage wiring (mirrors the WS transport): the context
      // provider + upload classifiers read the current user message off
      // metadata._userMessage to decide placement intent. Without this, SSE
      // uploads classify against an empty prompt → always "unclear".
      expect(streamCall[1].executionContext.metadata._userMessage).toBe('Hello')
    })

    it('sets the FullStory session id as a langfuse.trace.metadata span attribute when provided', async () => {
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'hi' }]),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, fullStorySessionId: 'abc123:456' })

      // The Langfuse span processor maps langfuse.trace.metadata.<key> onto the
      // trace. Setting it on the invocation span (the turn's root observation)
      // is what makes the id queryable in Langfuse — businessContext does NOT
      // reach Langfuse, so this assertion is the real guarantee of the feature.
      expect(mockSpanSetAttribute).toHaveBeenCalledWith(
        'langfuse.trace.metadata.fullStorySessionId',
        'abc123:456',
      )
    })

    it('does not set the FullStory span attribute when the id is absent', async () => {
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

      expect(mockSpanSetAttribute).not.toHaveBeenCalledWith(
        'langfuse.trace.metadata.fullStorySessionId',
        expect.anything(),
      )
    })

    it('ends the invocation span with success:false, finishReason:aborted when the client aborts', async () => {
      let resolveStream: () => void
      const streamGate = new Promise<void>(r => { resolveStream = r })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: any) { return {
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
        }; }),
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

    it('logs getFinalResult.aborted (not .failed) when getFinalResult rejects on an aborted turn', async () => {
      let resolveStream: () => void
      const streamGate = new Promise<void>(r => { resolveStream = r })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: any) { return {
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            async pull(controller) {
              await streamGate
              controller.close()
            },
          }),
          // The dead socket rejects the final-result fetch with the abort error,
          // exactly as user_stopped does in prod (non-network, signal aborted).
          getFinalResult: vi.fn().mockImplementation(async () => {
            throw new Error(String(opts?.abortSignal?.reason ?? 'This operation was aborted'))
          }),
        }; }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const infoSpy = vi.spyOn(loggerMod.logger, 'info')
      const warnSpy = vi.spyOn(loggerMod.logger, 'warn')
      try {
        const execPromise = service.execute(DEFAULT_PARAMS)
        const sg = deps.getAgent().streamGenerate as any
        for (let i = 0; i < 100; i++) {
          if (sg.mock.calls.length > 0) break
          await new Promise(r => setTimeout(r, 5))
        }
        service.stop('conv_1')
        resolveStream!()
        await execPromise

        const abortedLog = infoSpy.mock.calls.find(c => c[0] === 'sse.execution.getFinalResult.aborted')
        expect(abortedLog).toBeDefined()
        expect(abortedLog?.[1]).toMatchObject({ conversationId: 'conv_1', reason: 'user_stopped' })
        expect(warnSpy.mock.calls.some(c => c[0] === 'sse.execution.getFinalResult.failed')).toBe(false)
      } finally {
        infoSpy.mockRestore()
        warnSpy.mockRestore()
      }
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

    it('includes JWT permissions and enrichment flags in executionContext.metadata', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        authType: 'e2s',
        lifecycleContext: {
          agentContext: {
            canDownload: true,
            canPublish: true,
            canPurchaseDomain: false,
            isE2S: true,
            authType: 'e2s',
            useTestBudget: true,
            budgetServiceEnabled: true,
            bmsBudgetId: 'budget-from-jwt',
            useAtlasCrawler: true,
          },
        },
      })

      const streamCall = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
      const execContext = streamCall.mock.calls[0][1]?.executionContext
      expect(execContext?.metadata).toEqual(expect.objectContaining({
        permissions: {
          canDownload: true,
          canPublish: true,
          canPurchaseDomain: false,
        },
        isE2S: true,
        authType: 'e2s',
        useTestBudget: true,
        budgetServiceEnabled: true,
        bmsBudgetId: 'budget-from-jwt',
        useAtlasCrawler: true,
      }))
    })

    it('reports BMS cost with SDK execution steps and publishes budget_update', async () => {
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      const steps = [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }]
      deps = createMockDeps([{ type: 'text-delta', text: 'done' }])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'done' }]),
          getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete', steps }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const infoSpy = vi.spyOn(loggerMod.logger, 'info')
      let infoCalls: any[][] = []
      try {
        await service.execute({
          ...DEFAULT_PARAMS,
          bmsBudgetId: 'budget-abc',
          budgetSessionId: 'session-xyz',
          subscriptionId: 'sub-123',
        })
      } finally {
        infoCalls = infoSpy.mock.calls.slice()
        infoSpy.mockRestore()
      }

      expect(budgetClient.createReport).toHaveBeenCalledWith(
        'session-xyz',
        expect.objectContaining({ allowOverage: true }),
      )
      expect(infoCalls).toContainEqual([
        'budget.report.steps_received',
        expect.objectContaining({ stepCount: 1 }),
      ])
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'budget_update',
          data: expect.objectContaining({ refreshRequired: false }),
        }),
      )
    })

    it('reports BMS cost for user-aborted streams with wasUserAborted attribution', async () => {
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      let resolveStream: (() => void) | undefined
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) { return {
          textStream: (async function* () {})(),
          baseStream: new ReadableStream({
            start(controller) {
              opts.abortSignal.addEventListener('abort', () => {
                controller.close()
              }, { once: true })
              resolveStream = () => controller.close()
            },
          }),
          getFinalResult: vi.fn().mockResolvedValue({
            finishReason: 'aborted',
            steps: [{ stepNumber: 1, content: [] }],
          }),
        }; }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const executing = service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })
      for (let i = 0; i < 50 && !resolveStream; i++) {
        await new Promise(r => setTimeout(r, 5))
      }
      service.stop('conv_1')
      await executing

      const reportArg = budgetClient.createReport.mock.calls[0][1]
      expect(reportArg.reportItems).toEqual([
        expect.objectContaining({
          budgetCost: '1.25',
          productCost: '0',
        }),
      ])
    })

    it('publishes refreshRequired budget_update when BMS report creation conflicts', async () => {
      const budgetClient = createBudgetClient({
        createReport: vi.fn().mockRejectedValue(
          new BudgetServiceConflictError('report exists', 409, 'exists'),
        ),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'budget_update',
          data: expect.objectContaining({ refreshRequired: true }),
        }),
      )
    })

    it('publishes refreshRequired budget_update when BMS reconciliation fails before report creation', async () => {
      const budgetClient = createBudgetClient({
        getSession: vi.fn().mockRejectedValue(new Error('getSession failed')),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      expect(budgetClient.createReport).not.toHaveBeenCalled()
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'budget_update',
          data: expect.objectContaining({ refreshRequired: true }),
        }),
      )
    })

    it('does not publish delayed BMS budget_update after the stream is superseded', async () => {
      let resolveBudget: (value: any) => void
      let resolveBudgetRequested: () => void
      const budgetReady = new Promise<any>(resolve => {
        resolveBudget = resolve
      })
      const budgetRequested = new Promise<void>(resolve => {
        resolveBudgetRequested = resolve
      })
      const budgetClient = createBudgetClient({
        getBudget: vi.fn().mockImplementation(function () {
          resolveBudgetRequested()
          return budgetReady
        }),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      const executing = service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      await budgetRequested
      expect(budgetClient.getBudget).toHaveBeenCalled()

      service.stop('conv_1')
      resolveBudget!({
        budgetId: 'budget-abc',
        productKey: 'airo-builder',
        creditsTotal: '100.000000',
        creditsUsed: '1.250000',
        creditsPending: '0.000000',
        items: [],
      })
      await executing

      const budgetUpdateCalls = (deps.eventChannel.publish as ReturnType<typeof vi.fn>).mock.calls
        .filter(([, event]: [string, any]) => event.type === 'budget_update')
      expect(budgetUpdateCalls).toHaveLength(0)
    })

    it('reports BMS cost on execution errors before publishing terminal error events', async () => {
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('stream exploded')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      expect(budgetClient.createReport).toHaveBeenCalled()
      const publishCalls = (deps.eventChannel.publish as ReturnType<typeof vi.fn>).mock.calls
      const budgetUpdateIndex = publishCalls.findIndex(([, event]: [string, any]) => event.type === 'budget_update')
      const errorIndex = publishCalls.findIndex(([, event]: [string, any]) => event.type === 'error')
      expect(budgetUpdateIndex).toBeGreaterThanOrEqual(0)
      expect(errorIndex).toBeGreaterThan(budgetUpdateIndex)
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
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

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

    it('does not publish stale stream_retry after a newer turn owns the conversation', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'advanceToNextGrant').mockReturnValue(true)
      vi.spyOn(grantSessionManager, 'getCurrentUserId').mockReturnValue('grant-user-2')
      vi.spyOn(grantSessionManager, 'requestGrantRefreshAndWait').mockResolvedValue(false)

      const firstTurnEntered = deferred<void>()
      const secondTurnEntered = deferred<void>()
      const firstTurnResult = deferred<any>()
      const secondTurnResult = deferred<any>()
      let streamGenerateCalls = 0

      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function () {
          streamGenerateCalls += 1
          if (streamGenerateCalls === 1) {
            firstTurnEntered.resolve()
            return firstTurnResult.promise
          }
          if (streamGenerateCalls === 2) {
            secondTurnEntered.resolve()
            return secondTurnResult.promise
          }
          return Promise.resolve({
            textStream: (async function* () {})(),
            baseStream: makeReadableStream([]),
            getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
          })
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const firstExecute = service.execute({ ...DEFAULT_PARAMS, subscriptionId: 'sub-grant-1', requestId: 'req-old' })
      await firstTurnEntered.promise

      const secondExecute = service.execute({
        ...DEFAULT_PARAMS,
        content: 'new prompt',
        subscriptionId: 'sub-grant-1',
        requestId: 'req-new',
      })
      await secondTurnEntered.promise

      firstTurnResult.reject(new BudgetExceededError('grant exhausted', 402))
      await firstExecute

      secondTurnResult.resolve({
        textStream: (async function* () {})(),
        baseStream: makeReadableStream([]),
        getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
      })
      await secondExecute

      const streamRetryCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'stream_retry'
      )
      expect(streamRetryCall).toBeUndefined()
    })

    it('skips grant registration when BMS session is active', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-bms-1',
        bmsBudgetId: 'bms-budget-id',
        budgetSessionId: 'bms-session-id',
        lifecycleContext: {
          agentContext: {
            budgetServiceEnabled: true,
          },
        },
      })

      expect(grantSessionManager.registerSession).not.toHaveBeenCalled()
      expect(grantSessionManager.removeSession).not.toHaveBeenCalled()
    })

    it('skips grant registration when budgetServiceEnabled=true even without budget result', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        subscriptionId: 'sub-bms-no-budget',
        // No bmsBudgetId or budgetSessionId — but JWT says BMS is enabled
        lifecycleContext: {
          agentContext: {
            budgetServiceEnabled: true,
          },
        },
      })

      expect(grantSessionManager.registerSession).not.toHaveBeenCalled()
      expect(grantSessionManager.removeSession).not.toHaveBeenCalled()
    })

    it('cleans up grant session even when execution throws', async () => {
      const { grantSessionManager } = await import('@airo/ai-grants')
      vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
      vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

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

    describe('with lifecycle and assessment override', () => {
      const lifecycleWithAssessment = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn().mockReturnValue(undefined),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn().mockReturnValue(undefined),
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
        mockAwaitOutcome.mockReset()
        mockAwaitOutcome.mockResolvedValue(undefined)
        mockRunMessageEndHooks.mockReset()
        mockRunMessageEndHooks.mockResolvedValue({ commitHash: null, usedFreeGrants: false })
      })

      it('applies override to metadata.subscriptionId and skips registerSession when assessment fires', async () => {
        const { grantSessionManager } = await import('@airo/ai-grants')
        vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
        vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

        const outcome = {
          overrideApplied: true,
          appliedBudget: 'airo-builder:fix-task',
          durationMs: 350,
          result: { taskType: 'fix', confidence: 0.9 },
        } as any
        mockAwaitOutcome.mockResolvedValueOnce(outcome)

        deps = createMockDeps()
        service = new MessageExecutionService({ ...deps, lifecycle: lifecycleWithAssessment } as any)

        await service.execute({
          ...DEFAULT_PARAMS,
          subscriptionId: 'sub-grant-1',
          lifecycleContext: {
            agentContext: {
              enableAssessmentAgent: true,
              enableAssessmentOverride: true,
            },
          },
        })

        // Grant session not registered — override budget used instead of customer grant
        expect(grantSessionManager.registerSession).not.toHaveBeenCalled()

        // metadata.subscriptionId updated to the override value before LLM call
        const streamCall = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
        const execContext = streamCall.mock.calls[0][1]?.executionContext
        expect(execContext?.metadata?.subscriptionId).toBe('airo-builder:fix-task')

        // runMessageEndHooks received the outcome so deriveUsedFreeGrants can fire
        const completeCall = mockRunMessageEndHooks.mock.calls.find(
          (c: any[]) => c[1]?.reason === 'complete'
        )
        expect(completeCall?.[1]?.assessmentOutcome).toBe(outcome)

        // awaitOutcome called exactly once — post-turn guard must skip the second call
        expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)
      })

      it('falls through to registerSession when override does not apply', async () => {
        const { grantSessionManager } = await import('@airo/ai-grants')
        vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
        vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

        const outcome = {
          overrideApplied: false,
          durationMs: 350,
          result: { taskType: 'develop', confidence: 0.7 },
        } as any
        mockAwaitOutcome.mockResolvedValueOnce(outcome)

        deps = createMockDeps()
        service = new MessageExecutionService({ ...deps, lifecycle: lifecycleWithAssessment } as any)

        await service.execute({
          ...DEFAULT_PARAMS,
          subscriptionId: 'sub-grant-1',
          lifecycleContext: {
            agentContext: {
              enableAssessmentAgent: true,
              enableAssessmentOverride: true,
            },
          },
        })

        // Customer grant registered normally — no override
        expect(grantSessionManager.registerSession).toHaveBeenCalledWith(
          expect.stringContaining('sse:'),
          'sub-grant-1',
        )

        // awaitOutcome called exactly once — outcome cached, post-turn guard skips
        expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)
      })

      it('falls through to registerSession and suppresses free_task_completed when assessment times out', async () => {
        const { grantSessionManager } = await import('@airo/ai-grants')
        vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
        vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

        // mockAwaitOutcome returns undefined (timeout) from beforeEach reset

        deps = createMockDeps()
        service = new MessageExecutionService({ ...deps, lifecycle: lifecycleWithAssessment } as any)

        await service.execute({
          ...DEFAULT_PARAMS,
          subscriptionId: 'sub-grant-1',
          lifecycleContext: {
            agentContext: {
              enableAssessmentAgent: true,
              enableAssessmentOverride: true,
            },
          },
        })

        // Grant registered — timeout falls through to customer grant
        expect(grantSessionManager.registerSession).toHaveBeenCalledWith(
          expect.stringContaining('sse:'),
          'sub-grant-1',
        )

        // Sentinel cached — post-turn awaitOutcome is skipped (called once total)
        expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)

        // runMessageEndHooks gets the no-override sentinel — deriveUsedFreeGrants returns false
        const completeCall = mockRunMessageEndHooks.mock.calls.find(
          (c: any[]) => c[1]?.reason === 'complete'
        )
        expect(completeCall?.[1]?.assessmentOutcome?.overrideApplied).toBe(false)
      })

      it('skips early awaitOutcome when budgetServiceEnabled=true (BMS mode)', async () => {
        const { grantSessionManager } = await import('@airo/ai-grants')
        vi.spyOn(grantSessionManager, 'registerSession').mockImplementation(function () {})
        vi.spyOn(grantSessionManager, 'removeSession').mockImplementation(function () {})

        mockAwaitOutcome.mockResolvedValueOnce({
          overrideApplied: true,
          appliedBudget: 'airo-builder:fix-task',
          durationMs: 100,
          result: { taskType: 'fix', confidence: 0.95 },
        } as any)

        deps = createMockDeps()
        service = new MessageExecutionService({ ...deps, lifecycle: lifecycleWithAssessment } as any)

        await service.execute({
          ...DEFAULT_PARAMS,
          subscriptionId: 'sub-bms-1',
          lifecycleContext: {
            agentContext: {
              budgetServiceEnabled: true,
              enableAssessmentAgent: true,
              enableAssessmentOverride: true,
            },
          },
        })

        // BMS: useGrantRecovery is false, so the early awaitOutcome branch is never entered.
        // awaitOutcome fires once on the post-turn path only (not early).
        expect(grantSessionManager.registerSession).not.toHaveBeenCalled()
        expect(mockAwaitOutcome).toHaveBeenCalledTimes(1)

        // The mocked override result must NOT rewrite metadata.subscriptionId —
        // BMS relies on retroactive reconciliation, not pre-turn overrides.
        const streamCall = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
        const execContext = streamCall.mock.calls[0][1]?.executionContext
        expect(execContext?.metadata?.subscriptionId).not.toBe('airo-builder:fix-task')

        // runMessageEndHooks receives budgetServiceEnabled=true so
        // deriveUsedFreeGrants returns false (BMS handles billing via onBudgetReport)
        const completeCall = mockRunMessageEndHooks.mock.calls.find(
          (c: any[]) => c[1]?.reason === 'complete'
        )
        expect(completeCall?.[1]?.budgetServiceEnabled).toBe(true)
      })
    })
  })

  describe('postStreamValidator + stopAfterTools', () => {
    // SSE used to skip the validator unconditionally when the last tool was
    // a stop-after tool, mirroring the (now-removed) WS gate. That meant a
    // turn that edited files and ended with `askQuestion` shipped
    // unvalidated. SSE now always invokes the validator and forwards
    // `stopAfterTools` so the validator can apply the combined gate
    // (skip iff stop-after AND clean tree). Validator-level coverage lives
    // in `agents/src/server/__tests__/post-stream-validator.test.ts`.
    it('invokes the validator and forwards stopAfterTools when last tool is a stop-after tool', async () => {
      const postStreamValidator = vi.fn().mockResolvedValue(undefined)
      deps = createMockDeps([
        { type: 'tool-input-start', id: 'tid-edit', toolName: 'str_replace_based_edit_tool' },
        { type: 'tool-call', id: 'tid-edit', toolName: 'str_replace_based_edit_tool', args: JSON.stringify({ command: 'create', path: 'src/pages/index.tsx' }) },
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

      expect(postStreamValidator).toHaveBeenCalledTimes(1)
      const validatorArgs = postStreamValidator.mock.calls[0]![0] as {
        toolCalls: Array<{ toolName: string }>
        stopAfterTools?: readonly string[]
      }
      expect(validatorArgs.toolCalls.map((tc) => tc.toolName)).toEqual([
        'str_replace_based_edit_tool',
        'askQuestion',
      ])
      expect(validatorArgs.stopAfterTools).toEqual(['askQuestion'])
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

  it('includes sessionId in executionContext metadata', async () => {
    deps = createMockDeps()
    service = new MessageExecutionService(deps as any)

    await service.execute(DEFAULT_PARAMS)

    // contextManager.loadContextMessages receives the full executionContext
    const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
    expect(executionContext.metadata.sessionId).toBe('sse:conv_1')
  })

  describe('requestId propagation', () => {
    it('includes requestId in the complete event data', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_abc1' })

      const completeCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'complete'
      )
      expect(completeCall).toBeDefined()
      expect(completeCall![1].data).toMatchObject({ requestId: 'req_abc1' })
    })

    it('includes requestId in error terminal events', async () => {
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('provider down')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_err1' })

      const errorCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'error'
      )
      expect(errorCall).toBeDefined()
      expect(errorCall![1].data).toMatchObject({ requestId: 'req_err1' })

      const completeCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'complete' && evt.data?.finishReason === 'error'
      )
      expect(completeCall).toBeDefined()
      expect(completeCall![1].data).toMatchObject({ requestId: 'req_err1' })
    })

    it('includes requestId in streaming events before terminal completion', async () => {
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_stream1' })

      const chunkCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'chunk'
      )
      expect(chunkCall).toBeDefined()
      expect(chunkCall![1].data).toMatchObject({ requestId: 'req_stream1' })
    })
  })

  describe('structured terminal error metadata', () => {
    it.each([
      [
        'APP_NOT_FOUND',
        Object.assign(new Error('app gone'), { errorType: 'APP_NOT_FOUND' }),
        { errorType: 'APP_NOT_FOUND', statusCode: 404 },
      ],
      [
        'BUDGET_EXCEEDED',
        new BudgetExceededError('budget exhausted', 402),
        { errorType: 'BUDGET_EXCEEDED', statusCode: 402 },
      ],
      [
        'retryable upstream',
        new APICallError({ message: 'svc unavailable', url: 'https://x', requestBodyValues: {}, statusCode: 503 }),
        { statusCode: 503, _absent: ['errorType', 'retryAttempts', 'retryReason'] },
      ],
      [
        'generic upstream',
        new Error('provider down'),
        { _absent: ['errorType', 'statusCode', 'retryAttempts', 'retryReason'] },
      ],
      [
        'retry error',
        new RetryError({ message: 'retry failed', reason: 'maxRetriesExceeded', errors: [new Error('a'), new Error('b')] }),
        { errorType: 'RETRY_ERROR', statusCode: 500, retryAttempts: 2, retryReason: 'maxRetriesExceeded' },
      ],
    ])('publishes classified fields for %s', async (_case, error, expected) => {
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(error),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, requestId: 'req_err_meta' })

      const errorCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'error'
      )
      expect(errorCall).toBeDefined()
      const { _absent, ...positiveExpected } = expected as Record<string, unknown>
      expect(errorCall![1].data).toMatchObject({
        source: 'ai_response',
        error: error instanceof Error ? error.message : String(error),
        timestamp: expect.any(String),
        requestId: 'req_err_meta',
        ...positiveExpected,
      })
      expect(errorCall![1].data).not.toHaveProperty('stack')
      expect(errorCall![1].data).not.toHaveProperty('cause')
      if (Array.isArray(_absent)) {
        for (const key of _absent) {
          expect(errorCall![1].data).not.toHaveProperty(key)
        }
      }
    })

    it('logs classified statusCode + errorType on the sse.execution.error log (not just the wire event)', async () => {
      // A TypeValidationError (malformed upstream stream chunk) gets a synthetic
      // 502/STREAM_TYPE_VALIDATION from classifyTurnError but no statusCode from
      // analyzeStreamError. The log must carry the classified values, else these
      // errors stay blank-status + errorType-less and invisible in Loki.
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new TypeValidationError({
          value: { error: { message: 'internalServerException', code: '400' } },
          cause: new Error('No matching discriminator'),
        })),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
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

      const log = errorCalls.find(c => c[0] === 'sse.execution.error')
      expect(log).toBeDefined()
      expect(log?.[1]).toMatchObject({ statusCode: 502, errorType: 'STREAM_TYPE_VALIDATION' })
      expect(log?.[1]).toHaveProperty('validationValue')
    })
  })

  describe('APM transaction lifecycle', () => {
    it('labels and ends apmTransaction on successful completion', async () => {
      const mockTransaction = { setLabel: vi.fn(), setOutcome: vi.fn(), end: vi.fn(), result: undefined as string | undefined }
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, apmTransaction: mockTransaction })

      expect(mockTransaction.setLabel).toHaveBeenCalledWith('agent_name', 'develop')
      expect(mockTransaction.setLabel).toHaveBeenCalledWith('finishReason', expect.any(String))
      expect(mockTransaction.result).toBe('success')
      expect(mockTransaction.setOutcome).toHaveBeenCalledWith('success')
      expect(mockTransaction.end).toHaveBeenCalled()
    })

    it('labels and ends apmTransaction on error', async () => {
      const mockTransaction = { setLabel: vi.fn(), setOutcome: vi.fn(), end: vi.fn(), result: undefined as string | undefined }
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('provider down')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, apmTransaction: mockTransaction })

      expect(mockTransaction.setLabel).toHaveBeenCalledWith('finishReason', 'error')
      expect(mockTransaction.setLabel).toHaveBeenCalledWith('error_type', 'Error')
      expect(mockTransaction.result).toBe('error')
      expect(mockTransaction.setOutcome).toHaveBeenCalledWith('failure')
      expect(mockTransaction.end).toHaveBeenCalled()
    })

    it('ends apmTransaction on user stop', async () => {
      const mockTransaction = { setLabel: vi.fn(), setOutcome: vi.fn(), end: vi.fn(), result: undefined as string | undefined }
      let resolveRead: (v: any) => void
      const readPromise = new Promise(r => { resolveRead = r })
      const slowStream = new ReadableStream({
        async pull(controller) {
          await readPromise
          controller.close()
        },
      })
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: slowStream,
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const executePromise = service.execute({ ...DEFAULT_PARAMS, apmTransaction: mockTransaction })
      await new Promise(r => setTimeout(r, 50))
      service.stop('conv_1')
      resolveRead!(undefined)
      await executePromise

      expect(mockTransaction.setLabel).toHaveBeenCalledWith('finishReason', 'user_stopped')
      expect(mockTransaction.result).toBe('aborted')
      expect(mockTransaction.setOutcome).toHaveBeenCalledWith('unknown')
      expect(mockTransaction.end).toHaveBeenCalled()
    })
  })

  describe('shutdown lifecycle', () => {
    it('shutdown with no active streams completes cleanly', async () => {
      deps = createMockDeps([])
      service = new MessageExecutionService(deps as any)

      await service.shutdown()

      expect(deps.eventChannel.publish).not.toHaveBeenCalled()
    })

    it('shutdown does not throw when cleanupActionService throws, and APM still ends', async () => {
      const { cleanupActionService } = await import('../../agent-runtime.js') as { cleanupActionService: ReturnType<typeof vi.fn> }
      const mockTransaction = { setLabel: vi.fn(), setOutcome: vi.fn(), end: vi.fn(), result: undefined as string | undefined }
      const streamStarted = deferred<void>()
      const mockSub = { id: 'sse-sub-1', onEvent: vi.fn(), onError: vi.fn() }
      deps = createMockDeps([])
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) {
          const baseStream = new ReadableStream({
            start(controller) {
              opts.abortSignal.addEventListener('abort', () => controller.error(new Error('AbortError')))
              streamStarted.resolve()
            },
          })
          return Promise.resolve({
            textStream: (async function* () {})(),
            baseStream,
            getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
          })
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute({ ...DEFAULT_PARAMS, conversationId: 'conv_1', apmTransaction: mockTransaction })
      await streamStarted.promise
      service.onLastSubscriberLeft('conv_1')

      // Make cleanupActionService throw during shutdown — this exercises the catch path
      cleanupActionService.mockImplementationOnce(function () { throw new Error('cleanup exploded') })

      // shutdown should not propagate the error
      await expect(service.shutdown()).resolves.toBeUndefined()
      await execPromise

      // APM transaction still ends despite the throw (finally block)
      expect(mockTransaction.end).toHaveBeenCalled()
      expect(mockTransaction.result).toBe('aborted')
    })

    it('aborts active streams and cleans action services, subscribers, timers, and APM state', async () => {
      const mockTransaction = { setLabel: vi.fn(), setOutcome: vi.fn(), end: vi.fn(), result: undefined as string | undefined }
      const streamStarted = deferred<void>()
      let capturedSignal: AbortSignal | undefined
      const mockSub = { id: 'sse-sub-1', onEvent: vi.fn(), onError: vi.fn() }
      deps = createMockDeps([])
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: { abortSignal: AbortSignal }) {
          capturedSignal = opts.abortSignal
          const baseStream = new ReadableStream({
            start(controller) {
              opts.abortSignal.addEventListener('abort', () => controller.error(new Error('AbortError')))
              streamStarted.resolve()
            },
          })
          return Promise.resolve({
            textStream: (async function* () {})(),
            baseStream,
            getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
          })
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const executePromise = service.execute({ ...DEFAULT_PARAMS, apmTransaction: mockTransaction })
      await streamStarted.promise
      service.onLastSubscriberLeft('conv_1')

      await service.shutdown()
      await executePromise

      expect(capturedSignal?.aborted).toBe(true)
      expect(capturedSignal?.reason).toBe('server_shutdown')
      expect(actionServiceMap.has('sse:conv_1')).toBe(false)
      const shutdownCompleteCall = deps.eventChannel.publish.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === 'complete' && evt.data?.finishReason === 'server_shutdown'
      )
      expect(shutdownCompleteCall).toBeDefined()
      expect(deps.eventChannel.unsubscribe).toHaveBeenCalledWith('conv_1', 'sse-sub-1')
      expect(deps.eventChannel.publish.mock.invocationCallOrder.at(-1)).toBeLessThan(
        deps.eventChannel.unsubscribe.mock.invocationCallOrder[0],
      )
      expect(mockTransaction.setLabel).toHaveBeenCalledWith('finishReason', 'server_shutdown')
      expect(mockTransaction.result).toBe('aborted')
      expect(mockTransaction.setOutcome).toHaveBeenCalledWith('unknown')
      expect(mockTransaction.end).toHaveBeenCalledTimes(1)
      expect(service.hasActiveStream('conv_1')).toBe(false)
    })
  })

  describe('budget report fallback retry', () => {
    it('retries in finally when createReport rejects with non-409 then succeeds on second attempt', async () => {
      const budgetClient = createBudgetClient({
        createReport: vi.fn()
          .mockRejectedValueOnce(new Error('transient BMS failure'))
          .mockResolvedValueOnce({
            reportId: 'report-retry',
            budgetId: 'budget-abc',
            sessionId: 'session-xyz',
            productKey: 'airo-builder',
            budgetCostTotal: 1.25,
            productCostTotal: 0,
            creditsAvailable: 98.75,
            reportItems: [{
              budgetCost: 1.25,
              productCost: 0,
              category: 'airo-builder:general',
              budgetItems: [{ budgetItemId: 'item-1', creditsUsed: 1.25 }],
            }],
          }),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      expect(budgetClient.createReport).toHaveBeenCalledTimes(2)
    })

    it('logs fallback_also_failed when both primary and fallback fail', async () => {
      const budgetClient = createBudgetClient({
        getSession: vi.fn().mockRejectedValue(new Error('BMS down')),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await service.execute({
          ...DEFAULT_PARAMS,
          bmsBudgetId: 'budget-abc',
          budgetSessionId: 'session-xyz',
        })
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      const fallbackCall = errorCalls.find(c => c[0] === 'budget.report.fallback_also_failed')
      expect(fallbackCall).toBeDefined()
      expect(fallbackCall?.[1]).toMatchObject({
        appId: 'app_1',
        conversationId: 'conv_1',
        budgetId: 'budget-abc',
        sessionId: 'session-xyz',
      })

      // Terminal completion still reaches client
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete' }),
      )
    })

    it('does not trigger fallback when conflict (409) returns filed: true', async () => {
      const budgetClient = createBudgetClient({
        createReport: vi.fn().mockRejectedValue(
          new BudgetServiceConflictError('report exists', 409, 'exists'),
        ),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorCalls: any[][] = []
      try {
        await service.execute({
          ...DEFAULT_PARAMS,
          bmsBudgetId: 'budget-abc',
          budgetSessionId: 'session-xyz',
        })
      } finally {
        errorCalls = errorSpy.mock.calls.slice()
        errorSpy.mockRestore()
      }

      expect(budgetClient.createReport).toHaveBeenCalledTimes(1)
      const fallbackCall = errorCalls.find(c => c[0] === 'budget.report.fallback_also_failed')
      expect(fallbackCall).toBeUndefined()
    })

    it('does not trigger fallback when createReport succeeds but getBudget fails', async () => {
      const budgetClient = createBudgetClient({
        getBudget: vi.fn().mockRejectedValue(new Error('getBudget failed')),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })

      // createReport succeeded → filed: true → no fallback
      expect(budgetClient.createReport).toHaveBeenCalledTimes(1)
      // Client still gets refreshRequired from the getBudget failure path
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'budget_update',
          data: expect.objectContaining({ refreshRequired: true }),
        }),
      )
    })
  })

  describe('max-handoff guard logging', () => {
    it('logs agent.loop.max_handoffs_reached when loop hits max iterations', async () => {
      // Force 10+ handoffs: stateManager always returns a different agent,
      // causing executeAgentLoop to iterate until MAX_HANDOFFS.
      let callCount = 0
      deps.stateManager.getCurrentAgent.mockImplementation(function () {
        callCount++
        return `agent-${callCount}`
      })
      deps.stateManager.getLastHandoffPrompt.mockReturnValue('continue')
      deps.getAgent.mockImplementation(function (name?: string) { return {
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([]),
        }),
        getName: vi.fn().mockReturnValue(name ?? 'develop'),
      }; })
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const warnSpy = vi.spyOn(loggerMod.logger, 'warn')
      let warnCalls: any[][] = []
      try {
        await service.execute(DEFAULT_PARAMS)
      } finally {
        warnCalls = warnSpy.mock.calls.slice()
        warnSpy.mockRestore()
      }

      const maxHandoffCall = warnCalls.find(c => c[0] === 'agent.loop.max_handoffs_reached')
      expect(maxHandoffCall).toBeDefined()
      expect(maxHandoffCall?.[1]).toMatchObject({
        appId: 'app_1',
        conversationId: 'conv_1',
        iterations: 10,
      })
    })
  })

  describe('deterministic rebuild "Build Page" tool lifecycle', () => {
    // mockResolveRebuildBuildPagePrompt is module-scoped and not reset in the
    // outer beforeEach; restore the default (undefined → no rebuild) after each
    // case so other suites that pass rebuildBuildPageSlug are unaffected.
    afterEach(() => {
      mockResolveRebuildBuildPagePrompt.mockReset()
      mockResolveRebuildBuildPagePrompt.mockResolvedValue(undefined)
    })

    function rebuildToolCalls() {
      return deps.eventChannel.publish.mock.calls.filter(
        (c: any[]) => (c[1] as any)?.data?.tool?.name === 'rebuildBuildPage',
      )
    }

    it('emits tool_start → tool_call → tool_result for a source-backed build', async () => {
      mockResolveRebuildBuildPagePrompt.mockResolvedValue({
        prompt: 'Build the About page from source',
        confirmation: {
          pageSlug: 'about',
          pageTitle: 'About Us',
          sourceUrl: 'https://example.com/about',
          imageCount: 7,
        },
      })
      const streamGenerate = vi.fn().mockResolvedValue({
        textStream: (async function* () {})(),
        baseStream: makeReadableStream([{ type: 'text-delta', text: 'ok' }]),
        getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
      })
      deps.getAgent.mockReturnValue({
        streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, rebuildBuildPageSlug: 'about' })

      const calls = rebuildToolCalls()
      expect(calls.map((c: any[]) => (c[1] as any).type)).toEqual([
        'tool_start',
        'tool_call',
        'tool_result',
      ])
      const resultEvent = calls[calls.length - 1][1] as any
      expect(resultEvent.data.tool.output).toEqual({
        pageSlug: 'about',
        pageTitle: 'About Us',
        sourceUrl: 'https://example.com/about',
        imageCount: 7,
      })

      // The agent loop must run on the source-built prompt, not the raw content.
      expect(streamGenerate).toHaveBeenCalledWith(
        'Build the About page from source',
        expect.anything(),
      )
    })

    it('emits no rebuild lifecycle and uses original content when source is missing', async () => {
      // resolver returns undefined (default) → not source-backed
      const streamGenerate = vi.fn().mockResolvedValue({
        textStream: (async function* () {})(),
        baseStream: makeReadableStream([{ type: 'text-delta', text: 'ok' }]),
        getFinalResult: vi.fn().mockResolvedValue({ finishReason: 'complete' }),
      })
      deps.getAgent.mockReturnValue({
        streamGenerate,
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, rebuildBuildPageSlug: 'about' })

      expect(rebuildToolCalls()).toHaveLength(0)
      // Falls back to the original user content.
      expect(streamGenerate).toHaveBeenCalledWith('Hello', expect.anything())
    })
  })

  describe('graceful shutdown finalization (AIROBUILD-2654)', () => {
    // A stream whose read unblocks only when the turn's AbortSignal fires, then
    // closes cleanly — models a provider that honors abort on SIGTERM, letting
    // execute() reach finalization (persistence + budget report).
    function abortAwareAgent(getFinalResult?: ReturnType<typeof vi.fn>) {
      return {
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: any) {
          return {
            textStream: (async function* () {})(),
            baseStream: new ReadableStream({
              async pull(controller) {
                await new Promise<void>((resolve) => {
                  if (opts?.abortSignal?.aborted) return resolve()
                  opts?.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
                })
                controller.close()
              },
            }),
            ...(getFinalResult && { getFinalResult }),
          }
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      }
    }

    async function waitForStreamGenerate() {
      const streamGenerate = deps.getAgent().streamGenerate as ReturnType<typeof vi.fn>
      for (let i = 0; i < 100; i++) {
        if (streamGenerate.mock.calls.length > 0) break
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(streamGenerate.mock.calls.length).toBeGreaterThan(0)
    }

    it('awaits an in-flight turn so its output persists (and bills) before shutdown resolves', async () => {
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue(
        abortAwareAgent(vi.fn().mockResolvedValue({
          finishReason: 'complete',
          steps: [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }],
        })),
      )
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
      })
      await waitForStreamGenerate()
      // Nothing has finalized yet: the read is parked on the AbortSignal.
      expect(deps.conversationPersistence.completeConversation).not.toHaveBeenCalled()

      await service.shutdown()

      // shutdown() must not resolve until the aborted turn finalized. Persistence
      // is the proxy for "before closeDatabase()"; billing is filed because the
      // turn persisted.
      expect(deps.conversationPersistence.completeConversation).toHaveBeenCalled()
      expect(budgetClient.createReport).toHaveBeenCalled()

      await execPromise
    })

    it('logs finalize_timeout and still resolves when an in-flight turn ignores its abort', async () => {
      vi.useFakeTimers()
      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      try {
        const neverSettles = new Promise<void>(() => {})
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockResolvedValue({
            textStream: (async function* () {})(),
            // Read never resolves and ignores abort → the turn never finalizes.
            baseStream: new ReadableStream({ pull() { return neverSettles } }),
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        // inFlightTurns is populated synchronously by execute(); let the turn
        // progress to the parked read before shutting down.
        void service.execute(DEFAULT_PARAMS)
        await vi.advanceTimersByTimeAsync(20)

        const shutdownPromise = service.shutdown()
        // Drive past the finalize bound (SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS = 5s).
        await vi.advanceTimersByTimeAsync(5_000)
        await shutdownPromise

        expect(errorSpy).toHaveBeenCalledWith(
          'sse.execution.shutdown.finalize_timeout',
          expect.objectContaining({ unfinishedConversationIds: ['conv_1'] }),
        )
      } finally {
        errorSpy.mockRestore()
        vi.useRealTimers()
      }
    })

    it('persists output before abandoning a budget report dropped by the finalize timeout', async () => {
      vi.useFakeTimers()
      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      try {
        // Report filing hangs forever (getSession never resolves) → the turn
        // stays in-flight past the finalize bound. Persistence runs first, so
        // the only work the timeout abandons is the idempotent report.
        const budgetClient = createBudgetClient({ getSession: vi.fn().mockReturnValue(new Promise(() => {})) })
        mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
        deps = createMockDeps([{ type: 'text-delta', text: 'done' }])
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockResolvedValue({
            textStream: (async function* () {})(),
            baseStream: makeReadableStream([{ type: 'text-delta', text: 'done' }]),
            getFinalResult: vi.fn().mockResolvedValue({
              finishReason: 'complete',
              steps: [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }],
            }),
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        void service.execute({
          ...DEFAULT_PARAMS,
          bmsBudgetId: 'budget-abc',
          budgetSessionId: 'session-xyz',
        })
        // Let the turn stream, persist, and reach the hanging budget report.
        await vi.advanceTimersByTimeAsync(20)
        expect(deps.conversationPersistence.completeConversation).toHaveBeenCalled()

        const shutdownPromise = service.shutdown()
        await vi.advanceTimersByTimeAsync(5_000)
        await shutdownPromise

        // Output saved; the report was reached but abandoned (never filed).
        const events = errorSpy.mock.calls.map((c) => c[0] as string)
        expect(events).toContain('sse.execution.shutdown.finalize_timeout')
        expect(budgetClient.createReport).not.toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
        vi.useRealTimers()
      }
    })

    it('does not bill a turn whose output failed to persist', async () => {
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps([{ type: 'text-delta', text: 'done' }])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          baseStream: makeReadableStream([{ type: 'text-delta', text: 'done' }]),
          getFinalResult: vi.fn().mockResolvedValue({
            finishReason: 'complete',
            steps: [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }],
          }),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      deps.conversationPersistence.completeConversation.mockRejectedValue(new Error('DB down'))
      service = new MessageExecutionService(deps as any)

      const loggerMod = await import('../../../logging/index.js')
      const errorSpy = vi.spyOn(loggerMod.logger, 'error')
      let errorEvents: string[] = []
      try {
        await service.execute({
          ...DEFAULT_PARAMS,
          bmsBudgetId: 'budget-abc',
          budgetSessionId: 'session-xyz',
        })
      } finally {
        // Capture before mockRestore() — restoring clears mock.calls.
        errorEvents = errorSpy.mock.calls.map((c) => c[0] as string)
        errorSpy.mockRestore()
      }

      // Persistence failed → the report must not be filed on any path (success,
      // error, or the finally fallback), and the skip is observable.
      expect(budgetClient.createReport).not.toHaveBeenCalled()
      expect(errorEvents).toContain('sse.execution.budget_skipped_persistence_failed')
    })
  })
})
