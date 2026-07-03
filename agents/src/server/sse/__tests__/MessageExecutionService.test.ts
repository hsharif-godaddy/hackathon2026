import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { context as otelContext, trace as otelTrace, SpanStatusCode } from '@opentelemetry/api'

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
// item 3: status-narration reads the wizard phase from KV. Mock getKvMemoryStore so the
// design-kit gathering-pause narration can be driven deterministically. Existing execute()
// tests never reach it — their mock agent has no getConfig, so the agent-id gate returns first.
const mockGetKvMemoryStore = vi.hoisted(() => vi.fn())
vi.mock('../../../memory/adapters/index.js', () => ({ getKvMemoryStore: mockGetKvMemoryStore }))
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
import { FixSessionPhase } from '../../../agents/assessment-agent/index.js'
import { skillToolManager, resolveSkillToolMetadata } from '../../../tools/skill-tool-manager.js'
import { BudgetServiceConflictError } from '@airo/ai-lib/budget'
import { BudgetExceededError } from '@airo/ai-common'
import { APICallError, RetryError, TypeValidationError } from 'ai'

// Mock agent-runtime action service registry.
// `actionServiceMap` is module-local so tests can assert registry state
// without touching the production actionServices map.
const actionServiceMap = new Map<string, { cleanup: () => void }>()
const mockGetAgentFactory = vi.hoisted(() => vi.fn())
vi.mock('../../agent-runtime.js', () => ({
  registerActionService: vi.fn(function (key: string, service: any) {
    actionServiceMap.set(key, service)
  }),
  cleanupActionService: vi.fn(function (key: string) {
    const s = actionServiceMap.get(key)
    if (s) { s.cleanup(); actionServiceMap.delete(key) }
  }),
  getActionService: vi.fn(function (key: string) { return actionServiceMap.get(key) ?? null; }),
  getAgentFactory: mockGetAgentFactory,
}))

// Mock message-lifecycle helpers so the lifecycle-deps test can assert
// commitHash / usedFreeGrants propagation without running real git hooks.
const mockRunMessageEndHooks = vi.fn().mockResolvedValue({ commitHash: null, usedFreeGrants: false })
const mockAwaitOutcome = vi.fn().mockResolvedValue(undefined)
const mockGetTimeoutFallback = vi.fn().mockReturnValue(undefined)
const mockStartParallelAssessment = vi.fn(function () { return { awaitOutcome: mockAwaitOutcome, getTimeoutFallback: mockGetTimeoutFallback }; })
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
const mockCreateForWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../../services/design-system/forced-install.js', () => ({
  enrichWithForcedDesignKit: (...args: any[]) => mockEnrichWithForcedDesignKit(...args),
  isDesignSystemVariant: (agentConfig: { id?: string; metadata?: { preflightTools?: unknown } } | undefined): boolean => {
    const preflightTools = agentConfig?.metadata?.preflightTools
    return (Array.isArray(preflightTools) && preflightTools.includes('listDesignSystems'))
      || !!agentConfig?.id?.startsWith('initial-design-system')
  },
}))
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}))
vi.mock('../../../services/budget-service-instance.js', () => ({
  getBudgetServiceClient: mockGetBudgetServiceClient,
}))

const mockTrackInitialBuildStartedAsync = vi.hoisted(() => vi.fn())
const mockTrackPostInteractionIfEligible = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../services/agent-lifecycle-events/initial-build-funnel.js', () => ({
  trackInitialBuildStartedAsync: (...args: unknown[]) => mockTrackInitialBuildStartedAsync(...args),
}))
vi.mock('../../../services/agent-lifecycle-events/initial-build-post-interaction.js', () => ({
  trackPostInteractionIfEligible: (...args: unknown[]) => mockTrackPostInteractionIfEligible(...args),
}))

// First-turn content-conform scan hook (streamAgentTurn): spy the whole-tree
// scan so the hook's gating / await-ordering / failure-isolation are observable
// without running the real AST conform. Defaults to a no-op summary.
const mockConformExistingPages = vi.hoisted(() => vi.fn().mockResolvedValue({ scanned: 0, conformed: [], skipped: 0 }))
vi.mock('../../../services/content-conform.js', () => ({
  conformExistingPages: (...args: unknown[]) => mockConformExistingPages(...args),
}))

// The hook reads appPath off executionContext.metadata, which executeUnderTrace
// populates from AppRepository().findById(appId)?.path. Mock the repo so a test
// can supply (or withhold) the path through the real production code path.
// Default findById → undefined keeps every existing test's metadata.appPath
// absent (its prior behavior), so the conform hook stays dormant for them.
const mockAppRepoFindById = vi.hoisted(() => vi.fn().mockReturnValue(undefined))
vi.mock('../../../database/repositories/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../database/repositories/index.js')>()
  return {
    ...actual,
    AppRepository: vi.fn(function () { return { findById: mockAppRepoFindById }; }),
  }
})

// Recorder spy for safeProcessBudgetReport that always calls through, so the
// careContext-attribution tests can assert what each filing branch forwards
// while still getting a real BudgetReportResult back.
const mockSafeProcessBudgetReport = vi.hoisted(() => vi.fn())
vi.mock('../../budget-report-handler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../budget-report-handler.js')>()
  return {
    ...actual,
    safeProcessBudgetReport: (
      ...args: Parameters<typeof actual.safeProcessBudgetReport>
    ): ReturnType<typeof actual.safeProcessBudgetReport> => {
      mockSafeProcessBudgetReport(...args)
      return actual.safeProcessBudgetReport(...args)
    },
  }
})

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

// AIROBUILD-3088 PR2: the chat path consumes via `observe` (driven by the
// factory's experimental_transform), not a baseStream reader. Mock streamGenerate
// to drive observe over `parts` from getFinalResult (which the chat awaits),
// mirroring the real factory. `extra` overrides/extends the result (e.g. the
// isToolValidationError flags).
type StreamGenerateOptions = { observe?: (part: any) => unknown; abortSignal?: AbortSignal }
function streamGenerateImpl(parts: any[] = [], finalResult?: unknown, extra: Record<string, unknown> = {}) {
  return async (_prompt: string, options?: StreamGenerateOptions) => ({
    textStream: (async function* () {})(),
    response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
    getFinalResult: async () => {
      for (const part of parts) {
        if (options?.observe) await options.observe(part)
      }
      // finalResult: a function (called with the streamGenerate options — may
      // resolve or reject, mirroring a custom getFinalResult; read options.abortSignal
      // to model a dead-socket reject on chunk_timeout/abort) or a plain object
      // to return; defaults to a normal completion when omitted.
      if (typeof finalResult === 'function') return await finalResult(options)
      return finalResult ?? {
        usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
        totalUsage: { totalTokens: 0 },
        finishReason: 'stop',
        toolCalls: [],
        toolResults: [],
        steps: [],
      }
    },
    ...extra,
  })
}

// A finalResult function (for streamGenerateImpl's 2nd arg) that hangs until the
// turn's AbortSignal fires, then rejects — modelling the dead socket that backs
// getFinalResult after the chunk-timeout guard (or a user/shutdown abort) cancels
// the request. Any content parts go in streamGenerateImpl's 1st arg (observed
// before the stall).
async function rejectOnAbort(options?: StreamGenerateOptions): Promise<never> {
  await new Promise<void>((resolve) => {
    if (options?.abortSignal?.aborted) return resolve()
    options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
  })
  throw new Error(String(options?.abortSignal?.reason ?? 'aborted'))
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
      streamGenerate: vi.fn().mockImplementation(streamGenerateImpl(parts)),
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
    mockGetAgentFactory.mockReset()
    mockConformExistingPages.mockClear()
    mockConformExistingPages.mockResolvedValue({ scanned: 0, conformed: [], skipped: 0 })
    mockAppRepoFindById.mockReset()
    mockAppRepoFindById.mockReturnValue(undefined)
    mockCreateForWorkspace.mockReset()
    mockCreateForWorkspace.mockReturnValue({
      files: {
        stat: vi.fn().mockResolvedValue({ entries: [{ path: 'docs/ui-kit/kit-meta.json', error: 'not_found' }] }),
      },
    })
    deps = createMockDeps()
    service = new MessageExecutionService(deps as any)
  })

  // item 3 (AIROBUILD-3232): the design-kit gathering-pause status narration. The method
  // is private and effectively pure (reads only its opts + the mocked getKvMemoryStore),
  // so we invoke it directly with an injected publish spy and drive the timer with fake timers.
  describe('startDesignKitStatusNarration', () => {
    const appId = 'app-dk-1'
    const conversationId = 'conv-dk-1'
    const executionContext = { metadata: {} }
    const designKitAgent = { getConfig: () => ({ id: 'initial-design-kit' }) }
    const otherAgent = { getConfig: () => ({ id: 'develop' }) }

    const start = (agent: unknown, publish: (e: unknown) => void): Promise<() => void> =>
      (service as any).startDesignKitStatusNarration({ agent, appId, conversationId, executionContext, publish })

    const kvReturning = (get: () => Promise<unknown>): void => {
      mockGetKvMemoryStore.mockReturnValue({ get })
    }

    beforeEach(() => {
      mockGetKvMemoryStore.mockReset()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('is a no-op for a non-design-kit agent (never reads the phase)', async () => {
      const publish = vi.fn()
      const cancel = await start(otherAgent, publish)
      expect(publish).not.toHaveBeenCalled()
      expect(mockGetKvMemoryStore).not.toHaveBeenCalled()
      expect(() => cancel()).not.toThrow()
    })

    it('emits the first narration immediately and the second after ~1.6s when the phase is unset', async () => {
      vi.useFakeTimers()
      kvReturning(vi.fn().mockResolvedValue({ exists: false }))
      const publish = vi.fn()

      const cancel = await start(designKitAgent, publish)

      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'status_narration', data: expect.objectContaining({ text: 'Setting up your project…', appId }) }),
      )

      vi.advanceTimersByTime(1600)
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'status_narration', data: expect.objectContaining({ text: 'Finding vibes that match your brand…' }) }),
      )
      cancel()
    })

    it('emits during the gathering phase', async () => {
      kvReturning(vi.fn().mockResolvedValue({ exists: true, value: { phase: 'gathering' } }))
      const publish = vi.fn()
      await start(designKitAgent, publish)
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'status_narration' }))
    })

    it('is a no-op once the wizard has moved past gathering (e.g. brand)', async () => {
      kvReturning(vi.fn().mockResolvedValue({ exists: true, value: { phase: 'brand' } }))
      const publish = vi.fn()
      await start(designKitAgent, publish)
      expect(publish).not.toHaveBeenCalled()
    })

    it('degrades to a no-op (no emit, no throw) when the phase read fails', async () => {
      kvReturning(vi.fn().mockRejectedValue(new Error('kv unavailable')))
      const publish = vi.fn()
      const cancel = await start(designKitAgent, publish)
      expect(publish).not.toHaveBeenCalled()
      expect(() => cancel()).not.toThrow()
    })

    it('cancels the scheduled second narration (never flashes after the picker renders)', async () => {
      vi.useFakeTimers()
      kvReturning(vi.fn().mockResolvedValue({ exists: false }))
      const publish = vi.fn()

      const cancel = await start(designKitAgent, publish)
      expect(publish).toHaveBeenCalledTimes(1)

      cancel()
      vi.advanceTimersByTime(5000)
      expect(publish).toHaveBeenCalledTimes(1)
    })

    // Guards the execute() wiring the direct tests above can't reach: on a design-kit
    // gathering turn the narration is armed, and the first tool event must cancel the
    // scheduled second emit (clearStatusNarration in onToolCall). Deleting that call would
    // let "Finding vibes…" flash mid-turn — this test would then fail.
    it('cancels the scheduled narration via the tool-event wiring in execute()', async () => {
      vi.useFakeTimers()
      kvReturning(vi.fn().mockResolvedValue({ exists: false })) // phase unset → narration armed
      const dkAgent = {
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'tool-call', id: 't1', toolName: 'suggestDesignKits', input: {} }]),
        ),
        getName: vi.fn().mockReturnValue('initial-design-kit'),
        getConfig: vi.fn().mockReturnValue({ id: 'initial-design-kit', tools: {}, metadata: {} }),
      }
      deps.getAgent.mockImplementation((id: string) => {
        if (id !== 'initial-design-kit') throw new Error(`Agent config not found for id: ${id}`)
        return dkAgent
      })
      mockGetAgentFactory.mockReturnValue({ agents: { has: (id: string) => id === 'initial-design-kit' } })

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'initial-design-kit', lifecycleContext: { isInitialPrompt: false } })

      const narrationsOf = (): unknown[] =>
        (deps.eventChannel.publish as unknown as { mock: { calls: unknown[][] } }).mock.calls
          .filter((c) => (c[1] as { type?: string } | undefined)?.type === 'status_narration')
      // Only the immediate first narration published; the tool-call cancelled the second.
      expect(narrationsOf()).toHaveLength(1)
      expect((narrationsOf()[0] as unknown[])[1]).toMatchObject({ data: { text: 'Setting up your project…' } })

      vi.advanceTimersByTime(5000)
      expect(narrationsOf()).toHaveLength(1) // still only the first — the second stays cancelled
    })
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

  describe('initial-build lifecycle tracking', () => {
    beforeEach(() => {
      mockTrackInitialBuildStartedAsync.mockClear()
      mockTrackPostInteractionIfEligible.mockClear()
    })

    it('tracks started on the initial prompt turn', async () => {
      await service.execute({ ...DEFAULT_PARAMS, lifecycleContext: { isInitialPrompt: true } })

      expect(mockTrackInitialBuildStartedAsync).toHaveBeenCalledWith('app_1')
      expect(mockTrackPostInteractionIfEligible).not.toHaveBeenCalled()
    })

    it('tracks post interaction on follow-up turns with appId and conversationId', async () => {
      await service.execute({ ...DEFAULT_PARAMS, lifecycleContext: { isInitialPrompt: false } })

      expect(mockTrackPostInteractionIfEligible).toHaveBeenCalledWith('app_1', 'conv_1')
      expect(mockTrackInitialBuildStartedAsync).not.toHaveBeenCalled()
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
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

    function mockKitMetaStat(exists: boolean): ReturnType<typeof vi.fn> {
      const stat = vi.fn().mockResolvedValue({
        entries: [{
          path: 'docs/ui-kit/kit-meta.json',
          ...(exists ? { kind: 'file' } : { error: 'not_found' }),
        }],
      })
      mockCreateForWorkspace.mockReturnValue({ files: { stat } })
      return stat
    }

    function createDesignKitAgents(ids: string[]): Record<string, { streamGenerate: ReturnType<typeof vi.fn>; getName: ReturnType<typeof vi.fn>; getConfig: ReturnType<typeof vi.fn> }> {
      return Object.fromEntries(ids.map((id) => [id, {
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
        getName: vi.fn().mockReturnValue(id),
        getConfig: vi.fn().mockReturnValue({
          id,
          tools: { loadUiKit: {} },
          metadata: { preflightTools: id === 'develop' ? [] : ['listDesignSystems'] },
        }),
      }]))
    }

    function wireAgents(agents: Record<string, unknown>): void {
      deps.getAgent.mockImplementation((id: string) => {
        if (!(id in agents)) throw new Error(`Agent config not found for id: ${id}`)
        return agents[id]
      })
      mockGetAgentFactory.mockReturnValue({ agents: { has: (id: string) => id in agents } })
    }

    it('derives the -attached turn instance from kit-meta while persisting the base gallery variant', async () => {
      // AIROBUILD-2696 AC1: base gallery variant + kit-meta present ⇒ run the
      // -attached instance for this turn; never persist/switch the conversation to -attached.
      mockKitMetaStat(true)
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([])
      const base = 'initial-design-system-homepage-build'
      const attached = `${base}-attached`
      const agents = createDesignKitAgents([base, attached])
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: base,
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      expect(agents[attached]!.streamGenerate).toHaveBeenCalledTimes(1)
      expect(agents[base]!.streamGenerate).not.toHaveBeenCalled()
      expect(deps.persistAgentId).not.toHaveBeenCalledWith('conv_1', attached)
      expect(deps.stateManager.switchAgent).not.toHaveBeenCalledWith(expect.any(String), attached)
    })

    it('keeps the base gallery variant when the forced install fails on the initial prompt (AIROBUILD-2845)', async () => {
      // AIROBUILD-2845: when the kit install fails (enrich returns [] AND no kit-meta
      // on disk), the turn must stay on the tool-bearing base variant — never strand on
      // the tool-less -attached fork asserting a kit that isn't installed.
      const stat = mockKitMetaStat(false)
      mockEnrichWithForcedDesignKit.mockResolvedValueOnce([])
      const base = 'initial-design-system-homepage-build'
      const attached = `${base}-attached`
      const agents = createDesignKitAgents([base, attached])
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: base,
        designKitSlug: 'modern-bento',
        lifecycleContext: { isInitialPrompt: true },
      })

      expect(stat).toHaveBeenCalledWith({ paths: ['docs/ui-kit/kit-meta.json'] })
      expect(agents[base]!.streamGenerate).toHaveBeenCalledTimes(1)
      expect(agents[attached]!.streamGenerate).not.toHaveBeenCalled()
      expect(deps.persistAgentId).not.toHaveBeenCalledWith('conv_1', attached)
    })

    it('keeps the base gallery variant when kit-meta is absent', async () => {
      // AIROBUILD-2696 AC2: no artifact means no per-turn swap and no stranded -attached state.
      const stat = mockKitMetaStat(false)
      const base = 'initial-design-system-homepage-build'
      const attached = `${base}-attached`
      const agents = createDesignKitAgents([base, attached])
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: base,
        lifecycleContext: { isInitialPrompt: false },
      })

      expect(stat).toHaveBeenCalledWith({ paths: ['docs/ui-kit/kit-meta.json'] })
      expect(agents[base]!.streamGenerate).toHaveBeenCalledTimes(1)
      expect(agents[attached]!.streamGenerate).not.toHaveBeenCalled()
    })

    it('treats a kit-meta stat failure as no-kit: stays on the base variant without crashing the turn', async () => {
      // AIROBUILD-2696 AC2: a thrown workspace stat (transport failure, not a
      // per-path not_found) must default kitMetaExists=false and fall through to
      // the base variant — never reject the turn.
      const stat = vi.fn().mockRejectedValue(new Error('dev-supervisor unreachable'))
      mockCreateForWorkspace.mockReturnValue({ files: { stat } })
      const base = 'initial-design-system-homepage-build'
      const attached = `${base}-attached`
      const agents = createDesignKitAgents([base, attached])
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: base,
        lifecycleContext: { isInitialPrompt: false },
      })

      expect(stat).toHaveBeenCalledWith({ paths: ['docs/ui-kit/kit-meta.json'] })
      expect(agents[base]!.streamGenerate).toHaveBeenCalledTimes(1)
      expect(agents[attached]!.streamGenerate).not.toHaveBeenCalled()
    })

    it('keeps resolving the -attached instance across parked interview answer and build turns', async () => {
      // AIROBUILD-2696 GATE 2: turn 1 parks on askQuestion (no handoff); answer
      // and later build turns resolve base from the router, then derive -attached from the artifact.
      mockKitMetaStat(true)
      mockEnrichWithForcedDesignKit.mockResolvedValue([{ role: 'user', content: 'installed' }])
      const base = 'initial-design-system-homepage-build'
      const attached = `${base}-attached`
      const agents = createDesignKitAgents([base, attached])
      agents[attached]!.streamGenerate.mockImplementation(streamGenerateImpl([{ type: 'tool-call', id: 'ask-1', toolName: 'askQuestion', input: { question: 'What tone?' } }]))
      wireAgents(agents)

      await service.execute({ ...DEFAULT_PARAMS, agentId: base, designKitSlug: 'modern-bento', lifecycleContext: { isInitialPrompt: true } })
      expect(deps.onAgentChanged).not.toHaveBeenCalled()
      expect(agents[attached]!.streamGenerate).toHaveBeenCalledTimes(1)

      await service.execute({ ...DEFAULT_PARAMS, content: 'Warm and modern', agentId: base, lifecycleContext: { isInitialPrompt: false } })
      await service.execute({ ...DEFAULT_PARAMS, content: 'Build now', agentId: base, lifecycleContext: { isInitialPrompt: false } })

      expect(agents[attached]!.streamGenerate).toHaveBeenCalledTimes(3)
      expect(agents[base]!.streamGenerate).not.toHaveBeenCalled()
      expect(mockEnrichWithForcedDesignKit).toHaveBeenCalledTimes(1)
    })

    it('does not stat or swap after handoff persists develop', async () => {
      // AIROBUILD-2696 AC4: once the router resolves develop, the design-system
      // capability gate must exit before workspace stat or `develop-attached` probing.
      const stat = mockKitMetaStat(true)
      const agents = createDesignKitAgents(['develop'])
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId: 'develop',
        lifecycleContext: { isInitialPrompt: false },
      })

      expect(stat).not.toHaveBeenCalled()
      expect(deps.getAgent).not.toHaveBeenCalledWith('develop-attached')
      expect(agents.develop!.streamGenerate).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['develop', ['develop']],
      ['initial-design-kit', ['initial-design-kit']],
      ['initial-design-system', ['initial-design-system']],
      ['initial-design-system-homepage-build-attached', ['initial-design-system-homepage-build-attached']],
    ])('does not probe or double-suffix missing attached sibling for %s', async (agentId: string, ids: string[]) => {
      // AIROBUILD-2696 AC5: sibling guard. Kit-meta may exist for wizard/plain
      // design-system agents after install.ts synthesis; only registered siblings may swap.
      mockKitMetaStat(true)
      const agents = createDesignKitAgents(ids)
      wireAgents(agents)

      await service.execute({
        ...DEFAULT_PARAMS,
        agentId,
        lifecycleContext: { isInitialPrompt: false },
      })

      expect(deps.getAgent).not.toHaveBeenCalledWith(`${agentId}-attached`)
      expect(agents[agentId]!.streamGenerate).toHaveBeenCalledTimes(1)
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
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
      // A terminal `error` part is observed → onError records it and the chat
      // path re-throws it to the outer catch, which publishes error + complete
      // (AIROBUILD-3088). The factory also aborts the request on this part.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'error', error: new Error('stream failure') }]),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
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

    it('surfaces the observed terminal error over a rejecting getFinalResult (in-catch branch)', async () => {
      // Unlike the resolves-path test above (post-catch guard), here getFinalResult
      // REJECTS after the `error` part is observed — the abort/network fallout of the
      // factory cancelling the request. The catch's FIRST guard must surface the
      // recorded terminal error (terminalStreamError), NOT reclassify the rejection.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl(
            [{ type: 'error', error: new Error('CONTENT_FILTERED') }],
            vi.fn().mockRejectedValue(new Error('This operation was aborted')),
          ),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await expect(service.execute(DEFAULT_PARAMS)).resolves.toBeUndefined()

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error', content: 'CONTENT_FILTERED' }),
      )
      // The abort/fetch fallout must NOT win classification.
      expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error', content: expect.stringContaining('aborted') }),
      )
      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'complete', data: expect.objectContaining({ finishReason: 'error' }) }),
      )
    })

    it('hard-fails the turn and logs sse.stream.observe.failed when processing a part throws', async () => {
      // A synchronous publish failure inside onTextDelta makes processor.processPart
      // throw → the observe wrapper catches it, logs the distinct event, records it,
      // and the turn hard-fails ('error') rather than the soft result_fetch_failed
      // the dashboard reserves for genuine final-result fetch failures.
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      deps.eventChannel.publish.mockImplementation((_conv: string, event: any) => {
        if (event.type === 'chunk') throw new Error('processing boom')
        return Promise.resolve({ sequence: 1 })
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

      expect(errorCalls.some((c) => c[0] === 'sse.stream.observe.failed')).toBe(true)
      const complete = (deps.eventChannel.publish as any).mock.calls.find((c: any[]) => c[1]?.type === 'complete')
      expect(complete?.[1]?.data?.finishReason).toBe('error')
    })

    it('publishes non-terminal error event and processes mock stream for resolved tool validation', async () => {
      const streamGenerate = vi.fn().mockImplementation(
        streamGenerateImpl(
          [{ type: 'text-delta', text: 'corrective feedback text' }],
          undefined,
          { isToolValidationError: true, validationErrorMessage: 'JSON parsing failed' },
        ),
      )
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
        .mockImplementationOnce(streamGenerateImpl([{ type: 'text-delta', text: 'retried response' }]))
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

    it('classifies a terminal error part carrying budget-pattern text as BUDGET_EXCEEDED', async () => {
      deps = createMockDeps()
      // A terminal `error` part whose payload is a plain Error (NOT a
      // BudgetExceededError instance, NOT an APICallError) carrying budget text:
      // onError records it as terminalStreamError → re-thrown → the outer catch's
      // classifyStreamBudgetError pattern-match normalizes it to BUDGET_EXCEEDED.
      // classifyTurnError alone only recognizes BudgetExceededError instances, so
      // dropping that normalization would silently regress this to a generic error.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'error', error: new Error('LiteLLM Virtual Key: exceeded budget for model=claude-opus') }]),
        ),
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
        data: expect.objectContaining({ errorType: 'BUDGET_EXCEEDED' }),
      })
    })

    it('aborts stalled streams on chunk-timeout and emits terminal error + complete', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        // No content observed, then getFinalResult hangs until the gap guard
        // aborts (chunk_timeout) and the dead socket rejects → fail fast.
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([], rejectOnAbort)),
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
        // Content observed (resets the guard), then getFinalResult hangs until
        // the guard aborts (chunk_timeout) and the dead socket rejects →
        // soft-commit the partial content as incomplete.
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(
            streamGenerateImpl([{ type: 'text-delta', text: 'partial answer' }], rejectOnAbort),
          ),
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

    it('does not chunk-timeout after a finish frame while getFinalResult settles (completes as stop)', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        // The terminal finish frame pauses the gap guard; a slow getFinalResult
        // tail (the SDK settling its result after the stream ended) must NOT trip
        // a false chunk_timeout. The turn completes with the finish frame's reason.
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(
            streamGenerateImpl(
              [
                { type: 'text-delta', text: 'full answer' },
                { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 7, outputTokens: 3 } },
              ],
              async () => {
                await new Promise((r) => setTimeout(r, 20))
                return { finishReason: 'stop', totalUsage: { inputTokens: 7, outputTokens: 3 } }
              },
            ),
          ),
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

    it('finalizes a chunk-timeout abort even when getFinalResult ignores the abort (post-abort grace)', async () => {
      const prevTimeout = process.env.AI_CHUNK_TIMEOUT_MS
      const prevGrace = process.env.AI_GETFINAL_ABORT_GRACE_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        process.env.AI_GETFINAL_ABORT_GRACE_MS = '10'
        deps = createMockDeps()
        // getFinalResult never settles, even after the abort — models an SDK that
        // ignores the abort. The pre-collapse reader skipped getFinalResult on a
        // dead socket; without the post-abort grace the single-consumer await
        // would hang the SSE connection + activeStreams slot forever. The grace
        // rejects 10ms after the chunk_timeout abort → catch fails fast.
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(
            streamGenerateImpl([], () => new Promise<never>(() => undefined)),
          ),
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
      } finally {
        if (prevTimeout === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = prevTimeout
        if (prevGrace === undefined) delete process.env.AI_GETFINAL_ABORT_GRACE_MS
        else process.env.AI_GETFINAL_ABORT_GRACE_MS = prevGrace
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

    it('fails fast (error terminal) on a 408 upstream timeout with no content', async () => {
      deps = createMockDeps()
      // No content observed, then getFinalResult rejects with the 408 — nothing
      // to salvage, so the turn hard-fails with a terminal error event.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([], vi.fn().mockRejectedValue(make408Error())),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('soft-commits when getFinalResult throws a network error after content (complete:incomplete, honest error span)', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        // Stream completes with content (observed), but getFinalResult hits the
        // upstream close — exercises the getFinalResult catch network-error branch.
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'partial answer' }], vi.fn().mockRejectedValue(makeTerminatedError())),
        ),
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
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'partial answer' }], vi.fn().mockRejectedValue(make408Error())),
        ),
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
      // Upstream drops before any content arrives: getFinalResult rejects with the
      // terminated network error and there's nothing to salvage → hard error.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([], vi.fn().mockRejectedValue(makeTerminatedError())),
        ),
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
          streamGenerate: vi.fn().mockImplementation(async function (_message: string, opts: StreamGenerateOptions) {
            // The 20ms connect delay precedes the guard arming (which happens
            // after streamGenerate resolves), so it must not count toward the 5ms
            // chunk timeout. Content is then observed and the turn completes.
            await new Promise(r => setTimeout(r, 20))
            return {
              textStream: (async function* () {})(),
              response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
              getFinalResult: async () => {
                await opts.observe?.({ type: 'text-delta', text: 'connected' })
                return { finishReason: 'complete' }
              },
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

    it('unsubscribes SSE subscribers in finally block', async () => {
      const mockSub = { id: 'sse-1', onEvent: vi.fn(), onError: vi.fn() }
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.unsubscribe).toHaveBeenCalledWith('conv_1', 'sse-1')
    })
  })

  describe('skill-diagnostics ready sentinel', () => {
    const previous = process.env.SKILL_DIAGNOSTICS

    afterEach(() => {
      if (previous === undefined) delete process.env.SKILL_DIAGNOSTICS
      else process.env.SKILL_DIAGNOSTICS = previous
    })

    it('publishes a ready sentinel before the agent loop when SKILL_DIAGNOSTICS=true', async () => {
      process.env.SKILL_DIAGNOSTICS = 'true'
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({
          type: 'skill_diagnostics',
          data: expect.objectContaining({ event: 'ready' }),
        }),
      )
    })

    it('does not publish the sentinel when SKILL_DIAGNOSTICS is unset', async () => {
      delete process.env.SKILL_DIAGNOSTICS
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const publishedSkillEvents = deps.eventChannel.publish.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as { type?: string } | undefined)?.type === 'skill_diagnostics',
      )
      expect(publishedSkillEvents).toHaveLength(0)
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
        { finishReason: 'stop' }, // default mock getFinalResult resolves to a clean 'stop'
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
              result: 'boom',
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'error', error: new Error('stream failure') }])),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'error', error: new Error('stream failure') }])),
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

    it('forwards rebuildSourceImagesEnabled into executionContext metadata for the rebuild tool (SSE parity with WS)', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        lifecycleContext: { agentContext: { rebuildSourceImagesEnabled: true } },
      })

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildSourceImagesEnabled).toBe(true)
    })

    it('omits rebuildSourceImagesEnabled from executionContext metadata when the flag is off', async () => {
      deps = createMockDeps()
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      const executionContext = deps.contextManager.loadContextMessages.mock.calls[0][0]
      expect(executionContext.metadata.rebuildSourceImagesEnabled).toBeUndefined()
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
        streamGenerate: vi.fn().mockImplementation(async (_p: string, opts: StreamGenerateOptions) => ({
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          getFinalResult: async () => {
            await firstGate
            await opts.observe?.({ type: 'text-delta', text: 'late' })
            await secondGate
            return { finishReason: 'stop' }
          },
        })),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'text-delta', text: `${name ?? 'develop'} chunk` }])),
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

      const streamGenerate = vi.fn().mockImplementation(function (message: string, opts: { executionContext: { metadata: Record<string, unknown> } }) {
        opts.executionContext.metadata.isRebuildFlow = true
        return streamGenerateImpl([{ type: 'text-delta', text: 'chunk' }])(message, opts as any)
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
        // No content, then getFinalResult hangs until the gap guard aborts
        // (chunk_timeout) → end hooks run with reason 'error'.
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([], rejectOnAbort)),
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
            clearTurnState: vi.fn(),
            isFixSessionActive: vi.fn().mockReturnValue(false),
            pushTurn: vi.fn(),
            setLastTurnAgentAskedQuestion: vi.fn(),
            setLastTurnAgentMadeCodeChanges: vi.fn(),
            getFixSessionPhase: vi.fn(),
            transitionToAttempted: vi.fn(),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl(
          [{ type: 'text-delta', text: 'hello' }],
          { finishReason: 'complete', totalUsage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 } },
        )),
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
        streamGenerate: vi.fn().mockImplementation(async (prompt: string, options: any) => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return streamGenerateImpl(
            [{ type: 'text-delta', text: 'hi' }],
            { finishReason: 'complete', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          )(prompt, options)
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
    // handleChunkTimeout() → tracker.recordTimeout(). getFinalResult observes
    // nothing then hangs until the guard's abort rejects it.
    function createTimeoutDeps() {
      const d = createMockDeps()
      d.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([], rejectOnAbort)),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
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
          clearTurnState: vi.fn(),
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
        streamGenerate: vi.fn().mockImplementation(async (_p: string, _opts: StreamGenerateOptions) => ({
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          getFinalResult: async () => { await streamGate; return { finishReason: 'complete' } },
        })),
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
        clearTurnState: vi.fn(),
        isFixSessionActive: vi.fn().mockReturnValue(false),
        pushTurn: vi.fn(),
        setLastTurnAgentAskedQuestion: vi.fn(),
        setLastTurnAgentMadeCodeChanges: vi.fn(),
        getFixSessionPhase: vi.fn(),
        transitionToAttempted: vi.fn(),
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
          clearTurnState: vi.fn(),
          isFixSessionActive: vi.fn().mockReturnValue(false),
          pushTurn: vi.fn(),
          setLastTurnAgentAskedQuestion: vi.fn(),
          setLastTurnAgentMadeCodeChanges: vi.fn(),
          getFixSessionPhase: vi.fn(),
          transitionToAttempted: vi.fn(),
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

  describe('fix-session wiring', () => {
    function createFixSessionLifecycle(overrides: Record<string, unknown> = {}) {
      return {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearSession: vi.fn(),
          clearTurnState: vi.fn(),
          isFixSessionActive: vi.fn().mockReturnValue(true),
          getFixSessionPhase: vi.fn().mockReturnValue(FixSessionPhase.Gathering),
          getFixSessionTurnCount: vi.fn().mockReturnValue(1),
          pushTurn: vi.fn(),
          setLastTurnAgentAskedQuestion: vi.fn(),
          setLastTurnAgentMadeCodeChanges: vi.fn(),
          transitionToAttempted: vi.fn(),
          ...overrides,
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
    }

    it('transitions to attempted when agent makes code changes without asking a question', async () => {
      const lifecycle = createFixSessionLifecycle()
      const editSteps = [{
        content: [{ type: 'tool-call', toolName: 'str_replace_based_edit_tool', input: { command: 'str_replace' } }],
      }]
      const mockDeps = createMockDeps([{ type: 'text-delta', text: 'fixing' }])
      mockDeps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'fixing' }], { finishReason: 'complete', steps: editSteps }),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })

      const svc = new MessageExecutionService({ ...mockDeps, lifecycle } as any)
      await svc.execute({
        ...DEFAULT_PARAMS,
        lifecycleContext: { agentContext: { enableFixSession: true, enableAssessmentAgent: true } },
      })

      expect(lifecycle.sessionStore.transitionToAttempted).toHaveBeenCalledWith('sse:conv_1')
    })

    it('uses getTimeoutFallback when awaitOutcome resolves undefined', async () => {
      const fixOutcome = {
        result: { taskType: 'fix', confidence: 80 },
        overrideApplied: true,
        appliedBudget: 'fix-task',
        completedInTime: false,
        durationMs: 0,
        reason: 'embedding_timeout_fallback',
      }
      mockAwaitOutcome.mockReset()
      mockAwaitOutcome.mockResolvedValue(undefined)
      mockGetTimeoutFallback.mockReturnValue(fixOutcome)

      const lifecycle = createFixSessionLifecycle()
      const svc = new MessageExecutionService({ ...createMockDeps(), lifecycle } as any)
      await svc.execute({
        ...DEFAULT_PARAMS,
        lifecycleContext: { agentContext: { enableFixSession: true, enableAssessmentAgent: true } },
      })

      expect(mockGetTimeoutFallback).toHaveBeenCalled()
      const endHooksCall = mockRunMessageEndHooks.mock.calls.find(
        (c: any[]) => c[1]?.reason === 'complete'
      )
      expect(endHooksCall?.[1]?.assessmentOutcome).toBe(fixOutcome)
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
        streamGenerate: vi.fn().mockImplementation(async (_p: string, _opts: StreamGenerateOptions) => ({
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          getFinalResult: async () => { await streamGate; return { finishReason: 'complete' } },
        })),
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
          clearTurnState: vi.fn(),
          isFixSessionActive: vi.fn().mockReturnValue(false),
          pushTurn: vi.fn(),
          setLastTurnAgentAskedQuestion: vi.fn(),
          setLastTurnAgentMadeCodeChanges: vi.fn(),
          getFixSessionPhase: vi.fn(),
          transitionToAttempted: vi.fn(),
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

    it('calls clearTurnState exactly once when the turn owns the registry slot', async () => {
      const clearTurnState = vi.fn()
      const lifecycle = {
        gitHookService: {} as any,
        getAssessmentAgent: () => ({}) as any,
        sessionStore: {
          getLastUserMessage: vi.fn(),
          setLastUserMessage: vi.fn(),
          getLastAssessmentTaskType: vi.fn(),
          setLastAssessmentTaskType: vi.fn(),
          clearTurnState,
          isFixSessionActive: vi.fn().mockReturnValue(false),
          pushTurn: vi.fn(),
          setLastTurnAgentAskedQuestion: vi.fn(),
          setLastTurnAgentMadeCodeChanges: vi.fn(),
          getFixSessionPhase: vi.fn(),
          transitionToAttempted: vi.fn(),
        },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      }
      service = new MessageExecutionService({ ...deps, lifecycle } as any)

      await service.execute(DEFAULT_PARAMS)

      expect(clearTurnState).toHaveBeenCalledTimes(1)
      expect(clearTurnState).toHaveBeenCalledWith('sse:conv_1')
    })
  })

  describe('abort reason propagation', () => {
    it("invokes runMessageEndHooks with reason: 'disconnection' when aborted", async () => {
      mockRunMessageEndHooks.mockClear()
      let resolveStream: (v: any) => void
      const streamGate = new Promise<void>(r => { resolveStream = () => r() })

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: StreamGenerateOptions) { return {
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          // getFinalResult parks until the gate, then rejects once aborted so the
          // catch branch fires (mirrors a dead socket on user_stopped).
          getFinalResult: async () => {
            await streamGate
            if (opts?.abortSignal?.aborted) throw new Error('AbortError')
            return { finishReason: 'complete' }
          },
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
          clearTurnState: vi.fn(),
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
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: StreamGenerateOptions) { return {
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          // Mirrors the disconnection test: if a disconnect had aborted the turn
          // this would reject. AIROBUILD-2623 removes that abort, so the signal
          // stays clear and getFinalResult resolves normally.
          getFinalResult: async () => {
            await streamGate
            if (opts?.abortSignal?.aborted) throw new Error('AbortError')
            return { finishReason: 'complete' }
          },
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
          clearTurnState: vi.fn(),
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

      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          getFinalResult: async () => { await readPromise; return { finishReason: 'complete' } },
        })
      })
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute(DEFAULT_PARAMS)

      // Abort before consumption resolves - keyed by conversationId
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'text-delta', text: 'hi' }], { finishReason: 'complete' })),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'text-delta', text: 'hi' }], { finishReason: 'complete' })),
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([{ type: 'text-delta', text: 'hi' }], { finishReason: 'complete' })),
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
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          // Gate consumption on the test; once the client aborts (service.stop),
          // the dead socket rejects the final-result fetch, landing on the
          // `abortSignal.aborted` branch that ends the span as aborted.
          getFinalResult: async () => {
            await streamGate
            if (opts?.abortSignal?.aborted) throw new Error(String(opts.abortSignal.reason ?? 'aborted'))
            return { finishReason: 'complete', usage: { totalTokens: 0 }, toolCalls: [] }
          },
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
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'partial' }], vi.fn().mockRejectedValue(new Error('result fetch boom'))),
        ),
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
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          // The dead socket rejects the final-result fetch with the abort error,
          // exactly as user_stopped does in prod (non-network, signal aborted).
          getFinalResult: async () => {
            await streamGate
            throw new Error(String(opts?.abortSignal?.reason ?? 'This operation was aborted'))
          },
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
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'done' }], { finishReason: 'complete', steps }),
        ),
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
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: StreamGenerateOptions) {
          // Signal the test's poll that streamGenerate ran, then park getFinalResult
          // until the client aborts (service.stop) → the SDK returns the aborted result.
          resolveStream = () => {}
          return {
            textStream: (async function* () {})(),
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
            getFinalResult: async () => {
              await new Promise<void>((resolve) => {
                if (opts.abortSignal?.aborted) return resolve()
                opts.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
              })
              return { finishReason: 'aborted', steps: [{ stepNumber: 1, content: [] }] }
            },
          }
        }),
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
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
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
        response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
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
          clearTurnState: vi.fn(),
          isFixSessionActive: vi.fn().mockReturnValue(false),
          pushTurn: vi.fn(),
          setLastTurnAgentAskedQuestion: vi.fn(),
          setLastTurnAgentMadeCodeChanges: vi.fn(),
          getFixSessionPhase: vi.fn(),
          transitionToAttempted: vi.fn(),
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
        {
          errorType: 'UPSTREAM_UNAVAILABLE',
          statusCode: 503,
          _error: 'The AI service is temporarily unavailable. Please send your message again.',
          _absent: ['retryAttempts', 'retryReason'],
        },
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
      const { _absent, _error, ...positiveExpected } = expected as Record<string, unknown>
      expect(errorCall![1].data).toMatchObject({
        source: 'ai_response',
        error: _error ?? (error instanceof Error ? error.message : String(error)),
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
      // internalServerException → transient STREAM_TYPE_VALIDATION → isRetryable
      // logged so Loki can measure the retryable share of terminal errors.
      expect(log?.[1]).toMatchObject({ statusCode: 502, errorType: 'STREAM_TYPE_VALIDATION', isRetryable: true })
      expect(log?.[1]).toHaveProperty('validationValue')
    })
  })

  describe('APM transaction lifecycle', () => {
    it('labels and ends messageSpan on successful completion', async () => {
      const mockTransaction = { setAttribute: vi.fn(), setStatus: vi.fn(), updateName: vi.fn(), end: vi.fn() }
      deps = createMockDeps([{ type: 'text-delta', text: 'hi' }])
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, messageSpan: mockTransaction })

      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('agent_name', 'develop')
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('finishReason', expect.any(String))
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('result', 'success')
      expect(mockTransaction.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
      expect(mockTransaction.end).toHaveBeenCalled()
    })

    it('labels and ends messageSpan on error', async () => {
      const mockTransaction = { setAttribute: vi.fn(), setStatus: vi.fn(), updateName: vi.fn(), end: vi.fn() }
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('provider down')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, messageSpan: mockTransaction })

      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('finishReason', 'error')
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('error_type', 'Error')
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('result', 'error')
      expect(mockTransaction.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR })
      expect(mockTransaction.end).toHaveBeenCalled()
    })

    it('ends messageSpan on user stop', async () => {
      const mockTransaction = { setAttribute: vi.fn(), setStatus: vi.fn(), updateName: vi.fn(), end: vi.fn() }
      let resolveRead: (v: any) => void
      const readPromise = new Promise(r => { resolveRead = r })
      deps = createMockDeps([])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockResolvedValue({
          textStream: (async function* () {})(),
          response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
          getFinalResult: async () => { await readPromise; return { finishReason: 'complete' } },
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const executePromise = service.execute({ ...DEFAULT_PARAMS, messageSpan: mockTransaction })
      await new Promise(r => setTimeout(r, 50))
      service.stop('conv_1')
      resolveRead!(undefined)
      await executePromise

      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('finishReason', 'user_stopped')
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('result', 'aborted')
      expect(mockTransaction.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.UNSET })
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
      const mockTransaction = { setAttribute: vi.fn(), setStatus: vi.fn(), updateName: vi.fn(), end: vi.fn() }
      const streamStarted = deferred<void>()
      const mockSub = { id: 'sse-sub-1', onEvent: vi.fn(), onError: vi.fn() }
      deps = createMockDeps([])
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: StreamGenerateOptions) {
          return Promise.resolve({
            textStream: (async function* () {})(),
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
            getFinalResult: async () => {
              streamStarted.resolve()
              await new Promise<void>((resolve) => {
                if (opts.abortSignal?.aborted) return resolve()
                opts.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
              })
              return { finishReason: 'complete' }
            },
          })
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const execPromise = service.execute({ ...DEFAULT_PARAMS, conversationId: 'conv_1', messageSpan: mockTransaction })
      await streamStarted.promise
      service.onLastSubscriberLeft('conv_1')

      // Make cleanupActionService throw during shutdown — this exercises the catch path
      cleanupActionService.mockImplementationOnce(function () { throw new Error('cleanup exploded') })

      // shutdown should not propagate the error
      await expect(service.shutdown()).resolves.toBeUndefined()
      await execPromise

      // APM transaction still ends despite the throw (finally block)
      expect(mockTransaction.end).toHaveBeenCalled()
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('result', 'aborted')
    })

    it('aborts active streams and cleans action services, subscribers, timers, and APM state', async () => {
      const mockTransaction = { setAttribute: vi.fn(), setStatus: vi.fn(), updateName: vi.fn(), end: vi.fn() }
      const streamStarted = deferred<void>()
      let capturedSignal: AbortSignal | undefined
      const mockSub = { id: 'sse-sub-1', onEvent: vi.fn(), onError: vi.fn() }
      deps = createMockDeps([])
      deps.sseRegistry.getSubscribers.mockReturnValue([mockSub])
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(function (_message: string, opts: StreamGenerateOptions) {
          capturedSignal = opts.abortSignal
          return Promise.resolve({
            textStream: (async function* () {})(),
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
            getFinalResult: async () => {
              streamStarted.resolve()
              await new Promise<void>((resolve) => {
                if (opts.abortSignal?.aborted) return resolve()
                opts.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
              })
              return { finishReason: 'complete' }
            },
          })
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      const executePromise = service.execute({ ...DEFAULT_PARAMS, messageSpan: mockTransaction })
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
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('finishReason', 'server_shutdown')
      expect(mockTransaction.setAttribute).toHaveBeenCalledWith('result', 'aborted')
      expect(mockTransaction.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.UNSET })
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

  describe('careContext attribution', () => {
    // The care context is built once in executeUnderTrace and forwarded into
    // reconcileBudgetReport (→ safeProcessBudgetReport) on all three filing
    // branches. These tests pin that careAgentId propagates from agentCtx and
    // that each branch forwards it — a dropped spread on the error/fallback path
    // would silently lose attribution exactly when a session fails.
    const AGENT_CTX = {
      customerId: 'cust-789',
      careAgentId: 'worker-guid-123',
    }
    const EXPECTED_CARE_CONTEXT: ReturnType<typeof expect.objectContaining> = expect.objectContaining({
      careAgentId: 'worker-guid-123',
      appId: 'app_1',
      conversationId: 'conv_1',
    })

    it('forwards careContext on the success branch', async () => {
      mockSafeProcessBudgetReport.mockClear()
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'done' }], { finishReason: 'complete', steps: [] }),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
        subscriptionId: 'sub-123',
        authType: 'e2s',
        lifecycleContext: { agentContext: AGENT_CTX },
      })

      expect(mockSafeProcessBudgetReport).toHaveBeenCalledTimes(1)
      expect(mockSafeProcessBudgetReport.mock.calls[0][0]).toEqual(
        expect.objectContaining({ careContext: EXPECTED_CARE_CONTEXT }),
      )
    })

    it('forwards careContext on the error branch', async () => {
      mockSafeProcessBudgetReport.mockClear()
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockRejectedValue(new Error('stream failed')),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
        subscriptionId: 'sub-123',
        authType: 'e2s',
        lifecycleContext: { agentContext: AGENT_CTX },
      })

      expect(mockSafeProcessBudgetReport).toHaveBeenCalledTimes(1)
      expect(mockSafeProcessBudgetReport.mock.calls[0][0]).toEqual(
        expect.objectContaining({ careContext: EXPECTED_CARE_CONTEXT }),
      )
    })

    it('forwards careContext on the fallback branch', async () => {
      mockSafeProcessBudgetReport.mockClear()
      // createReport rejects (non-409) → success-branch reconcile returns
      // filed:false → the finally fallback reconciles again. Both invocations
      // reach safeProcessBudgetReport; the last one is the fallback call site.
      const budgetClient = createBudgetClient({
        createReport: vi.fn().mockRejectedValue(new Error('bms down')),
      })
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'done' }], { finishReason: 'complete', steps: [] }),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
        subscriptionId: 'sub-123',
        authType: 'e2s',
        lifecycleContext: { agentContext: AGENT_CTX },
      })

      expect(mockSafeProcessBudgetReport).toHaveBeenCalledTimes(2)
      const fallbackArgs: { careContext?: unknown } = mockSafeProcessBudgetReport.mock.calls.at(-1)![0]
      expect(fallbackArgs).toEqual(
        expect.objectContaining({ careContext: EXPECTED_CARE_CONTEXT }),
      )
    })

    it('leaves care fields undefined when no agentContext is present', async () => {
      mockSafeProcessBudgetReport.mockClear()
      const budgetClient = createBudgetClient()
      mockGetBudgetServiceClient.mockReturnValue(budgetClient as any)
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'done' }], { finishReason: 'complete', steps: [] }),
        ),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({
        ...DEFAULT_PARAMS,
        bmsBudgetId: 'budget-abc',
        budgetSessionId: 'session-xyz',
        authType: 'e2s',
      })

      expect(mockSafeProcessBudgetReport).toHaveBeenCalledTimes(1)
      expect(mockSafeProcessBudgetReport.mock.calls[0][0].careContext).toEqual({
        careAgentId: undefined,
        careAgentUsernameHash: undefined,
        appId: 'app_1',
        conversationId: 'conv_1',
      })
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
        streamGenerate: vi.fn().mockImplementation(streamGenerateImpl([])),
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
      const streamGenerate = vi.fn().mockImplementation(
        streamGenerateImpl([{ type: 'text-delta', text: 'ok' }], { finishReason: 'complete' }),
      )
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
      const streamGenerate = vi.fn().mockImplementation(
        streamGenerateImpl([{ type: 'text-delta', text: 'ok' }], { finishReason: 'complete' }),
      )
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
    // getFinalResult unblocks only when the turn's AbortSignal fires, then
    // resolves cleanly — models a provider that honors abort on SIGTERM, letting
    // execute() reach finalization (persistence + budget report). The optional
    // arg supplies the result returned once unblocked.
    function abortAwareAgent(resultFn?: ReturnType<typeof vi.fn>) {
      return {
        streamGenerate: vi.fn().mockImplementation(async function (_content: string, opts: StreamGenerateOptions) {
          return {
            textStream: (async function* () {})(),
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
            getFinalResult: async () => {
              await new Promise<void>((resolve) => {
                if (opts?.abortSignal?.aborted) return resolve()
                opts?.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
              })
              return resultFn ? await resultFn() : { finishReason: 'complete' }
            },
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
            response: Promise.resolve({ id: 'resp_1', timestamp: new Date(0), modelId: 'test-model' }),
            // getFinalResult never settles and ignores abort → the turn never finalizes.
            getFinalResult: () => neverSettles,
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        // inFlightTurns is populated synchronously by execute(); let the turn
        // progress to the parked getFinalResult before shutting down.
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
          streamGenerate: vi.fn().mockImplementation(
            streamGenerateImpl([{ type: 'text-delta', text: 'done' }], {
              finishReason: 'complete',
              steps: [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }],
            }),
          ),
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
        streamGenerate: vi.fn().mockImplementation(
          streamGenerateImpl([{ type: 'text-delta', text: 'done' }], {
            finishReason: 'complete',
            steps: [{ stepNumber: 1, content: [], response: { headers: { 'x-correlation-id': 'corr-1' } } }],
          }),
        ),
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

  // streamAgentTurn fires a one-time, per-app content-conform scan on the first
  // DEVELOP turn when an appPath is resolvable. These lock the three gates
  // (first-turn + develop + appPath), the failure isolation, and the
  // await-ordering (scan serialized before the edit stream — the race fix).
  describe('first-turn content-conform scan hook', () => {
    const APP_PATH = '/app'

    it('fires once with { appId, appPath } on the first develop turn when appPath is present', async () => {
      mockAppRepoFindById.mockReturnValue({ path: APP_PATH })

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'develop' })

      expect(mockConformExistingPages).toHaveBeenCalledTimes(1)
      expect(mockConformExistingPages).toHaveBeenCalledWith({ appId: 'app_1', appPath: APP_PATH })
    })

    it('skips non-develop agents even with appPath present', async () => {
      mockAppRepoFindById.mockReturnValue({ path: APP_PATH })

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'marketing' })

      expect(mockConformExistingPages).not.toHaveBeenCalled()
    })

    it('skips follow-up turns (non-empty conversation history)', async () => {
      mockAppRepoFindById.mockReturnValue({ path: APP_PATH })
      // A trailing prompt copy is dropped by dropTrailingPrompt, so seed an
      // earlier turn too — otherwise the deduped history is still empty and
      // isFirstTurn stays true.
      deps.loadConversationHistory.mockResolvedValue([
        { role: 'user', content: 'earlier message', tags: [] },
        { role: 'assistant', content: 'earlier reply', tags: [] },
      ])

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'develop' })

      expect(mockConformExistingPages).not.toHaveBeenCalled()
    })

    it('skips when appPath is absent (app record has no path)', async () => {
      mockAppRepoFindById.mockReturnValue(undefined)

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'develop' })

      expect(mockConformExistingPages).not.toHaveBeenCalled()
    })

    it('isolates a scan failure: the turn still resolves and the failure is logged', async () => {
      mockAppRepoFindById.mockReturnValue({ path: APP_PATH })
      mockConformExistingPages.mockRejectedValueOnce(new Error('scan blew up'))

      const loggerMod = await import('../../../logging/index.js')
      const warnSpy = vi.spyOn(loggerMod.logger, 'warn')

      let executeError: unknown
      let warnEvents: string[] = []
      try {
        await service.execute({ ...DEFAULT_PARAMS, agentId: 'develop' })
      } catch (e) {
        executeError = e
      } finally {
        warnEvents = warnSpy.mock.calls.map((c) => c[0] as string)
        warnSpy.mockRestore()
      }

      expect(executeError).toBeUndefined()
      expect(mockConformExistingPages).toHaveBeenCalledTimes(1)
      expect(warnEvents).toContain('content-extract.scan.failed')
    })

    it('awaits the scan BEFORE the agent edit stream starts (serialized, not racing)', async () => {
      mockAppRepoFindById.mockReturnValue({ path: APP_PATH })

      const order: string[] = []
      mockConformExistingPages.mockImplementationOnce(async () => {
        order.push('scan')
        return { scanned: 0, conformed: [], skipped: 0 }
      })
      // The agent's edit stream runs after the conform inside streamAgentTurn;
      // record its start so we can assert the scan precedes it.
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockImplementation((prompt: string, options?: StreamGenerateOptions) => {
          order.push('stream')
          return streamGenerateImpl([])(prompt, options)
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute({ ...DEFAULT_PARAMS, agentId: 'develop' })

      expect(order).toEqual(['scan', 'stream'])
    })
  })
})
