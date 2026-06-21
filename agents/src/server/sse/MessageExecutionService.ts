import type { ConversationEventChannel, ConversationMessage, PersistenceStreamingEvent, ConversationContext, ValidationMessageEventData, StreamTimingData, StreamingEventType, TurnSnapshotState, TurnSnapshotUpdate } from '@airo/ai-transport'
import {
  StreamPartProcessor,
  StreamTimingTracker,
  ChunkTimeoutGuard,
  decideChunkTimeoutFinalization,
  executeAgentLoop,
  buildChatSignalsTraceContext,
  createAgentInvocation,
  runAgentTurnSpan,
  getCurrentTraceIds,
  emitTurnError,
  type TurnExecutionResult,
  classifyTurnError,
  runPostStreamValidation,
  withBudgetRecovery,
  redactSkillOutput,
  toolMetadataFields,
  trackTurnSnapshotEvent,
  extractTurnOutputFromEvents,
  extractTurnToolResponseDataFromEvents,
  buildInvocationToolResponseData,
  runPreflightTools,
  analyzeStreamError,
  isNetworkError,
  isUpstreamTimeoutError,
  classifyStreamBudgetError,
  isToolValidationError,
  assembleMessages,
  dropTrailingPrompt,
  captureResponseMetadata,
  readTextStreamFallback,
  recordTokenUsageObservability,
  TOOL_VALIDATION_ERROR_TYPE,
  BUSINESS_CONTEXT_SCHEMA_ID,
} from '@airo/ai-transport'
import type { ResponseMetadata, ResolveToolMetadata } from '@airo/ai-transport'
import { BudgetExceededError, classifyError } from '@airo/ai-common'
import { grantSessionManager } from '@airo/ai-grants'
import { createGrantBudgetRecoveryCallback } from '../grant-budget-recovery-callback.js'
import { context as otelContext, trace } from '@opentelemetry/api'
import type { AgentsMessagePersistence } from '../conversation-persistence.js'
import type { EventStreamRegistry, SubscriberLifecycleListener } from './EventStreamRegistry.js'
import { SSEClientActionService } from './SSEClientActionService.js'
import { registerActionService, cleanupActionService, getActionService } from '../agent-runtime.js'
import { sseSessionKey } from './session-key.js'
import { resolveRebuildBuildPagePrompt } from '../rebuild-build-page-message.js'
import { emitRebuildBuildPageToolLifecycle } from '../rebuild-build-page-tool-events.js'
import { logger, errorFields } from '../../logging/index.js'
import { getBudgetServiceClient } from '../../services/budget-service-instance.js'
import {
  BudgetServiceConflictError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
  buildAttributionPayload,
  emitCostAttributionResult,
  logReportCreated,
  toBudgetUpdatePayload,
  type AttributionAssessment,
  type AttributionContext,
  type ExecutionStep,
} from '@airo/ai-lib/budget'
import { checkCorrelationIdRace, safeProcessBudgetReport } from '../budget-report-handler.js'
import { parseChunkTimeoutMs, runWithModelOverride, buildTokenUsage, calculateCostEstimate } from '@airo/ai-lib'
import { resolveProfile, runWithProfile } from '../../profiles/index.js'
import { guardAllowedOverrideModel, resolveOverride } from '../model-override.js'
import type { AssessmentOutcome } from '../../agents/assessment-agent/index.js'
import { ClassifierMode } from '../../agents/assessment-agent/index.js'
import { PARALLEL_ASSESSMENT_TIMEOUT_MS } from '../assessment-executor.js'
import { createAgentContext, emitConversationStart } from '@godaddy/agent-otel-sdk'
import { getBusinessContext, setBusinessContext } from '@signals/otel-sdk'
import {
  buildContextAttachments,
  type BuildContextAttachmentAsset,
  type BuildContextAttachmentsBuildErrorContext,
  type BuildContextAttachmentsCustomContext,
  type ContextAttachment,
} from '@airo/shared/context-attachment'
import type { PostStreamValidatorResult } from '../post-stream-validator.js'
import {
  runStartGitHook, startParallelAssessment, runMessageEndHooks,
  type MessageLifecycleDeps, type ParallelAssessmentHandle,
} from '../message-lifecycle.js'
import {
  buildDynamicDataMessage, buildTodoContextMessage, buildRagContextMessage,
  buildMemoryContextMessage,
  collectImagesFromFormattedContexts, dataUrlsToProcessedFiles,
  checkAndTriggerSummarization,
} from '../context-builders.js'
import { computeDebugTurnStats } from '../../utils/debug-turn-stats.js'
import { withTimeout } from '../../utils/promise-utils.js'
import { interactiveSubAgentManager } from '../../agents/interactive-sub-agent-manager.js'
import { subAgentJobRegistry } from '../../agents/sub-agent-job-registry.js'
import { AppRepository } from '../../database/repositories/index.js'
import { enrichWithForcedDesignKit } from '../../services/design-system/forced-install.js'
import { buildAppliedSkillsContextMessage } from '../applied-skills-context.js'

/** Short timeout for awaiting the classifier on an errored turn — the user is
 *  already seeing a failure, so don't delay terminal events for a slow classifier.
 *  usedFreeGrants defaults to false when the outcome is unavailable. */
const ERRORED_TURN_ASSESSMENT_TIMEOUT_MS = 500

/** Server-side eval-only diagnostics gate. Single source of truth for the
 *  SOCKET_DIAGNOSTICS flag so the call sites can't drift on the var name. The
 *  StreamTimingTracker gates its own socket.emit on the same env var internally. */
function isDiagnosticsEnabled(): boolean {
  return process.env.SOCKET_DIAGNOSTICS === 'true'
}

interface ExecutionDeps {
  getAgent: (agentId?: string) => any
  contextManager: { loadContextMessages: (context: Record<string, unknown>) => Promise<{ contextMessages: any[]; formattedContexts?: any[] }> }
  loadConversationHistory: (conversationId: string, appId: string, agentName: string, excludeTags?: string[]) => Promise<ConversationMessage[]>
  conversationPersistence: AgentsMessagePersistence
  eventChannel: ConversationEventChannel
  sseRegistry: EventStreamRegistry
  stateManager: {
    getCurrentAgent: (sessionId: string) => string | undefined
    getLastHandoffPrompt: (sessionId: string) => string | undefined
    clearLastHandoffPrompt: (sessionId: string) => void
    setSessionMetadata: (sessionId: string, metadata: Record<string, unknown>) => void
    getSelectedTodoList: (sessionId: string) => string | undefined
    setSelectedTodoList: (sessionId: string, listId: string) => void
    /** Reset the warm session cache's current agent (handoff-state-manager.switchAgent).
     *  The agent router consults this cache BEFORE the persisted store, so the forced-kit
     *  recovery must reset it too — mirroring the route freeze's store+session dual-write.
     *  Optional. */
    switchAgent?: (sessionId: string, agentId: string) => Promise<unknown> | unknown
  }
  onAgentChanged?: (conversationId: string, oldAgent: string, newAgent: string, appId?: string) => Promise<void>
  /** Persist the conversation's frozen agent id (ConversationLifecycleStore.updateAgentId).
   *  Used by the forced-design-kit recovery to revert a failed `-attached` freeze to the
   *  base variant so later turns don't resurrect it. Optional; recovery still fixes the
   *  current turn without it. */
  persistAgentId?: (conversationId: string, agentId: string) => Promise<void>
  backgroundSummarizer?: {
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: string, customerId?: string): Promise<void>
    getMaxPromptTokens(): number
  } | null
  /** Post-stream validator (tsc + runtime-error checks). Returns a continuation prompt to retry, or null to finish. */
  postStreamValidator?: (params: {
    socketId: string
    context: Record<string, unknown>
    agentName: string
    toolCalls: Array<{ toolName: string; args?: unknown }>
    abortSignal: AbortSignal
    emitChunk: (text: string) => Promise<void>
  }) => Promise<PostStreamValidatorResult>
  /** Clear post-stream retry counters for a session key (called at the start of each message). */
  resetPostStreamRetries?: (sessionKey: string) => void
  /** Shared lifecycle deps for git-hook + assessment orchestration. Skipped when absent. */
  lifecycle?: MessageLifecycleDeps
  /**
   * Resolves transport-level metadata (skillName) for tool_result/tool_error
   * frames. Shared with the WS transport; see `resolveSkillToolMetadata`.
   */
  resolveToolMetadata?: ResolveToolMetadata
}

/**
 * Persistence context carries optional commitHash / usedFreeGrants once the
 * end-of-message hooks compute them, so conversationPersistence.completeConversation
 * can stamp them on the persisted message metadata. The fields are optional and
 * mutated in place — reads use ?? defaults.
 */
interface SSEPersistenceContext extends ConversationContext {
  contextAttachments?: ContextAttachment[]
  commitHash?: string | null
  usedFreeGrants?: boolean
}

interface LifecycleContext {
  agentContext?: {
    enableAssessmentAgent?: boolean
    enableAssessmentOverride?: boolean
    assessmentClassifier?: ClassifierMode
    modelOverride?: string
    modelSelectorEnabled?: boolean
    agentProfile?: string
    customerId?: string
    visitorId?: string
    trafficSessionId?: string
    canDownload?: boolean
    canPublish?: boolean
    canPurchaseDomain?: boolean
    isE2S?: boolean
    authType?: string
    useTestBudget?: boolean
    budgetServiceEnabled?: boolean
    subscriptionId?: string
    bmsBudgetId?: string
    useAtlasCrawler?: boolean
    rebuildIntakeFormEnabled?: boolean
    debugStatsEnabled?: boolean
    market?: string
    marketingCampaignsEnabled?: boolean
    skillSuggestionsEnabled?: boolean
  }
  isInitialPrompt?: boolean
}

interface ExecuteParams {
  appId: string
  conversationId: string
  content: string
  siteId: string
  agentId: string
  templateId?: string
  modelOverride?: string
  // These are opaque wire shapes consumed by tools downstream. Kept as
  // unknown here so assignments into executionContext don't widen to any.
  visualContext?: unknown
  aiEditContext?: unknown
  aiEditContexts?: unknown[]
  selectedAssets?: BuildContextAttachmentAsset[]
  todoListContext?: unknown
  isActionRequest?: boolean
  customContext?: BuildContextAttachmentsCustomContext
  buildErrorContext?: BuildContextAttachmentsBuildErrorContext | null
  /** Rebuild page-selector "Build Page" slug — substitutes the agent turn input
   *  with the source-built page prompt (AIROBUILD-2104). */
  rebuildBuildPageSlug?: string
  /** Homepage rebuild modal design direction — applied by websiteRebuild on the
   *  flag-off and intake-timeout paths. */
  rebuildDesignDirection?: string
  uploadedFileName?: string
  bmsBudgetId?: string
  budgetSessionId?: string
  /** Original subscriptionId for override detection (care agent, test accounts) */
  subscriptionId?: string
  authType?: string
  /** Raw HTTP request headers — used to extract Signals/OTEL trace propagation. */
  requestHeaders?: Record<string, string | string[] | undefined>
  /** FullStory session id token (from `x-fullstory-session-id`), attached to the trace. */
  fullStorySessionId?: string
  /** JWT agent context + derived lifecycle hints (isInitialPrompt, multi-turn caches). */
  lifecycleContext?: LifecycleContext
  market?: string
  userTimezone?: string
  requestId?: string
  /** Elastic APM transaction — labeled progressively and ended at terminal. */
  apmTransaction?: { setLabel: (k: string, v: string | number) => void; setOutcome: (o: 'unknown' | 'success' | 'failure') => void; end: () => void; result?: string | number } | null
  /** User-selected design kit slug from the gallery; forces install on turn 1 for design-system variants. */
  designKitSlug?: string
}

interface ActiveStream {
  appId: string
  convId: string
  subscriberIds: Set<string>
  requestId?: string
  apmTransaction?: { setLabel: (k: string, v: string | number) => void; setOutcome: (o: 'unknown' | 'success' | 'failure') => void; end: () => void; result?: string | number } | null
  lastTrackerSnapshot?: { chunksRead: number; streamElapsedMs: number }
  lastResponseMetadata?: ResponseMetadata
}

/**
 * Pick the agent instance for one loop iteration. When `useAttachedVariant` is
 * set (decided once before the loop, gated on a successful forced install — see
 * executeUnderTrace), the initial design-system turn streams the `-attached`
 * sibling — same prompt minus auto-select, toolset minus listDesignSystems/
 * installDesignSystem — so the model can't re-pick a kit. The loop name
 * (resolvedAgentId) is unchanged, so persistence/telemetry stay on the canonical
 * id and the swap self-reverts after handoff (the develop iteration calls this
 * with name='develop', which fails the `name === resolvedAgentId` guard).
 */
export function resolveTurnAgent<A>(opts: {
  name: string
  resolvedAgentId: string
  useAttachedVariant: boolean
  getAgent: (id: string) => A | undefined
}): A | undefined {
  const { name, resolvedAgentId, useAttachedVariant, getAgent } = opts
  if (useAttachedVariant && name === resolvedAgentId) {
    return getAgent(`${resolvedAgentId}-attached`)
  }
  return getAgent(name)
}

/**
 * Pick the agent whose config drives the forced design-kit install, and report
 * whether an `-attached` sibling exists (the signal to swap the turn agent).
 *
 * Two things to get right:
 *  - `getAgent` THROWS for an unknown id (the factory's `agents.get` raises
 *    "Agent config not found"), so every lookup of a maybe-absent id is wrapped.
 *  - When the resolved agent is ALREADY the `-attached` variant (the build was
 *    frozen on it, so every turn runs it — not just turn 1), we must NOT look up
 *    `<id>-attached-attached` (which doesn't exist and would throw). Use the
 *    resolved agent directly and report no sibling (no further swap needed).
 */
export function pickForcedInstallAgent<A>(opts: {
  resolvedAgentId: string
  getAgent: (id: string) => A | undefined
}): { agent: A | undefined; hasAttachedSibling: boolean } {
  const { resolvedAgentId, getAgent } = opts
  const safeGet = (id: string): A | undefined => {
    try { return getAgent(id) } catch { return undefined }
  }
  if (resolvedAgentId.endsWith('-attached')) {
    return { agent: safeGet(resolvedAgentId), hasAttachedSibling: false }
  }
  const attached = safeGet(`${resolvedAgentId}-attached`)
  return { agent: attached ?? safeGet(resolvedAgentId), hasAttachedSibling: !!attached }
}

// On graceful shutdown, abort unblocks each in-flight turn's stream read; the
// turn then runs finalization (persistence + budget report). shutdown() awaits
// those turns so app.ts does not closeDatabase() underneath an in-progress
// write. Bounded so a provider that ignores its AbortSignal cannot hang the
// process past the Nomad kill grace window (prod 120s; the agents process also
// self-imposes a 20s server-close window). Persistence is the local SQLite
// write at the head of finalization and completes well within this bound; the
// remote budget report follows it, so if the bound ever elapses the dropped
// work is the (idempotent, GoDaddy-absorbs-the-cost) report, not the turn output.
const SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS = 5_000

export class MessageExecutionService implements SubscriberLifecycleListener {
  private deps: ExecutionDeps
  private readonly chunkTimeoutMs = parseChunkTimeoutMs()
  private abortControllers = new Map<string, AbortController>()
  private activeStreams = new Map<string, ActiveStream>()
  private endedApmTransactions = new WeakSet<NonNullable<ActiveStream['apmTransaction']>>()
  // Tracks in-flight execute() turns (promise → conversationId) so shutdown()
  // can await their finalization before the DB closes. Entries self-remove when
  // the turn settles. Mirrors git-hook-service's trackOperation/waitForInFlightOps.
  private inFlightTurns = new Map<Promise<void>, string>()

  constructor(deps: ExecutionDeps) {
    this.deps = deps
  }

  hasActiveStream(conversationId: string): boolean {
    return this.activeStreams.has(conversationId)
  }

  onLastSubscriberLeft(conversationId: string): void {
    if (!this.activeStreams.has(conversationId)) return
    // A disconnected client no longer aborts an in-flight build (AIROBUILD-2623):
    // the stream runs to completion and commits/persists regardless of audience,
    // so a user who closes their tab mid-build returns to a finished site. Reconnect
    // and replay still work; there is simply no deadline. Bounds remain via
    // MAX_HANDOFFS, the chunk-timeout guard, and the AI SDK step cap.
    logger.info('sse.execution.subscribers_left_stream_continues', { conversationId })
  }

  onSubscriberAdded(_conversationId: string): void {
    // No-op since AIROBUILD-2623 removed the no-subscriber abort timer; kept to
    // satisfy the SubscriberLifecycleListener contract called by EventStreamRegistry.
  }

  /**
   * Publish an event with an attached .catch so a misbehaving subscriber
   * cannot flip the execution path: a blocking subscriber's rejection is
   * logged and dropped rather than propagating to callers.
   *
   * Log severity is chosen by the caller: terminal-event failures strand
   * the client (they never receive a stream-end signal) and must land at
   * `error`; non-terminal failures (chunks, tool events, budget) drop
   * individual frames and are correctly `warn`.
   */
  private async guardedPublish(
    appId: string,
    conversationId: string,
    event: Parameters<typeof this.deps.eventChannel.publish>[1],
    logEvent: 'sse.execution.terminal_publish_failed' | 'sse.execution.stream_publish_failed',
    severity: 'error' | 'warn',
  ): Promise<void> {
    await this.deps.eventChannel.publish(conversationId, event).catch(err => {
      logger[severity](logEvent, { appId, conversationId, eventType: event.type, ...errorFields(err) })
    })
  }

  private publishTerminal(
    appId: string, conversationId: string,
    event: Parameters<typeof this.deps.eventChannel.publish>[1],
  ): Promise<void> {
    return this.guardedPublish(appId, conversationId, event, 'sse.execution.terminal_publish_failed', 'error')
  }

  private publishNonTerminal(
    appId: string, conversationId: string,
    event: Parameters<typeof this.deps.eventChannel.publish>[1],
  ): Promise<void> {
    return this.guardedPublish(appId, conversationId, event, 'sse.execution.stream_publish_failed', 'warn')
  }

  private markApmTransactionEnded(transaction: ActiveStream['apmTransaction']): void {
    if (transaction) this.endedApmTransactions.add(transaction)
  }

  private isApmTransactionEnded(transaction: ActiveStream['apmTransaction']): boolean {
    return !!transaction && this.endedApmTransactions.has(transaction)
  }

  private async completeConversationAndMarkPersisted(opts: {
    appId: string
    conversationId: string
    streamingEvents: PersistenceStreamingEvent[]
    result: unknown
    persistenceContext: SSEPersistenceContext
    agentMessageIds: Iterable<string>
    failureLogEvent: 'sse.execution.persistence_failed' | 'sse.execution.error_persistence_failed'
  }): Promise<boolean> {
    const {
      appId,
      conversationId,
      streamingEvents,
      result,
      persistenceContext,
      agentMessageIds,
      failureLogEvent,
    } = opts

    try {
      await this.deps.conversationPersistence.completeConversation(
        conversationId, streamingEvents, result, persistenceContext
      )
    } catch (err) {
      // Surface the failure to the caller (returns false). Billing is gated on
      // this so a turn whose output did not persist is never charged.
      logger.error(failureLogEvent, { appId, conversationId, ...errorFields(err) })
      return false
    }

    // SSE-only: WS uses PersistenceSubscriber to flag events as persisted during
    // streaming; SSE batches via completeConversation and back-fills here. If WS
    // is ever migrated to this batched model, lift this loop into shared code.
    for (const messageId of agentMessageIds) {
      const marked = this.deps.eventChannel.markMessageEventsPersisted(conversationId, messageId)
      if (marked === 0) {
        // Legitimately zero whenever the turn was aborted (user_stopped, upstream
        // error) before any events with this messageId reached the buffer. The
        // marker is a replay-dedup optimization, not a correctness signal — debug.
        logger.debug('sse.execution.persisted_marker.no_events_marked', {
          appId,
          conversationId,
          messageId,
        })
      }
    }

    return true
  }

  stop(conversationId: string): void {
    const controller = this.abortControllers.get(conversationId)
    if (!controller) {
      logger.warn('sse.execution.stop_no_active_stream', { conversationId })
      return
    }

    controller.abort('user_stopped')
    // tear down detached sub-agent jobs for this conversation
    subAgentJobRegistry.abort(conversationId)
    const active = this.activeStreams.get(conversationId)
    logger.info('sse.execution.stopped', { conversationId, ...(active?.requestId && { requestId: active.requestId }) })

    // The execute() loop observes the abort and publishes its own terminal
    // `complete` when it returns — but that can take seconds (mid-chunk
    // reader.read(), a getFinalResult() await, a provider that doesn't
    // honor abortSignal). Emit a user_stopped complete now so the client
    // UI resets immediately. execute()'s later publish is a no-op on the
    // client side (finalizeStream early-returns when activeStream is null)
    // and produces at most a duplicate event on any other subscriber.
    if (active) {
      if (active.apmTransaction) {
        active.apmTransaction.setLabel('finishReason', 'user_stopped')
        active.apmTransaction.result = 'aborted'
        active.apmTransaction.setOutcome('unknown')
        active.apmTransaction.end()
        this.markApmTransactionEnded(active.apmTransaction)
      }
      // Vacate the slot BEFORE publishing the terminal. Late events from
      // the still-running old execute() (mid-chunk reader.read(), tool
      // result, getFinalResult()) are gated on `activeStreams.get(...) ===
      // streamState`, so clearing the slot causes them to drop rather than
      // leak into a next turn's stream if the user prompts immediately.
      //
      // The old execute()'s finally block skips unsubscribe on the same
      // ownership check, so unsubscribe its subscribers here — after the
      // terminal publish so the stop reaches the client — unless a newer
      // execute() has already re-subscribed the same IDs (it re-pulls from
      // sseRegistry and rebinds the subscriber set).
      this.activeStreams.delete(conversationId)
      void this.publishTerminal(active.appId, conversationId, {
        conversationId, type: 'complete', content: '',
        data: { finishReason: 'user_stopped', ...getCurrentTraceIds(), ...(active.requestId && { requestId: active.requestId }) },
        agentName: 'system',
      }).finally(() => {
        const nextOwner = this.activeStreams.get(conversationId)
        for (const subId of active.subscriberIds) {
          if (nextOwner?.subscriberIds.has(subId)) continue
          this.deps.eventChannel.unsubscribe(conversationId, subId)
        }
      })
    }
  }

  subscribeStream(conversationId: string, subscriber: { id: string; onEvent: (event: any) => Promise<void> }): void {
    const active = this.activeStreams.get(conversationId)
    if (!active) {
      logger.debug('sse.execution.subscribe_no_active_stream', { conversationId, subscriberId: subscriber.id })
      return
    }
    this.deps.eventChannel.subscribe(active.convId, subscriber as any)
    active.subscriberIds.add(subscriber.id)
  }

  async shutdown(): Promise<void> {
    logger.info('sse.execution.shutdown.begin', { activeStreamCount: this.activeStreams.size })

    const activeEntries = [...this.activeStreams.entries()]

    for (const [conversationId, active] of activeEntries) {
      try {
        if (this.activeStreams.get(conversationId) !== active) continue

        await this.publishTerminal(active.appId, conversationId, {
          conversationId,
          type: 'complete',
          content: '',
          data: {
            finishReason: 'server_shutdown',
            timestamp: new Date().toISOString(),
            ...(active.requestId && { requestId: active.requestId }),
          },
          agentName: 'system',
        })
        this.activeStreams.delete(conversationId)

        const controller = this.abortControllers.get(conversationId)
        if (controller) {
          controller.abort('server_shutdown')
          this.abortControllers.delete(conversationId)
        }

        cleanupActionService(sseSessionKey(conversationId))

        for (const subId of active.subscriberIds) {
          this.deps.eventChannel.unsubscribe(conversationId, subId)
        }
      } catch (error) {
        logger.error('sse.execution.shutdown.stream_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (active.apmTransaction) {
          active.apmTransaction.setLabel('finishReason', 'server_shutdown')
          active.apmTransaction.result = 'aborted'
          active.apmTransaction.setOutcome('unknown')
          active.apmTransaction.end()
          this.markApmTransactionEnded(active.apmTransaction)
        }
      }
    }

    // The aborts above unblock each in-flight turn's stream read; the turn then
    // finalizes (persists accumulated output, files the budget report). Await
    // those turns so app.ts's closeDatabase() does not race an in-progress
    // SQLite write. Bounded — see SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS.
    await this.awaitInFlightTurns()

    logger.info('sse.execution.shutdown.complete', { abortedStreamCount: activeEntries.length })
  }

  /**
   * Wait for in-flight execute() turns to finalize, bounded by
   * SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS. A turn that does not settle within the
   * bound is abandoned (logged with its conversationId) rather than hanging
   * shutdown past the kill grace window.
   */
  private async awaitInFlightTurns(): Promise<void> {
    if (this.inFlightTurns.size === 0) return

    await withTimeout(
      Promise.allSettled([...this.inFlightTurns.keys()]),
      SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS,
      () => {
        // Reading inFlightTurns live here is intentional. Settled turns
        // self-remove via the .finally in execute(); at a 5s bound that delete
        // microtask has long since run, so what remains is exactly the
        // genuinely-stuck turns whose finalization we are abandoning.
        logger.error('sse.execution.shutdown.finalize_timeout', {
          timeoutMs: SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS,
          unfinishedCount: this.inFlightTurns.size,
          unfinishedConversationIds: [...this.inFlightTurns.values()],
        })
      },
      // allSettled never rejects, so a late rejection is unreachable here.
      () => {},
    )
  }

  private async getBudgetSessionWithRetry(
    budgetId: string,
    sessionId: string,
    client: NonNullable<ReturnType<typeof getBudgetServiceClient>>,
  ): Promise<Awaited<ReturnType<typeof client.getSession>>> {
    const maxGetSessionRetries = 2
    for (let attempt = 0; attempt <= maxGetSessionRetries; attempt++) {
      try {
        return await client.getSession(sessionId)
      } catch (err) {
        const isTransient = err instanceof BudgetServiceTimeoutError || err instanceof BudgetServiceUnavailableError
        if (!isTransient || attempt === maxGetSessionRetries) {
          logger.error('budget.report.getSessionFailed', {
            budgetId, sessionId, attempt, maxRetries: maxGetSessionRetries, ...errorFields(err),
          })
          throw err
        }
        const baseDelay = 100
        const maxDelay = 2000
        const delay = Math.random() * Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    throw new Error('getSession failed without throwing')
  }

  private async reconcileBudgetReport(opts: {
    appId: string
    conversationId: string
    budgetId: string
    sessionId: string
    streamState: ActiveStream
    steps: ExecutionStep[]
    assessmentOutcome?: AssessmentOutcome
    wasUserAborted: boolean
    subscriptionId?: string
  }): Promise<{ filed: boolean; sessionWasFree?: boolean }> {
    const { appId, conversationId, budgetId, sessionId, streamState, steps, assessmentOutcome, wasUserAborted, subscriptionId } = opts
    let sessionWasFreeForRefresh: boolean | undefined

    const publishBudgetEvent = async (event: Parameters<typeof this.deps.eventChannel.publish>[1]): Promise<void> => {
      if (this.activeStreams.get(conversationId) !== streamState) {
        logger.info('sse.execution.superseded.skip_budget_event', {
          appId,
          conversationId,
          eventType: event.type,
        })
        return
      }
      await this.publishNonTerminal(appId, conversationId, event)
    }

    const reconcileTimer = setTimeout(() => {
      void publishBudgetEvent({
        conversationId, type: 'budget_status', content: '',
        data: { status: 'reconciling' }, agentName: 'system',
      })
    }, 10_000)
    if (typeof reconcileTimer === 'object' && 'unref' in reconcileTimer) reconcileTimer.unref()

    try {
      const budgetClient = getBudgetServiceClient()
      if (!budgetClient) {
        await publishBudgetEvent({
          conversationId,
          type: 'budget_update',
          content: '',
          data: { refreshRequired: true },
          agentName: 'system',
        })
        return { filed: false }
      }

      const session = await this.getBudgetSessionWithRetry(budgetId, sessionId, budgetClient)

      try {
        checkCorrelationIdRace(steps, session.sessionItems, { budgetId, sessionId })
      } catch (err) {
        logger.warn('budget.report.correlation_id_check_failed', { budgetId, sessionId, ...errorFields(err) })
      }

      if (!assessmentOutcome) {
        logger.warn('budget.report.assessment_outcome_missing', {
          budgetId,
          sessionId,
          socketId: sseSessionKey(conversationId),
          message: 'Attribution will proceed without intent data',
        })
      }

      const { result: budgetResult } = safeProcessBudgetReport(
        {
          budgetId,
          sessionId,
          totalCost: session.costTotal,
          sessionItems: session.sessionItems,
          steps,
          assessmentOutcome,
          wasUserAborted,
          subscriptionId,
        },
        { budgetId, sessionId },
      )
      const { reportItems, executionData, sessionWasFree, attributionResult, attributionPath, labels } = budgetResult
      sessionWasFreeForRefresh = sessionWasFree

      let report: Awaited<ReturnType<typeof budgetClient.createReport>>
      try {
        report = await budgetClient.createReport(sessionId, { reportItems, allowOverage: true })
      } catch (err) {
        if (err instanceof BudgetServiceConflictError) {
          logger.info('budget.report.conflict_idempotent', {
            budgetId,
            sessionId,
            sessionWasFree,
            message: 'Report already exists - telling client to refresh',
          })
          await publishBudgetEvent({
            conversationId,
            type: 'budget_update',
            content: '',
            data: { refreshRequired: true, sessionWasFree },
            agentName: 'system',
          })
          return { filed: true, sessionWasFree }
        }

        const budgetError = err instanceof BudgetServiceError ? err : null
        logger.error('budget.report.createReportFailed', {
          budgetId,
          sessionId,
          error: err instanceof Error ? err.message : String(err),
          statusCode: budgetError?.statusCode,
          responseBody: budgetError?.responseBody,
        })
        throw err
      }

      if (attributionResult) {
        const attributionContext: AttributionContext = {
          budgetId,
          sessionId,
          conversationId,
          appId,
        }
        logReportCreated(attributionResult, report.reportId, attributionContext)
      } else {
        logger.info('budget.report.created', {
          budgetId,
          sessionId,
          reportId: report.reportId,
          totalCost: session.costTotal,
          sessionWasFree,
          attributionPath,
        })
      }

      try {
        const attribution = buildAttributionPayload({
          attributionResult,
          totalCost: session.costTotal,
          sessionWasFree,
          fallbackLabels: labels,
        })
        const assessment: AttributionAssessment | undefined = assessmentOutcome?.result?.taskType
          ? { intent: assessmentOutcome.result.taskType }
          : undefined

        otelContext.with(
          createAgentContext({ conversationId }),
          () => {
            emitCostAttributionResult({
              budgetId,
              budgetSessionId: sessionId,
              reportId: report.reportId,
              executionData,
              assessment,
              totalCost: session.costTotal,
              sessionWasFree,
              attributionPath,
              attribution,
            })
          },
        )
      } catch (err) {
        logger.error('budget.report.attribution_emit_failed', {
          budgetId,
          sessionId,
          reportId: report.reportId,
          attributionPath,
          totalCost: session.costTotal,
          sessionWasFree,
          ...errorFields(err),
        })
      }

      try {
        const budget = await budgetClient.getBudget(budgetId)
        const payload = toBudgetUpdatePayload(report, budget, sessionWasFree)

        logger.info('budget.update.payload_sent', {
          budgetId,
          sessionId,
          reportId: report.reportId,
          sessionWasFree,
          reportItemCount: payload.assignment.reportItems.length,
          totalBudgetCost: report.budgetCostTotal,
          totalProductCost: report.productCostTotal,
          categories: payload.assignment.reportItems.map(item => item.category),
          budgetItemCount: payload.budgetItems.length,
        })

        await publishBudgetEvent({
          conversationId, type: 'budget_update', content: '',
          data: payload as unknown as Record<string, unknown>,
          agentName: 'system',
        })
      } catch (err) {
        logger.error('budget.report.payload_failed', { budgetId, sessionId, reportId: report.reportId, ...errorFields(err) })
        await publishBudgetEvent({
          conversationId,
          type: 'budget_update',
          content: '',
          data: { refreshRequired: true, sessionWasFree },
          agentName: 'system',
        })
      }

      return { filed: true, sessionWasFree }
    } catch (err) {
      logger.error('budget.report.failed', { appId, budgetId, sessionId, ...errorFields(err) })
      await publishBudgetEvent({
        conversationId,
        type: 'budget_update',
        content: '',
        data: {
          refreshRequired: true,
          ...(sessionWasFreeForRefresh !== undefined && { sessionWasFree: sessionWasFreeForRefresh }),
        },
        agentName: 'system',
      })
      return { filed: false }
    } finally {
      clearTimeout(reconcileTimer)
    }
  }

  private async streamAgentTurn(
    agent: any,
    agentName: string,
    message: string,
    opts: {
      conversationId: string
      appId: string
      sseSocketId: string
      abortController: AbortController
      executionContext: Record<string, unknown>
      persistenceContext: SSEPersistenceContext
      streamState: ActiveStream
      agentMessageId?: string
      turnSnapshot: TurnSnapshotState
      /** Forced design-kit install messages, computed once before the loop (so the
       *  -attached swap can be gated on install success); prepended on the first turn. */
      forcedKitMessages?: Array<{ role: string; content: unknown }>
      fullStorySessionId?: string
      /** Wall-clock at message-handling start (executeUnderTrace), used for the
       *  stream_timing_summary diagnostic's timeToStreamStartMs. */
      turnStartMs: number
    },
  ): Promise<{ accumulatedContent: string; currentStep: number; finalResult: any; finishReason: string; responseMetadata: ResponseMetadata; steps: ExecutionStep[] }> {
    const {
      conversationId,
      appId,
      sseSocketId,
      abortController,
      executionContext,
      persistenceContext,
      streamState,
      agentMessageId,
      turnSnapshot,
      forcedKitMessages,
      fullStorySessionId,
      turnStartMs,
    } = opts
    const abortSignal = abortController.signal
    // Wall-clock of the first baseStream read; with turnStartMs this yields the
    // pre-stream init duration for the timing diagnostic. Defaults to turnStartMs
    // so a turn that never reads a stream reports 0 rather than a negative delta.
    let streamFirstReadMs = turnStartMs

    // Inject the user's current message text into metadata BEFORE loadContextMessages
    // runs so context-manager.processContextAttachments can read it for upload
    // classification (placementIntent). Mirrors the WS transport which sets
    // metadata._userMessage = data.message in processContext(). Without this,
    // SSE-initiated uploads classify against an empty prompt → always "unclear".
    const execMeta = (executionContext.metadata ?? {}) as Record<string, unknown>
    if (message) execMeta._userMessage = message
    executionContext.metadata = execMeta

    const pendingPublishes: Promise<unknown>[] = []
    const pendingIncrementalUpdates: Promise<unknown>[] = []
    // Guard each publish with .catch so a blocking-subscriber rejection
    // (e.g. its onEvent throws) doesn't reject Promise.all(pendingPublishes)
    // and propagate up into execute()'s outer catch, flipping a healthy
    // turn into a spurious error+complete. publishTerminal handles the
    // terminal events with an equivalent guard; this covers chunk /
    // tool_* / budget / validator events.
    //
    // Ownership check: if a newer execute() has taken over the activeStreams
    // slot, our straggler events would leak into the next turn's subscribers
    // and corrupt its stream (including finalize events wiping the new
    // activeStream on the client). Drop the event silently in that case.
    const publish = (event: Parameters<typeof this.deps.eventChannel.publish>[1]) => {
      if (this.activeStreams.get(conversationId) !== streamState) return
      pendingPublishes.push(
        this.deps.eventChannel.publish(conversationId, event).catch(err => {
          logger.warn('sse.execution.stream_publish_failed', {
            appId, conversationId, eventType: event.type, ...errorFields(err),
          })
        })
      )
    }

    const modelName = agent?.getConfig?.()?.modelName ?? 'unknown'
    // Forward the tracker's incremental diagnostics (stream.chunk.slow_gap from
    // recordChunk; stream.chunk.timeout from recordTimeout in handleChunkTimeout)
    // onto the SSE stream as first-class events. The tracker gates these emits on
    // SOCKET_DIAGNOSTICS internally, so the adapter only fires when the flag is
    // on; dotted event names are normalized to the underscore form registered in
    // STREAMING_EVENT_TYPES.
    const tracker = new StreamTimingTracker({
      socket: {
        id: sseSocketId,
        emit: (event: string, data: unknown) => {
          this.publishNonTerminal(appId, conversationId, {
            conversationId,
            type: event.replace(/\./g, '_') as StreamingEventType,
            content: '',
            data: data as Record<string, unknown>,
            agentName,
          })
        },
      },
      agentName,
      modelName,
      logger,
      abortController: { signal: abortSignal },
    })
    const guard = this.createChunkTimeoutGuard(abortController, sseSocketId, agentName, modelName)
    const baseEventData = {
      source: 'ai_response',
      agentId: agentName,
      ...(agentMessageId && { messageId: agentMessageId }),
      ...(streamState.requestId && { requestId: streamState.requestId }),
    }
    const toolIdsBeforeInvocation = new Set(turnSnapshot.pendingToolCalls?.keys() ?? [])
    const scheduleAgentTurnUpdate = (update: TurnSnapshotUpdate): void => {
      if (!agentMessageId || !this.deps.conversationPersistence.updateAgentTurn) return
      pendingIncrementalUpdates.push(
        this.deps.conversationPersistence.updateAgentTurn(
          conversationId,
          agentMessageId,
          update,
          persistenceContext,
        ).catch((err) => {
          logger.warn('sse.execution.agent_turn_update_failed', {
            appId, conversationId, messageId: agentMessageId, ...errorFields(err),
          })
        })
      )
    }
    const flushPendingWork = async (): Promise<void> => {
      // `StreamPartProcessor` callbacks are synchronous; schedule* calls must
      // enqueue work before this per-part flush awaits pending promises.
      if (pendingPublishes.length > 0) await Promise.all(pendingPublishes.splice(0))
      if (pendingIncrementalUpdates.length > 0) await Promise.all(pendingIncrementalUpdates.splice(0))
    }

    const processor = new StreamPartProcessor({
      onTextDelta: (text) => {
        tracker.recordTextChunk()
        trackTurnSnapshotEvent(turnSnapshot, 'chunk', text, baseEventData)
        publish({ conversationId, type: 'chunk', content: text, data: baseEventData, agentName })
      },
      onToolStart: (toolCallId, toolName, step) => {
        const eventData = { ...baseEventData, step, toolName, tool: { id: toolCallId, name: toolName, input: {} } }
        trackTurnSnapshotEvent(turnSnapshot, 'tool_start', '', eventData)
        publish({
          conversationId, type: 'tool_start',
          content: `Using ${toolName}...`,
          data: eventData,
          agentName,
        })
      },
      onToolInputDelta: (toolCallId, delta, _accumulated, toolName) => {
        publish({
          conversationId, type: 'tool_input_delta', content: '',
          data: { ...baseEventData, toolId: toolCallId, toolName, delta }, agentName,
        })
      },
      onToolInputParseFailure: (toolCallId, toolName, rawInput) => {
        logger.error('tool.input.parse_failure', { toolCallId, toolName, fullInput: rawInput.slice(0, 200) })
      },
      onToolCall: (toolCallId, toolName, parsedInput) => {
        guard?.pause()
        tracker.pauseGapTracking(toolName)
        const input = typeof parsedInput === 'string' ? {} : parsedInput
        publish({
          conversationId, type: 'tool_call',
          content: `${toolName} input ready`,
          data: { ...baseEventData, step: processor.currentStep, toolName, tool: { id: toolCallId, name: toolName, input } },
          agentName,
        })
      },
      onToolResult: (toolCallId, result, sdkInput, sdkToolName) => {
        guard?.reset()
        tracker.resumeGapTracking()
        const toolCall = processor.getToolCall(toolCallId)
        const toolName = sdkToolName ?? toolCall?.name ?? toolCallId
        const input = sdkInput !== undefined
          ? sdkInput
          : (typeof toolCall?.input === 'string' ? {} : toolCall?.input)
        const output = redactSkillOutput(toolName, result)
        // Surface skillName on per-skill MCP tools so the client can attribute
        // the tool call to its skill without parsing the wire-name shape.
        // Shared with the WS transport via resolveToolMetadata + toolMetadataFields.
        const eventData = { ...baseEventData, step: processor.currentStep, toolName, tool: { id: toolCallId, name: toolName, input, output, ...toolMetadataFields(toolName, this.deps.resolveToolMetadata, logger) } }
        const snapshot = trackTurnSnapshotEvent(turnSnapshot, 'tool_result', `${toolName} completed`, eventData)
        publish({
          conversationId, type: 'tool_result',
          content: `${toolName} completed`,
          data: eventData,
          agentName,
        })
        if (snapshot.shouldUpdateAgentTurn) scheduleAgentTurnUpdate(snapshot.update)
      },
      onToolError: (toolCallId, error, sdkInput, sdkToolName) => {
        guard?.reset()
        tracker.resumeGapTracking()
        const toolCall = processor.getToolCall(toolCallId)
        const toolName = sdkToolName ?? toolCall?.name ?? toolCallId
        const input = sdkInput !== undefined
          ? sdkInput
          : (typeof toolCall?.input === 'string' ? {} : (toolCall?.input || {}))
        const eventData = {
          ...baseEventData,
          step: processor.currentStep,
          toolName,
          tool: { id: toolCallId, name: toolName, input, output: {}, error: error.message, is_error: true, ...toolMetadataFields(toolName, this.deps.resolveToolMetadata, logger) },
        }
        const snapshot = trackTurnSnapshotEvent(turnSnapshot, 'tool_result', `${toolName} failed: ${error.message}`, eventData)
        publish({
          conversationId, type: 'tool_result',
          content: `${toolName} failed: ${error.message}`,
          data: eventData,
          agentName,
        })
        if (snapshot.shouldUpdateAgentTurn) scheduleAgentTurnUpdate(snapshot.update)
      },
      onStepStart: (step) => {
        const eventData = {
          ...baseEventData,
          step,
          stepType: 'reasoning',
          agentId: agentName,
          agentName: agent.getName?.() ?? agentName,
        }
        trackTurnSnapshotEvent(turnSnapshot, 'step_start', '', eventData)
        publish({
          conversationId, type: 'step_start', content: '',
          data: eventData,
          agentName,
        })
      },
      onError: (error) => {
        const budget = classifyStreamBudgetError(error)
        if (budget.type === 'budget_exceeded') {
          throw budget.budgetError
        }
        throw budget.error
      },
    })

    const contextResult = await this.deps.contextManager.loadContextMessages(executionContext)

    const allImages = collectImagesFromFormattedContexts(contextResult.formattedContexts)
    const processedFiles = allImages.length > 0 ? dataUrlsToProcessedFiles(allImages) : undefined
    if (processedFiles?.length) {
      logger.info('sse.vision.attach', { count: processedFiles.length })
    }

    const metadata = (executionContext.metadata ?? {}) as Record<string, unknown>
    const todoListContext = executionContext['todoListContext']

    const [ragContextMessage, todoContextMessage, memoryContextMessage, historyMessages] = await Promise.all([
      buildRagContextMessage({ userMessage: message, appId, sessionId: sseSocketId }),
      buildTodoContextMessage({
        sessionId: sseSocketId, appId, metadata,
        contextAttachments: todoListContext
          ? [{ type: 'todo_list_context', data: todoListContext }]
          : undefined,
        stateManager: this.deps.stateManager,
      }).catch(err => {
        logger.warn('sse.execution.todo_context_failed', { appId, conversationId, ...errorFields(err) })
        return null
      }),
      buildMemoryContextMessage({ appId }),
      this.deps.loadConversationHistory(
        conversationId, appId, agentName,
        interactiveSubAgentManager.isInteractiveAgent(sseSocketId, agentName)
          ? undefined
          : ['interactiveSubAgent']
      ).catch(err => {
        logger.warn('sse.execution.history_load_failed', { appId, conversationId, ...errorFields(err) })
        return [] as ConversationMessage[]
      }),
    ])

    const dynamicDataMessage = buildDynamicDataMessage(metadata)

    const appliedSkillsMessage = await buildAppliedSkillsContextMessage(appId)

    const extraAfterHistory = [ragContextMessage, todoContextMessage, memoryContextMessage, dynamicDataMessage, appliedSkillsMessage]
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map(m => ({ role: m.role, content: m.content, ...(m.cachePoint && { cachePoint: m.cachePoint }) }))

    // Preflight tool synthesis: when conversation is empty and the agent declares
    // preflightTools in its metadata, run them server-side and prepend synthesized
    // assistant tool_call + tool result pairs so the model sees the result on turn 1.
    let preflightMessages: Array<{ role: string; content: unknown }> = []
    // Derive first-turn status from the EFFECTIVE history. The current message
    // is persisted (continueConversation) before history is loaded here, so on a
    // genuine first turn it is the sole trailing history entry. assembleMessages
    // drops that trailing copy, so isFirstTurn must use the same deduped view or
    // preflight tools would never run on the first turn.
    const isFirstTurn = dropTrailingPrompt(historyMessages, message).length === 0
    if (isFirstTurn && agent && typeof agent.getConfig === 'function') {
      try {
        const agentConfig = agent.getConfig()
        const preflightTools = (agentConfig.metadata as { preflightTools?: string[] } | undefined)?.preflightTools
        if (preflightTools && preflightTools.length > 0) {
          preflightMessages = await runPreflightTools({
            preflightTools,
            tools: agentConfig.tools as Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>,
            context: executionContext ?? {},
            logger: { warn: (event: string, data: Record<string, unknown>) => logger.warn(event, data) },
          })
          logger.info('preflight.injected', { count: preflightMessages.length, tools: preflightTools })
        }
      } catch (error) {
        logger.warn('preflight.skipped', { reason: 'getConfig failed', ...errorFields(error) })
      }
    }

    // Forced design-kit install messages are computed once before the loop (in
    // executeUnderTrace) so the -attached variant swap can be gated on install
    // success. Prepend them on the first turn.
    if (isFirstTurn && forcedKitMessages && forcedKitMessages.length > 0) {
      preflightMessages = [...preflightMessages, ...forcedKitMessages]
    }

    const assembled = assembleMessages({
      contextMessages: contextResult.contextMessages,
      conversationHistory: historyMessages,
      extraAfterHistory,
      preflightMessages: preflightMessages.length > 0 ? preflightMessages : undefined,
      currentPrompt: message,
    })
    // before_history + after_history both ride the `context` param; the LLM pipeline
    // re-splits them by insertionOrder, placing after_history past the cache breakpoint.
    // Only history + preflight go into `messages` (the stable, cacheable prefix).
    const contextMessages = [...assembled.beforeHistory, ...assembled.afterHistory]
    const messages = assembled.messages

    for (const removed of assembled.strippedOrphanTools) {
      logger.warn('sse.history.strip_orphan_tool', { toolCallId: removed.tool_call_id })
    }

    // Create the Langfuse-facing agent-invocation span under the trace context
    // established in execute(). The handle ends on every exit path (success,
    // abort, error), idempotently.
    const invocation = createAgentInvocation({
      agent,
      agentName,
      prompt: message,
      conversationId,
      logger: { warn: (event, fields) => logger.warn(event, fields) },
    })

    // Propagate OTel trace ID to GoCode via x-trace-id header for cross-service
    // log correlation. unified-provider reads this off
    // executionContext.metadata.traceId when
    // building outgoing GoCode requests; without it, SSE-initiated LLM calls
    // land in GoCode logs with no trace link back to the conversation.
    const invocationSpan = trace.getSpan(invocation.context)
    const traceId = invocationSpan?.spanContext().traceId

    // Surface the FullStory session id on the Langfuse trace. The Langfuse
    // span processor maps `langfuse.trace.metadata.<key>` attributes into the
    // trace's metadata; setting it on the agent-invocation span (the turn's
    // root Langfuse observation) puts it on the trace. Separate from the
    // Signals/Event Bus sink (global.context), which never reaches Langfuse.
    if (invocationSpan && fullStorySessionId) {
      invocationSpan.setAttribute('langfuse.trace.metadata.fullStorySessionId', fullStorySessionId)
    }
    // Mutate metadata in place. Spreading into a new metadata object breaks
    // tool writes such as
    // websiteRebuild's isRebuildFlow flag — the handoff develop leg would
    // rebuild tags from the stale executionContext.metadata snapshot.
    if (!executionContext.metadata || typeof executionContext.metadata !== 'object') {
      executionContext.metadata = {}
    }
    if (traceId) {
      (executionContext.metadata as Record<string, unknown>).traceId = traceId
    }
    const executionContextWithTrace: Record<string, unknown> = {
      socketId: sseSocketId,
      ...executionContext,
    }

    const throwChunkTimeoutError = (): never => {
      throw new Error(`Stream chunk timeout after ${this.chunkTimeoutMs!}ms`)
    }

    // Set by handleChunkTimeout()/handlePrematureClose() when the stall is
    // soft-committable (content already arrived, or a terminal finish frame was
    // seen). Non-null signals the finalization block below to SKIP
    // getFinalResult() — which is backed by the now-dead socket and would never
    // resolve — and finalize the turn with this finishReason instead.
    let chunkTimeoutFinishReason: 'stop' | 'incomplete' | null = null
    // Set by handlePrematureClose() so the Langfuse span is recorded as an
    // error (the upstream connection DID fail) even though the wire-facing
    // finishReason is the soft 'incomplete'. Unlike chunk_timeout (which aborts
    // the signal and lands on endAborted), a premature close leaves the signal
    // un-aborted, so without this it would mis-record as endSuccess.
    let prematureCloseError: unknown = undefined

    // On chunk_timeout: soft-commit (sets chunkTimeoutFinishReason, caller
    // breaks the loop) when content/finish is present; otherwise fail fast via
    // throwChunkTimeoutError (preserving today's behaviour).
    const handleChunkTimeout = (): void => {
      // Diagnostic parity with the WS server (which called recordTimeout at its
      // abort sites): emit the structured stream.chunk.timeout WARN log and,
      // under SOCKET_DIAGNOSTICS, the stream_chunk_timeout event the eval's
      // LatencyEvaluator collects. recordTimeout gates the socket emit on the
      // flag internally, so production only gets the warn log. Reached only when
      // the abort reason is chunk_timeout, and each call site breaks after, so
      // this fires once per timeout across both the soft-commit and fail-fast
      // paths below.
      tracker.recordTimeout(`Stream chunk timeout after ${this.chunkTimeoutMs!}ms`)
      const outcome = decideChunkTimeoutFinalization({
        isFinished: processor.isFinished(),
        hasContent: processor.getAccumulatedContent().length > 0,
      })
      if (outcome.kind === 'finalize') {
        chunkTimeoutFinishReason = outcome.finishReason
        logger.warn('sse.stream.chunk_timeout.soft_commit', {
          appId, conversationId, agentName, finishReason: outcome.finishReason,
        })
        return
      }
      throwChunkTimeoutError()
    }

    // On a premature upstream close (undici `terminated`, socket reset, body
    // timeout — anything isNetworkError matches) OR an upstream request-timeout
    // HTTP response (GoCode 408 / gateway 504 — isUpstreamTimeoutError matches)
    // where content already arrived, soft-commit it via the same seam as
    // chunk_timeout instead of surfacing a hard error. Returns true if
    // soft-committed (caller stops reading); false → caller rethrows.
    const handlePrematureClose = (err: unknown): boolean => {
      const upstreamTimeout = isUpstreamTimeoutError(err)
      if (!isNetworkError(err) && !upstreamTimeout) return false
      const outcome = decideChunkTimeoutFinalization({
        isFinished: processor.isFinished(),
        hasContent: processor.getAccumulatedContent().length > 0,
      })
      if (outcome.kind !== 'finalize') return false
      chunkTimeoutFinishReason = outcome.finishReason
      prematureCloseError = err
      logger.warn('sse.stream.premature_close.soft_commit', {
        appId, conversationId, agentName, finishReason: outcome.finishReason,
        trigger: upstreamTimeout ? 'upstream_timeout' : 'network_close',
        statusCode: (err as { statusCode?: number }).statusCode,
        ...errorFields(err),
      })
      return true
    }

    type StreamResult = Awaited<ReturnType<typeof agent.streamGenerate>>
    const retryAfterToolValidation = async (validationMessage: string): Promise<StreamResult> => {
      logger.error('sse.tool.validation.failure', { appId, message: validationMessage })

      const step = processor.currentStep
      publish({
        conversationId, type: 'step_start', content: '',
        data: { ...baseEventData, step, stepType: 'reasoning', agentId: agentName, agentName: agent.getName?.() ?? agentName },
        agentName,
      })
      publish({
        conversationId, type: 'tool_result',
        content: 'Tool call failed - invalid JSON format',
        data: {
          ...baseEventData, step,
          toolName: 'tool_validation_failed',
          tool: { id: 'failed-tool-call', name: 'tool_validation_failed', input: {}, output: `Tool call failed due to invalid JSON format: ${validationMessage}. Please check your JSON syntax and try again.` },
          agentId: agentName,
        },
        agentName,
      })
      publish({
        conversationId, type: 'step_complete', content: '',
        data: {
          ...baseEventData, step, isFinal: false,
          toolCalls: [{ id: 'failed-tool-call', name: 'tool_validation_failed', input: {}, output: `Invalid JSON in tool call: ${validationMessage}` }],
          agentId: agentName,
        },
        agentName,
      })

      const retryPrompt = `The previous tool call failed due to invalid JSON syntax. Error: ${validationMessage}\n\nPlease analyze what went wrong and retry the tool call with properly formatted JSON. Ensure:\n1. All string values are properly quoted with double quotes\n2. All object properties use valid JSON syntax\n3. No trailing commas in objects or arrays\n4. All brackets and braces are properly closed\n5. No undefined or null values are passed as tool arguments\n\nPlease try again with corrected formatting.`
      const retryMessages = [...messages, { role: 'user' as const, content: message }]
      try {
        return await invocation.runUnder(async () =>
          agent.streamGenerate(retryPrompt, {
            ...(contextMessages.length > 0 && { context: contextMessages }),
            messages: retryMessages,
            executionContext: executionContextWithTrace,
            ...(processedFiles && processedFiles.length > 0 && { files: processedFiles }),
            abortSignal,
          }),
        )
      } catch (retryError: unknown) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError)
        logger.error('sse.stream.retry.failure', { appId, message: retryMsg })
        invocation.endError(retryError)
        const budget = classifyStreamBudgetError(retryError)
        if (budget.type === 'budget_exceeded') {
          throw budget.budgetError
        }
        throw budget.error
      }
    }

    try {
      let streamResult: StreamResult & { isToolValidationError?: boolean; validationErrorMessage?: string }
      try {
        streamResult = await invocation.runUnder(async () =>
          agent.streamGenerate(message, {
            ...(contextMessages.length > 0 && { context: contextMessages }),
            ...(messages.length > 0 && { messages }),
            executionContext: executionContextWithTrace,
            ...(processedFiles && processedFiles.length > 0 && { files: processedFiles }),
            abortSignal,
          }),
        )
      } catch (generateError: unknown) {
        const budget = classifyStreamBudgetError(generateError)
        if (budget.type === 'budget_exceeded') {
          const streamErrInfo = analyzeStreamError(generateError)
          logger.error('sse.budget.exceeded.pre_stream', { appId, statusCode: streamErrInfo.statusCode, message: generateError instanceof Error ? generateError.message : String(generateError) })
          invocation.endError(generateError)
          throw budget.budgetError
        }

        const streamErrorInfo = analyzeStreamError(generateError)
        const classification = classifyError(generateError)
        const isToolValError = isToolValidationError(generateError)
        const errorMessage = generateError instanceof Error ? generateError.message : String(generateError)
        const errorName = generateError instanceof Error ? generateError.name : undefined

        if (!isToolValError) {
          logger.warn('sse.stream.generate.error', {
            appId, agentName,
            errorName,
            errorMessage,
            errorCode: streamErrorInfo.code,
            causeChain: streamErrorInfo.causeChain,
            statusCode: streamErrorInfo.statusCode,
            responseBody: streamErrorInfo.responseBody,
            isNetworkError: streamErrorInfo.isNetworkError,
            isAbortError: streamErrorInfo.isAbortError,
            classification: classification.category,
          })
        }

        if (isToolValError) {
          streamResult = await retryAfterToolValidation(errorMessage)
        } else {
          if (streamErrorInfo.statusCode === 400) {
            logger.warn('sse.llm.api.bad_request', {
              appId, agentName,
              statusCode: streamErrorInfo.statusCode,
              message: errorMessage,
              responseBodyLength: streamErrorInfo.responseBody?.length,
              category: classification.category,
              retryable: classification.retryable,
            })
          }
          if (!classification.retryable) {
            logger.warn('sse.stream.error.non_retryable', {
              category: classification.category || 'unknown',
              statusCode: classification.statusCode,
            })
          }
          invocation.endError(generateError)
          throw generateError
        }
      }

      if (streamResult?.isToolValidationError) {
        publish({
          conversationId, type: 'error',
          content: 'Tool call failed due to invalid input format. The agent is retrying with corrections.',
          data: {
            ...baseEventData,
            errorType: TOOL_VALIDATION_ERROR_TYPE,
            statusCode: 400,
            timestamp: new Date().toISOString(),
            details: streamResult.validationErrorMessage,
          },
          agentName,
        })
      }

      guard?.arm()
      invocation.captureMetadata(streamResult.response)
      captureResponseMetadata(streamResult.response, (meta) => {
        streamState.lastResponseMetadata = meta
      })

      const baseStream = streamResult.baseStream
      if (baseStream) {
        streamFirstReadMs = Date.now()
        const reader: ReadableStreamDefaultReader = (baseStream as ReadableStream).getReader()
        let readerReleased = false
        try {
          while (true) {
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
              break
            }
            let readResult: ReadableStreamReadResult<any>
            try {
              readResult = await reader.read()
            } catch (readError) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
              // Soft-commit a premature upstream close before the retryable
              // fallback — the socket is dead, so the textStream fallback below
              // would only fail again.
              if (handlePrematureClose(readError)) break

              const classification = classifyError(readError)
              if (!classification.retryable) throw readError

              logger.warn('sse.stream.base_stream.fallback', {
                appId, agentName,
                classification: classification.category,
                chunksRead: tracker.chunksRead,
                streamElapsedMs: tracker.streamElapsedMs,
              })
              reader.releaseLock()
              readerReleased = true

              await readTextStreamFallback({
                textStream: streamResult.textStream,
                abortSignal,
                onChunk: async (text) => {
                  processor.processPart({ type: 'text-delta', text })
                  await flushPendingWork()
                },
                tracker,
                guard: guard ?? undefined,
              })
              break
            }
            const { done, value } = readResult
            if (done) break
            tracker.recordChunk()
            guard?.reset()
            if (value?.part) {
              processor.processPart(value.part)
              await flushPendingWork()
            }
          }
        } finally {
          if (!readerReleased) reader.releaseLock()
          await flushPendingWork()
        }
      } else {
        try {
          for await (const chunk of streamResult.textStream) {
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
              break
            }
            tracker.recordChunk()
            guard?.reset()
            processor.processPart({ type: 'text-delta', text: chunk })
            await flushPendingWork()
          }
        } catch (textStreamError) {
          if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout() }
          else if (!handlePrematureClose(textStreamError)) throw textStreamError
        } finally {
          await flushPendingWork()
        }
      }

      const timingData: StreamTimingData = tracker.finalize()
      guard?.dispose()
      logger.info('sse.stream.timing', { appId, conversationId, agentName, ...timingData })

      // Restore the WS `stream.timing.summary` diagnostic as a first-class SSE
      // event for the gosym-probe eval's LatencyEvaluator (AIROBUILD-2681).
      // timeToStreamStartMs is the agent-init + LLM-connect time before the first
      // stream read (turnStartMs → streamFirstReadMs), mirroring the WS server's
      // processStreamStartMs − startTime.
      if (isDiagnosticsEnabled()) {
        this.publishNonTerminal(appId, conversationId, {
          conversationId,
          type: 'stream_timing_summary',
          content: '',
          agentName,
          data: {
            timeToStreamStartMs: streamFirstReadMs - turnStartMs,
            timeToFirstTextChunkMs: timingData.timeToFirstTextChunkMs,
            maxChunkGapMs: timingData.maxChunkGapMs,
            chunksRead: timingData.chunksRead,
            streamDurationMs: timingData.streamDurationMs,
          },
        })
      }

      let finishReason = 'complete'
      let finalResult: any
      let finalResultError: unknown
      if (chunkTimeoutFinishReason !== null) {
        // Soft-commit: the socket is dead, so getFinalResult() would block on
        // promises that never settle. Finalize from the captured finish frame
        // (if any) instead. No usage is captured on the 'incomplete' path —
        // the turn is effectively unbilled, matching today's terminated turn.
        finishReason = chunkTimeoutFinishReason
        const captured = processor.getFinishResult()
        finalResult = captured
          ? { finishReason: captured.finishReason, totalUsage: captured.totalUsage }
          : { finishReason }
      } else {
        try {
          finalResult = await streamResult.getFinalResult()
          finishReason = finalResult?.finishReason ?? 'complete'
        } catch (err) {
          // Preserve the legacy warn log + continue returning a result to the
          // caller, but do NOT let this fall through to invocation.endSuccess()
          // below — without usage and with no final result, the span would
          // misleadingly show a successful turn in Langfuse. Capture the error
          // and mark finishReason so the branch below ends the span as a
          // failure via invocation.endError. WS doesn't wrap getFinalResult at
          // all (its outer catch handles it); SSE keeps the wrap for callers
          // that inspect finishReason but surfaces the failure to telemetry.
          finalResultError = err
          const upstreamTimeout = isUpstreamTimeoutError(err)
          if ((isNetworkError(err) || upstreamTimeout) && processor.getAccumulatedContent().length > 0) {
            // Premature close or upstream 408/504 timeout while fetching the
            // final result, but content already streamed: soft-commit it. The
            // Langfuse span is still
            // recorded as endError below (it WAS an upstream failure), while
            // the wire-facing finishReason carried in the return is
            // 'incomplete' → client renders the gentle soft advisory.
            logger.warn('sse.execution.getFinalResult.premature_close', {
              appId, conversationId,
              trigger: upstreamTimeout ? 'upstream_timeout' : 'network_close',
              statusCode: (err as { statusCode?: number }).statusCode,
              ...errorFields(err),
            })
            finishReason = 'incomplete'
          } else if (abortSignal.aborted) {
            // An aborted turn (user_stopped / server_shutdown) rejects
            // getFinalResult with a non-network abort error — expected, not a
            // fetch failure. Log distinctly so result_fetch_failed (trusted by
            // the dashboard / sse-rollout-check.py) counts only genuine failures.
            logger.info('sse.execution.getFinalResult.aborted', {
              appId, conversationId,
              reason: String(abortSignal.reason ?? 'unknown'),
            })
            finishReason = 'aborted'
          } else {
            logger.warn('sse.execution.getFinalResult.failed', { appId, conversationId, ...errorFields(err) })
            finishReason = 'result_fetch_failed'
          }
        }
      }

      const finalMetadata: ResponseMetadata = await invocation.awaitMetadata(streamResult.response)

      logger.info('llm.response.metadata', {
        ...(appId !== undefined && { appId }),
        ...(conversationId !== undefined && { conversationId }),
        ...(finalMetadata.responseId !== undefined && { responseId: finalMetadata.responseId }),
        ...(finalMetadata.modelId !== undefined && { modelId: finalMetadata.modelId }),
        ...(finalMetadata.headers?.['x-correlation-id'] && { correlationId: finalMetadata.headers['x-correlation-id'] }),
        ...(finishReason !== undefined && { finishReason }),
      })

      const { accumulatedContent, currentStep } = processor.getState()
      const responseType: 'llm_reply' | 'tool_call' = accumulatedContent ? 'llm_reply' : 'tool_call'
      const invocationResponseData = buildInvocationToolResponseData(turnSnapshot, toolIdsBeforeInvocation)

      if (abortSignal.aborted) {
        // chunk_timeout soft-commit also lands here (the signal is aborted):
        // the Langfuse span is honestly recorded as aborted, while the
        // wire-facing finishReason ('incomplete'/'stop') is carried via the
        // returned value and published as a `complete` event by the outer flow.
        invocation.endAborted({
          outputText: accumulatedContent,
          responseType,
          ...(invocationResponseData !== undefined && { responseData: invocationResponseData }),
        })
      } else if (finalResultError !== undefined) {
        invocation.endError(finalResultError, { finishReason })
      } else if (prematureCloseError !== undefined) {
        // Premature close caught mid-stream: honest error span, soft wire reason.
        invocation.endError(prematureCloseError, { finishReason })
      } else {
        const usageToTrack = finalResult?.totalUsage ?? finalResult?.usage
        // Per-LLM-call token observability (cost/cache logs + APM) via
        // recordTokenUsageObservability. Returns the estimated cost so the
        // Langfuse invocation span carries it.
        let totalCost: number | undefined
        if (usageToTrack) {
          const usage = buildTokenUsage(usageToTrack)
          const { totalCost: cost } = recordTokenUsageObservability({
            usage,
            metadata: { appId, agentName, modelName, conversationId },
            apmTracker: this.deps.conversationPersistence,
            logger,
            eventPrefix: 'sse.token_usage',
          })
          totalCost = cost
          // Restore the WS `token.usage.summary` diagnostic as a first-class SSE
          // event for the gosym-probe eval's token-usage collector (AIROBUILD-2681).
          // The cost breakdown is computed only inside this flag branch to avoid a
          // redundant calculateCostEstimate on the production path.
          if (isDiagnosticsEnabled()) {
            const costEstimate = calculateCostEstimate(usage, modelName)
            this.publishNonTerminal(appId, conversationId, {
              conversationId,
              type: 'token_usage_summary',
              content: '',
              agentName,
              data: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                ...(usage.cachedInputTokensRead !== undefined && { cachedInputTokensRead: usage.cachedInputTokensRead }),
                ...(usage.cachedInputTokensWrite !== undefined && { cachedInputTokensWrite: usage.cachedInputTokensWrite }),
                modelName,
                totalCost: costEstimate.totalCost,
                inputCost: costEstimate.inputCost,
                outputCost: costEstimate.outputCost,
                ...(costEstimate.cachedInputCost !== undefined && { cachedInputCost: costEstimate.cachedInputCost }),
                savings: costEstimate.savings,
                currency: costEstimate.currency,
              },
            })
          }
        }
        invocation.endSuccess({
          outputText: accumulatedContent,
          responseType,
          ...(usageToTrack && { usage: usageToTrack }),
          finishReason,
          ...(totalCost !== undefined && { totalCost }),
          ...(invocationResponseData !== undefined && { responseData: invocationResponseData }),
        })
      }

      return {
        accumulatedContent,
        currentStep,
        finalResult,
        finishReason,
        responseMetadata: finalMetadata,
        steps: Array.isArray(finalResult?.steps) ? finalResult.steps : [],
      }
    } catch (err) {
      streamState.lastTrackerSnapshot = { chunksRead: tracker.chunksRead, streamElapsedMs: tracker.streamElapsedMs }
      if (BudgetExceededError.isInstance(err)) {
        invocation.endError(err, { finishReason: 'budget_exceeded' })
      } else {
        invocation.endError(err)
      }
      throw err
    } finally {
      guard?.dispose()
    }
  }

  private createChunkTimeoutGuard(
    abortController: AbortController,
    socketId: string,
    agentName: string,
    modelName: string,
  ): ChunkTimeoutGuard | null {
    if (this.chunkTimeoutMs == null || this.chunkTimeoutMs <= 0) {
      return null
    }
    return new ChunkTimeoutGuard(
      {
        abortController,
        logger,
        socketId,
        agentName,
        modelName,
      },
      this.chunkTimeoutMs,
    )
  }

  async execute(params: ExecuteParams): Promise<void> {
    const turn = this.runTurn(params)
    // Register the turn so shutdown() awaits its finalization (persistence +
    // budget report) before the process closes the DB. The .catch keeps the
    // tracking-chain rejection from surfacing as an unhandled rejection; the
    // returned `turn` is still the un-caught promise, so the route's own .catch
    // (and awaiting callers/tests) observe failures unchanged.
    this.inFlightTurns.set(turn, params.conversationId)
    void turn.catch(() => {}).finally(() => this.inFlightTurns.delete(turn))
    return turn
  }

  private async runTurn(params: ExecuteParams): Promise<void> {
    // Build the Signals/OTEL trace context from HTTP headers + JWT early, so
    // every span emitted during this turn (AI SDK LLM spans, tool spans, the
    // agent-invocation span below) inherits the same traceparent. Without
    // this wrap, SSE turns produce orphan spans that never land on the
    // conversation's Langfuse trace, which is exactly the failure Synthia
    // surfaces as "No traces found in Langfuse for conversationId: …".
    const jwtCtx = params.lifecycleContext?.agentContext
    const traceCtx = buildChatSignalsTraceContext({
      ...(params.requestHeaders !== undefined && { headers: params.requestHeaders }),
      ...(jwtCtx && {
        jwtAgentContext: {
          ...(jwtCtx.customerId !== undefined && { customerId: jwtCtx.customerId }),
          ...(jwtCtx.visitorId !== undefined && { visitorId: jwtCtx.visitorId }),
          ...(jwtCtx.trafficSessionId !== undefined && { trafficSessionId: jwtCtx.trafficSessionId }),
        },
      }),
      ...(params.appId.length > 0 && { appId: params.appId }),
      ...(params.fullStorySessionId !== undefined && { fullStorySessionId: params.fullStorySessionId }),
      logPrefix: 'sse',
      logFields: { appId: params.appId, conversationId: params.conversationId },
      logger: { warn: (event, fields) => logger.warn(event, fields) },
    })
    const turnSnapshot: TurnSnapshotState = { streamingEvents: [] }
    const getTurnEndFields = () => {
      const outputText = extractTurnOutputFromEvents(turnSnapshot.streamingEvents)
      const responseData = extractTurnToolResponseDataFromEvents(turnSnapshot.streamingEvents)
      return {
        ...(outputText !== '' && { outputText }),
        ...(responseData !== undefined && { responseData }),
      }
    }
    await otelContext.with(traceCtx, async () => {
      await runAgentTurnSpan(
        {
          inputText: params.content,
          conversationId: params.conversationId,
          specialistKey: params.agentId,
          logger: { warn: (event, fields) => logger.warn(event, fields) },
          getTurnEndFields,
        },
        () => this.executeUnderTrace(params, turnSnapshot),
      )
    })
  }

  /**
   * Emit the OTel conversation-start event on the first turn of a conversation.
   *
   * Intentionally duplicates the WS emit in conversation-persistence.ts
   * `startConversation` (gated on `isNewConversation`), which SSE never reaches —
   * SSE always continues a conversation row already created by `POST /:appId`.
   * There is no shared seam: WS creates the conversation inline during the turn,
   * SSE splits creation and execution across two requests with two trace contexts.
   *
   * Caller MUST be inside `execute`'s `otelContext.with(traceCtx, ...)` scope:
   * `emitConversationStart` no-ops without an active span and otherwise binds to
   * the turn's trace id (as WS does). Emitting from `POST /:appId` would bind it
   * to the wrong trace or drop it. `isInitialPrompt` is SSE's first-turn signal.
   *
   * Must stay a method called as a single statement — an inline `if` in
   * `executeUnderTrace` trips tsc (TS2304 "Cannot find name 'this'") on the
   * `typeof this.streamAgentTurn` type query later in that method.
   */
  private emitConversationStartIfFirstTurn(
    lifecycleContext: LifecycleContext | undefined,
    conversationId: string,
    specialistKey: string,
  ): void {
    if (!lifecycleContext?.isInitialPrompt) return
    emitConversationStart({
      conversationId,
      specialistKey,
    })
  }

  /**
   * Run the forced design-kit install once before the agent loop and decide
   * whether to stream the tool-less `-attached` variant. We only swap to it when
   * the install actually produced messages — on install failure (or when no
   * `-attached` sibling is registered) the normal variant runs, which can still
   * auto-select rather than being stranded with a "kit already installed" prompt
   * and no recovery tools. Returns the install messages to prepend on turn 1.
   */
  private async prepareForcedDesignKit(opts: {
    resolvedAgentId: string
    designKitSlug: string | undefined
    appId: string
    conversationId: string
    isInitialPrompt: boolean
    customerId?: string
  }): Promise<{ forcedKitMessages: Array<{ role: string; content: unknown }>; useAttachedVariant: boolean; effectiveAgentId: string }> {
    const { resolvedAgentId, designKitSlug, appId, conversationId, isInitialPrompt, customerId } = opts
    if (!isInitialPrompt || !designKitSlug) return { forcedKitMessages: [], useAttachedVariant: false, effectiveAgentId: resolvedAgentId }

    // Resolve the agent whose toolset/config drives the install. Safe against the
    // factory's throw-on-unknown-id, and against the resolved agent already being
    // the `-attached` variant (frozen there for the whole build — see the
    // design-kit finalize in sse/routes.ts), which must not be double-suffixed.
    const { agent: installAgent, hasAttachedSibling } = pickForcedInstallAgent({
      resolvedAgentId, getAgent: (id) => this.deps.getAgent(id),
    })
    const installConfig = installAgent?.getConfig?.()
    let forcedKitMessages: Array<{ role: string; content: unknown }> = []
    if (installConfig) {
      try {
        forcedKitMessages = await enrichWithForcedDesignKit({
          designKitSlug, appId, agentConfig: installConfig, transport: 'sse', logger, customerId,
        })
      } catch (error) {
        logger.warn('design_kit.forced_install.skipped', { reason: 'unexpected error', designKitSlug, appId, ...errorFields(error) })
      }
    }
    // Only swap the turn agent when a SIBLING -attached variant exists (resolved
    // agent was the base variant). When already frozen on -attached, no swap.
    const useAttachedVariant = hasAttachedSibling && forcedKitMessages.length > 0
    if (useAttachedVariant) {
      logger.info('design_kit.attached_variant.substituted', { resolvedAgentId, appId, transport: 'sse' })
    }

    // Recovery: SSE freezes the conversation to the `-attached` variant at create
    // (sse/routes.ts) BEFORE this install runs, and the freeze is not gated on
    // install success. If the forced install then produced nothing (slug not found /
    // workspace unavailable / threw), the frozen `-attached` variant has no
    // select/install tools and a prompt asserting a kit is installed — it would build
    // on a false premise. Fall back to the BASE variant for THIS turn so it can
    // auto-select instead of being stranded, and PERSIST the revert so later turns
    // don't resurrect the frozen variant: the base variant parks at the Phase-1
    // interview (no handoff), and turn 2+ early-returns above (isInitialPrompt=false),
    // so without persistence it would run the stale `-attached` with no kit on disk.
    // See AIROBUILD-2072.
    let effectiveAgentId = resolvedAgentId
    if (resolvedAgentId.endsWith('-attached') && forcedKitMessages.length === 0) {
      const baseAgentId = resolvedAgentId.slice(0, -'-attached'.length)
      let baseExists = false
      try { baseExists = !!this.deps.getAgent(baseAgentId) } catch { baseExists = false }
      if (baseExists) {
        effectiveAgentId = baseAgentId
        // Revert BOTH stores the route freeze wrote to, or the revert is shadowed:
        //  - persistAgentId → ConversationLifecycleStore (the persisted agent)
        //  - stateManager.switchAgent → the warm session cache, which the agent
        //    router consults FIRST (agent-router.ts step 1, before the store). Without
        //    this, turn 2+ resolves the stale -attached from the session cache.
        // Best-effort: a failed write still recovers the current turn via effectiveAgentId.
        try {
          await this.deps.persistAgentId?.(conversationId, baseAgentId)
        } catch (persistErr) {
          logger.warn('design_kit.forced_install.revert_persist_failed', {
            appId, conversationId, baseAgentId, ...errorFields(persistErr),
          })
        }
        try {
          await this.deps.stateManager.switchAgent?.(sseSessionKey(conversationId), baseAgentId)
        } catch (sessionErr) {
          logger.warn('design_kit.forced_install.revert_session_failed', {
            appId, conversationId, baseAgentId, ...errorFields(sessionErr),
          })
        }
        logger.error('design_kit.forced_install.recovered_to_base', {
          appId, conversationId, designKitSlug, frozenAgentId: resolvedAgentId, fallbackAgentId: baseAgentId,
          reason: 'forced install produced no messages; reverted to base variant (current turn + persisted) so it can auto-select instead of building on a missing kit',
        })
      } else {
        logger.error('design_kit.forced_install.stranded', {
          appId, conversationId, designKitSlug, frozenAgentId: resolvedAgentId,
          reason: 'forced install produced no messages and base variant unavailable; build proceeds on -attached with no installed kit',
        })
      }
    }

    return { forcedKitMessages, useAttachedVariant, effectiveAgentId }
  }

  private async executeUnderTrace(params: ExecuteParams, turnSnapshot: TurnSnapshotState): Promise<TurnExecutionResult> {
    // Start of message handling — anchors the stream_timing_summary diagnostic's
    // timeToStreamStartMs (agent init + LLM-connect time before the first stream
    // read). Mirrors the WS server's per-message startTime.
    const turnStartMs = Date.now()
    const {
      appId, conversationId, content, siteId, agentId,
      templateId, modelOverride, rebuildBuildPageSlug, rebuildDesignDirection,
      visualContext, aiEditContext, aiEditContexts, selectedAssets,
      todoListContext, isActionRequest, customContext, buildErrorContext,
      bmsBudgetId, budgetSessionId, subscriptionId, authType,
      lifecycleContext, uploadedFileName, market, userTimezone, requestId, apmTransaction,
      designKitSlug,
    } = params

    const resolvedAgentId = agentId
    let turnResult: TurnExecutionResult = { success: false }
    const sseSocketId = sseSessionKey(conversationId)
    const agentCtx = lifecycleContext?.agentContext
    const enableAssessmentAgent = !!agentCtx?.enableAssessmentAgent
    const enableAssessmentOverride = !!agentCtx?.enableAssessmentOverride

    // LR classifier is only available for BMS users. If the flag requests LR but BMS is
    // not enabled, fall back to undefined (resolves to CosineSimilarity in classify()).
    const effectiveClassifierMode: ClassifierMode | undefined = agentCtx?.assessmentClassifier === ClassifierMode.LogisticRegression && agentCtx?.budgetServiceEnabled !== true
      ? undefined
      : agentCtx?.assessmentClassifier

    logger.info('assessment.feature_flag', {
      appId,
      sessionKey: sseSessionKey(conversationId),
      enableAssessmentAgent,
      enableAssessmentOverride,
      assessmentClassifier: agentCtx?.assessmentClassifier,
      effectiveClassifierMode,
      budgetServiceEnabled: agentCtx?.budgetServiceEnabled,
    })

    // Run message-start hooks (git branch + assessment classification).
    // Failures are logged inside the helpers; neither throws out of here.
    //
    // Cost attribution is driven by the post-turn BMS report (when BMS is active)
    // or by mid-stream grant recovery (when in grants mode). We fire the classifier
    // non-blocking and await it right before runMessageEndHooks / safeProcessBudgetReport.
    let assessmentOutcome: AssessmentOutcome | undefined
    let assessmentHandle: ParallelAssessmentHandle | undefined
    if (this.deps.lifecycle) {
      // Fire the classifier first so it overlaps the git hook's branch creation.
      assessmentHandle = startParallelAssessment(this.deps.lifecycle, {
        appId,
        sessionKey: sseSocketId,
        message: content,
        customerId: agentCtx?.customerId,
        isInitialPrompt: !!lifecycleContext?.isInitialPrompt,
        enableAssessmentAgent,
        enableAssessmentOverride,
        classifierMode: effectiveClassifierMode,
      })
      await runStartGitHook(this.deps.lifecycle, {
        appId, conversationId, sessionKey: sseSocketId, message: content,
      })
    }

    const contextAttachments = buildContextAttachments({
      aiEditContext,
      aiEditContexts,
      visualContext,
      selectedAssets,
      todoListContext,
      isActionRequest,
      customContext,
      buildErrorContext,
    })
    const persistableContextAttachments = contextAttachments.filter(
      attachment => attachment.persistence === 'save',
    )

    const persistenceContext: SSEPersistenceContext = {
      socketId: sseSocketId,
      agentName: resolvedAgentId,
      appId,
      siteId,
      conversation: { conversationId },
      metadata: {
        authType,
        ...(agentCtx?.customerId && { customerId: agentCtx.customerId }),
      },
    }
    // Keep ephemeral turn-only context out of initial user-message history; the
    // persistence layer remains the final save-only boundary for all callers.
    const initialPersistenceContext: SSEPersistenceContext = persistableContextAttachments.length > 0
      ? { ...persistenceContext, contextAttachments: persistableContextAttachments }
      : persistenceContext

    this.deps.resetPostStreamRetries?.(sseSocketId)

    this.abortControllers.get(conversationId)?.abort()

    // Bridge sseRegistry → eventChannel BEFORE pre-turn persistence runs. If we
    // bridge after, a persistence failure publishes terminal events to an empty
    // eventChannel and the /stream client hangs forever.
    const streamState: ActiveStream = { appId, convId: conversationId, subscriberIds: new Set(), ...(requestId && { requestId }), apmTransaction }
    this.activeStreams.set(conversationId, streamState)
    if (apmTransaction) apmTransaction.setLabel('agent_name', resolvedAgentId)
    const sseSubscribers = this.deps.sseRegistry.getSubscribers(conversationId)
    for (const sub of sseSubscribers) {
      this.deps.eventChannel.subscribe(conversationId, sub)
      streamState.subscriberIds.add(sub.id)
    }

    this.emitConversationStartIfFirstTurn(lifecycleContext, conversationId, resolvedAgentId)

    let activeAgentMessageId: string | undefined
    const openedAgentMessageIds = new Set<string>()
    try {
      await this.deps.conversationPersistence.continueConversation(conversationId, content, initialPersistenceContext)
      activeAgentMessageId = await this.deps.conversationPersistence.startAgentTurn(conversationId, initialPersistenceContext)
      openedAgentMessageIds.add(activeAgentMessageId)
    } catch (err) {
      // Persistence failures (SQLITE_BUSY, disk-full, schema mismatch) happen
      // before any stream state is registered — emit a terminal error event
      // and return so the SSE client doesn't hang waiting for a response.
      const message = err instanceof Error ? err.message : String(err)
      logger.error('sse.execution.persistence_pre_turn_failed', { appId, conversationId, ...errorFields(err) })
      await this.publishTerminal(appId, conversationId, {
        type: 'error', content: message,
        data: { error: message, timestamp: new Date().toISOString() },
        conversationId, agentName: 'system',
      })
      await this.publishTerminal(appId, conversationId, {
        type: 'complete', content: '', data: { finishReason: 'error', ...getCurrentTraceIds() },
        conversationId, agentName: 'system',
      })
      if (this.activeStreams.get(conversationId) === streamState) {
        for (const subId of streamState.subscriberIds) {
          this.deps.eventChannel.unsubscribe(conversationId, subId)
        }
        this.activeStreams.delete(conversationId)
      }
      if (apmTransaction) {
        apmTransaction.setLabel('finishReason', 'persistence_pre_turn_failed')
        apmTransaction.result = 'error'
        apmTransaction.setOutcome('failure')
        apmTransaction.end()
        this.markApmTransactionEnded(apmTransaction)
      }
      turnResult = { success: false, error: err }
      return turnResult
    }

    const abortController = new AbortController()
    this.abortControllers.set(conversationId, abortController)

    const clientActionService = new SSEClientActionService(conversationId, appId, this.deps.eventChannel)
    registerActionService(sseSocketId, clientActionService)

    // Resolve appPath so tools (e.g. runAgent) can access the filesystem path
    const appPath = (() => {
      try {
        const appRepo = new AppRepository()
        return appRepo.findById(appId)?.path
      } catch { return undefined }
    })()

    // Shared execution context - tools modify this in-place (e.g. __autoContinue)
    const executionContext: Record<string, unknown> = {
      metadata: {
        sessionId: sseSocketId,
        appId, siteId, conversationId, templateId, modelOverride,
        agentId: resolvedAgentId,
        ...(appPath && { appPath }),
        ...(subscriptionId && { subscriptionId }),
        ...(agentCtx?.customerId && { customerId: agentCtx.customerId }),
        ...(agentCtx?.budgetServiceEnabled !== undefined && { budgetServiceEnabled: agentCtx.budgetServiceEnabled }),
        ...(bmsBudgetId && { bmsBudgetId, budgetServiceEnabled: true }),
        ...(agentCtx?.bmsBudgetId && !bmsBudgetId && { bmsBudgetId: agentCtx.bmsBudgetId }),
        ...(budgetSessionId && { budgetSessionId }),
        ...(uploadedFileName && { uploadedFileName }),
        ...(designKitSlug && { designKitSlug }),
        ...((agentCtx?.market ?? market) && { market: agentCtx?.market ?? market }),
        ...(userTimezone && { userTimezone }),
        permissions: {
          canDownload: agentCtx?.canDownload ?? false,
          canPublish: agentCtx?.canPublish ?? false,
          canPurchaseDomain: agentCtx?.canPurchaseDomain ?? false,
        },
        isE2S: agentCtx?.isE2S ?? false,
        authType,
        marketingCampaignsEnabled: agentCtx?.marketingCampaignsEnabled ?? false,
        ...(agentCtx?.useTestBudget !== undefined && { useTestBudget: agentCtx.useTestBudget }),
        ...(agentCtx?.useAtlasCrawler && { useAtlasCrawler: true }),
        ...(agentCtx?.rebuildIntakeFormEnabled && { rebuildIntakeFormEnabled: true }),
        ...(agentCtx?.skillSuggestionsEnabled && { skillSuggestionsEnabled: true }),
        ...(rebuildDesignDirection && { rebuildDesignDirection }),
        // isRebuildFlow is SSE-only — WS handoff re-spreads client metadata and would drop it.
        ...(rebuildBuildPageSlug && { rebuildBuildPageSlug, isRebuildFlow: true }),
        ...(content && { _userMessage: content }),
        ...(agentCtx?.marketingCampaignsEnabled && { marketingCampaignsEnabled: true }),
      },
      ...(contextAttachments.length > 0 && { contextAttachments }),
      todoListContext, isActionRequest, customContext,
    }

    // Inject event emitter for sub-agent streaming events (used by runAgent tool).
    const execMeta = executionContext.metadata as Record<string, unknown>
    execMeta.eventEmitter = {
      emit: (type: string, data: unknown): void => {
        if (type === 'subagent_event') {
          this.publishNonTerminal(appId, conversationId, {
            conversationId,
            type: 'subagent_event',
            content: '',
            data: data as Record<string, unknown>,
            agentName: (data as Record<string, unknown>)?.agent as string ?? '',
          })
        } else if (type === 'debug_turn_stats') {
          this.publishNonTerminal(appId, conversationId, {
            conversationId,
            type: 'debug_turn_stats',
            content: '',
            data: data as Record<string, unknown>,
            agentName: (data as Record<string, unknown>)?.agentName as string ?? '',
          })
        }
      },
    }

    // Resolve the agent profile from the JWT only — the BFF-resolved
    // switchboard/hivemind profile is the sole source. There is no per-message
    // client profile (the ProfileSelector was removed); model override still
    // honors its own per-project metadata + flag below.
    const profile = resolveProfile({
      agentProfileSelectorEnabled: false,
      perProjectProfile: undefined,
      jwtAgentProfile: agentCtx?.agentProfile,
    })
    if (profile) {
      logger.info('sse.profile.resolve.active', { profileName: profile.name, socketId: sseSocketId })
    }
    const effectiveOverride = resolveOverride({
      modelSelectorEnabled: !!agentCtx?.modelSelectorEnabled,
      perProjectModel: modelOverride,
      jwtModelOverride: agentCtx?.modelOverride,
    })

    // Set session metadata so handoff tool can find the session
    this.deps.stateManager.setSessionMetadata(sseSocketId, { appId })

    // Budget recovery for grants-mode (non-BMS) sessions.
    // Use budgetServiceEnabled from JWT as the authoritative signal (matches WebSocket semantics).
    const budgetServiceEnabled = agentCtx?.budgetServiceEnabled === true
    const useGrantRecovery = !budgetServiceEnabled && !!subscriptionId
    const budgetRecoveryCallback = useGrantRecovery
      ? createGrantBudgetRecoveryCallback({ logger })
      : undefined
    if (useGrantRecovery) {
      grantSessionManager.registerSession(sseSocketId, subscriptionId!)
    }

    const allExecutionSteps: ExecutionStep[] = []
    let budgetReportFiled = false
    // Whether this turn's output was durably persisted. The budget report is
    // gated on it (success, error, and the finally fallback) so a turn is never
    // billed without its saved output — most relevant on shutdown, where the
    // persistence write and the report otherwise race process exit independently.
    let turnPersisted = false
    const turnOutputText = (): string => extractTurnOutputFromEvents(turnSnapshot.streamingEvents)
    const turnResponseData = (): TurnExecutionResult['responseData'] =>
      extractTurnToolResponseDataFromEvents(turnSnapshot.streamingEvents)

    // Forced design-kit install (gallery selection): run it ONCE here, before the
    // loop, so the `-attached` variant swap can be gated on the install actually
    // succeeding. Extracted to a method because an inline `if` here trips tsc on
    // the `typeof this.streamAgentTurn` query below (see emitConversationStartIfFirstTurn).
    const { forcedKitMessages, useAttachedVariant, effectiveAgentId } = await this.prepareForcedDesignKit({
      resolvedAgentId, designKitSlug, appId, conversationId, isInitialPrompt: lifecycleContext?.isInitialPrompt ?? false,
      customerId: agentCtx?.customerId,
    })

    try {
      let lastTurnResult: Awaited<ReturnType<typeof this.streamAgentTurn>> | undefined
      let currentIteration = 0

      // Deterministic rebuild "Build Page" (AIROBUILD-2104): substitute the
      // agent-facing content with the source-built page prompt. Runs after
      // continueConversation above, so the persisted/displayed user message
      // stays the original text; only the agent loop input is replaced. This is
      // the SSE-transport counterpart of the WS getEffectiveAgentMessage hook.
      const rebuildResolution = rebuildBuildPageSlug
        ? await resolveRebuildBuildPagePrompt({ metadata: { appId, rebuildBuildPageSlug } })
        : undefined
      const agentContent = rebuildResolution?.prompt ?? content
      // Surface the deterministic rebuild as a real tool lifecycle (card + analytics).
      // Wire-only: not persisted to conversation history (Slice 1 scope).
      if (rebuildResolution) {
        await emitRebuildBuildPageToolLifecycle(
          rebuildResolution.confirmation,
          (event) => this.publishNonTerminal(appId, conversationId, { conversationId, ...event }),
        )
        logger.info('rebuild.build_page.tool_lifecycle_emitted', {
          appId, conversationId, pageSlug: rebuildResolution.confirmation.pageSlug,
        })
      }

      // effectiveAgentId differs from resolvedAgentId only on the forced-install
      // recovery path (frozen to -attached but install produced nothing): run the
      // base variant this turn so it can auto-select. Normally they are identical.
      const runLoop = () => executeAgentLoop(effectiveAgentId, agentContent, {
        getAgent: (name) => resolveTurnAgent({
          name, resolvedAgentId: effectiveAgentId, useAttachedVariant, getAgent: (id) => this.deps.getAgent(id),
        }),
        streamAgentTurn: async (agent, agentName, message, iteration) => {
          currentIteration = iteration
          const meta = executionContext.metadata as Record<string, unknown>
          meta.agentId = agentName
          // Mark handoff/auto-continue turns so the upload renderers skip
          // re-classifying the same attachment against a non-user prompt.
          // iteration 0 is the user's own message → classify fresh.
          meta.__isContinuationTurn = iteration > 0
          if (iteration > 0) {
            persistenceContext.agentName = agentName
            try {
              activeAgentMessageId = undefined
              activeAgentMessageId = await this.deps.conversationPersistence.startAgentTurn(conversationId, persistenceContext)
              openedAgentMessageIds.add(activeAgentMessageId)
            } catch (err) {
              logger.error('sse.execution.persistence_handoff_turn_failed', {
                appId, conversationId, iteration, agentName, ...errorFields(err),
              })
              throw err
            }
          }

          const doStream = async (prompt: string) => this.streamAgentTurn(agent, agentName, prompt, {
            conversationId, appId, sseSocketId,
            abortController,
            executionContext, persistenceContext, streamState, agentMessageId: activeAgentMessageId,
            turnSnapshot,
            forcedKitMessages,
            turnStartMs,
            ...(params.fullStorySessionId !== undefined && { fullStorySessionId: params.fullStorySessionId }),
          })

          if (budgetRecoveryCallback) {
            lastTurnResult = await withBudgetRecovery(doStream, message, agentName, {
              sessionId: sseSocketId,
              onBudgetExhausted: budgetRecoveryCallback,
              setUserId: (newUserId: string) => {
                const meta = executionContext.metadata as Record<string, unknown>
                meta.user = newUserId
              },
              getExecutedToolNames: () => {
                const erroredToolIds = new Set(
                  turnSnapshot.streamingEvents
                    .filter((e) => e.type === 'tool_result' && e.data?.tool?.is_error)
                    .map((e) => e.data.tool.id as string),
                )
                return turnSnapshot.streamingEvents
                  .filter((e) => e.type === 'tool_start' && e.data?.tool?.name && !erroredToolIds.has(e.data.tool.id as string))
                  .map((e) => e.data.tool.name as string)
              },
              getAccumulatedContent: () => turnSnapshot.streamingEvents
                .filter((e) => e.type === 'chunk')
                .map((e) => e.content ?? '')
                .join(''),
              clearTurnState: () => { turnSnapshot.streamingEvents.length = 0 },
              publishStreamRetry: async (name: string) => {
                if (this.activeStreams.get(conversationId) !== streamState) {
                  logger.info('sse.execution.superseded.skip_stream_retry', {
                    appId,
                    conversationId,
                    ...(requestId && { requestId }),
                  })
                  return
                }
                await this.publishNonTerminal(appId, conversationId, {
                  conversationId,
                  type: 'stream_retry',
                  content: '',
                  data: {
                    reason: 'budget_exceeded_grant_advanced',
                    agentName: name,
                    ...(requestId && { requestId }),
                  },
                  agentName: name,
                })
              },
              logger,
            })
          } else {
            lastTurnResult = await doStream(message)
          }

          if (lastTurnResult?.steps?.length) {
            allExecutionSteps.push(...lastTurnResult.steps)
          }

          const iterationUsage = lastTurnResult?.finalResult?.totalUsage ?? lastTurnResult?.finalResult?.usage
          if (agentCtx?.debugStatsEnabled && iterationUsage) {
            const iterAgent = this.deps.getAgent(agentName)
            const iterModelName: string = iterAgent?.getConfig?.()?.modelName ?? agentCtx.modelOverride ?? 'unknown'
            const iterInputTokens = iterationUsage.promptTokens ?? iterationUsage.inputTokens ?? 0
            const iterOutputTokens = iterationUsage.outputTokens ?? 0
            const iterTotalTokens = iterationUsage.totalTokens ?? (iterInputTokens + iterOutputTokens)
            const iterCachedInput = iterationUsage.cachedInputTokens ?? iterationUsage.inputTokenDetails?.cacheReadTokens ?? 0
            const iterCacheWrite = iterationUsage.inputTokenDetails?.cacheWriteTokens ?? 0

            const iterPayload = computeDebugTurnStats({
              conversationId,
              agentName,
              modelName: iterModelName,
              inputTokens: iterInputTokens,
              outputTokens: iterOutputTokens,
              totalTokens: iterTotalTokens,
              cachedInputTokens: iterCachedInput,
              cacheWriteInputTokens: iterCacheWrite,
            })

            this.publishNonTerminal(appId, conversationId, {
              conversationId,
              type: 'debug_turn_stats',
              content: '',
              data: iterPayload as unknown as Record<string, unknown>,
              agentName,
            })
          }
        },
        getAutoContinuation: () => {
          const meta = executionContext.metadata as any
          if (meta?.__autoContinue === true) {
            const prompt = (meta.__continuationPrompt as string) || 'Continue processing'
            delete meta.__autoContinue
            delete meta.__continuationPrompt
            return { prompt }
          }
          return null
        },
        getHandoffDetails: (currentAgent) => {
          const current = this.deps.stateManager.getCurrentAgent(sseSocketId)
          if (!current || current === currentAgent) return null
          const prompt = this.deps.stateManager.getLastHandoffPrompt(sseSocketId) || 'Continue'
          this.deps.stateManager.clearLastHandoffPrompt(sseSocketId)
          return { newAgentName: current, handoffPrompt: prompt }
        },
        onHandoff: async (oldAgent, newAgent) => {
          logger.info('sse.handoff.detected', { conversationId, appId, fromAgent: oldAgent, toAgent: newAgent })
          interactiveSubAgentManager.handleHandoff(sseSocketId, oldAgent, newAgent)
          try {
            await this.deps.onAgentChanged?.(conversationId, oldAgent, newAgent, appId)
          } catch (err) {
            logger.error('sse.handoff.agent_changed_failed', {
              appId, conversationId, fromAgent: oldAgent, toAgent: newAgent, ...errorFields(err),
            })
            throw err
          }
        },
        isAborted: () => abortController.signal.aborted,
        ...(this.deps.postStreamValidator && {
          postStreamValidate: async (agentName) => {
            const meta = (executionContext.metadata as Record<string, unknown> | undefined) ?? {}
            if (meta.__autoContinue === true) return
            const toolCalls = turnSnapshot.streamingEvents
              .filter((e: any) => e.type === 'tool_start' && e.data?.tool)
              .map((e: any) => ({ toolName: e.data.tool.name, args: e.data.tool.input }))

            // Forward `stopAfterTools` to the validator so it can apply the
            // combined gate (skip iff stop-after AND clean tree).
            const agent = this.deps.getAgent(agentName)
            const stopAfterTools = agent?.getConfig?.()?.stopAfterTools

            const result = await runPostStreamValidation({
              validator: this.deps.postStreamValidator!,
              socketId: sseSocketId,
              agentName,
              context: executionContext,
              toolCalls,
              abortSignal: abortController.signal,
              iteration: currentIteration,
              ...(stopAfterTools !== undefined && { stopAfterTools }),
              emitChunk: async (text) => {
                if (!text) return
                await this.publishNonTerminal(appId, conversationId, {
                  conversationId, type: 'chunk', content: text, data: {}, agentName,
                })
              },
              publishValidationMessage: async (content, data: ValidationMessageEventData) => {
                await this.publishNonTerminal(appId, conversationId, {
                  conversationId,
                  type: 'validation_message',
                  content,
                  data: data as unknown as Record<string, unknown>,
                  agentName,
                })
                // Deliberate divergence from WS (which returns sequence !== undefined):
                // publishNonTerminal → guardedPublish has an internal .catch, so the
                // await always resolves and no delivery signal is available. SSE's
                // replay buffer means missed running-events still reach reconnecting
                // clients, so gating terminal statuses on delivery is unnecessary.
                return true
              },
              persistValidationMessage: async (continuationPrompt) => {
                return await this.deps.conversationPersistence.continueConversation(
                  conversationId,
                  continuationPrompt,
                  {
                    ...persistenceContext,
                    messageMetadata: {
                      source: 'post_stream_validator',
                      displayAs: 'validation',
                      validationStatus: 'failed',
                    },
                  },
                )
              },
              logger,
              logContext: { appId, conversationId },
            })

            if (result) {
              meta.__autoContinue = true
              meta.__continuationPrompt = result.continuationPrompt
              executionContext.metadata = meta
            }
          },
        }),
      }, {
        conversationId,
        onTelemetryError: (event, fields) => logger.warn(event, fields),
      })

      const runWithOverride = async () => {
        if (effectiveOverride) {
          const allowed = guardAllowedOverrideModel(
            effectiveOverride, 'sseMessageMiddleware',
            (event, data) => logger.warn(event, data),
          )
          if (allowed) {
            logger.info('sse.model.override.context.active', { effectiveOverride: allowed, socketId: sseSocketId })
            return runWithModelOverride(allowed, runLoop)
          }
        }
        return runLoop()
      }

      // Extend BusinessContext with profile + market when set so they ride
      // through every child createAgentContext / span as `business_data_*` in
      // Langfuse trace metadata. The parent BusinessContext (appId etc.) set
      // by buildChatSignalsTraceContext is preserved by merging. The schema
      // at BUSINESS_CONTEXT_SCHEMA_ID must list these fields before they
      // actually surface in Langfuse.
      const profileTag = profile?.name
      const marketTag = typeof market === 'string' && market.length > 0 ? market : undefined
      const extendedCtx = (profileTag || marketTag)
        ? (() => {
            const inherited = getBusinessContext(otelContext.active())
            return setBusinessContext(otelContext.active(), {
              schemaId: inherited?.schemaId ?? BUSINESS_CONTEXT_SCHEMA_ID,
              data: {
                ...(inherited?.data ?? {}),
                ...(profileTag && { profile: profileTag }),
                ...(marketTag && { market: marketTag }),
              },
            })
          })()
        : undefined

      const runner = extendedCtx
        ? () => otelContext.with(extendedCtx, runWithOverride)
        : runWithOverride

      const loopResult = profile
        ? await runWithProfile(profile, runner)
        : await runner()

      const finalAgentName = loopResult.finalAgentName
      // A chunk_timeout soft-commit aborts the controller but is NOT a turn
      // abort: it produced content (or saw a finish frame) and should finalize
      // as a normal completion carrying its own finishReason ('incomplete' or
      // 'stop'), not 'aborted'. Keep end-hooks/budget on the non-aborted path.
      const chunkTimeoutSoftCommit =
        abortController.signal.reason === 'chunk_timeout'
        && (lastTurnResult?.finishReason === 'incomplete' || lastTurnResult?.finishReason === 'stop')
      const loopAborted =
        (loopResult.termination === 'aborted' || abortController.signal.aborted)
        && !chunkTimeoutSoftCommit
      const finishReason = loopAborted ? 'aborted' : (lastTurnResult?.finishReason ?? 'complete')

      if (loopResult.termination === 'max_handoffs') {
        logger.warn('agent.loop.max_handoffs_reached', {
          appId,
          conversationId,
          agentName: finalAgentName,
          iterations: loopResult.iterations,
          ...(requestId && { requestId }),
        })
      }

      const usage = lastTurnResult?.finalResult?.totalUsage ?? lastTurnResult?.finalResult?.usage
      if (usage && this.deps.backgroundSummarizer) {
        const metadata = (executionContext.metadata as Record<string, unknown> | undefined) ?? {}
        checkAndTriggerSummarization({
          inputTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
          appId, conversationId,
          subscriptionId: metadata.subscriptionId as string | undefined,
          customerId: metadata.customerId as string | undefined,
          summarizer: this.deps.backgroundSummarizer,
        })
      }

      // Await the parallel classifier now — its outcome feeds both the end
      // hooks (usedFreeGrants accounting) and the BMS report below. Timeout
      // yields `undefined`, which both consumers handle (accounting defaults
      // to "customer pays", BMS attribution defaults to the base subscription).
      if (assessmentHandle) {
        assessmentOutcome = await assessmentHandle.awaitOutcome({ timeoutMs: PARALLEL_ASSESSMENT_TIMEOUT_MS })
      }

      // Run end-of-message git squash + compute usedFreeGrants BEFORE persistence,
      // so the commitHash propagates into the persisted message metadata (matches
      // the WS beforeMessageComplete -> completeConversation ordering).
      if (this.deps.lifecycle) {
        const endResult = await runMessageEndHooks(this.deps.lifecycle, {
          appId, conversationId, sessionKey: sseSocketId,
          reason: loopAborted ? 'disconnection' : 'complete', userPrompt: content,
          assessmentOutcome, enableAssessmentOverride,
        })
        persistenceContext.commitHash = endResult.commitHash
        persistenceContext.usedFreeGrants = endResult.usedFreeGrants
      }

      turnPersisted = await this.completeConversationAndMarkPersisted({
        appId,
        conversationId,
        streamingEvents: turnSnapshot.streamingEvents,
        result: { finishReason: lastTurnResult?.finishReason },
        persistenceContext,
        agentMessageIds: openedAgentMessageIds,
        failureLogEvent: 'sse.execution.persistence_failed',
      })

      // Read back commitHash and usedFreeGrants (set above or by persistence fallback)
      const commitHash: string | null = persistenceContext.commitHash ?? null
      let usedFreeGrants: boolean = persistenceContext.usedFreeGrants ?? false

      if (bmsBudgetId && budgetSessionId && turnPersisted) {
        const budgetReport = await this.reconcileBudgetReport({
          appId,
          conversationId,
          budgetId: bmsBudgetId,
          sessionId: budgetSessionId,
          streamState,
          steps: allExecutionSteps,
          assessmentOutcome,
          wasUserAborted: loopAborted,
          subscriptionId,
        })
        budgetReportFiled = budgetReport.filed
        // BMS mode: update usedFreeGrants from cost attribution result
        // (persistenceContext.usedFreeGrants is always false in BMS mode since
        // deriveUsedFreeGrants returns false when budgetServiceEnabled=true)
        if (budgetReport.sessionWasFree !== undefined) {
          usedFreeGrants = budgetReport.sessionWasFree
        }
      } else if (bmsBudgetId && budgetSessionId) {
        logger.error('sse.execution.budget_skipped_persistence_failed', {
          appId, conversationId, phase: 'success',
        })
      }

      // If a later execute() has already replaced our slot (user stopped
      // then sent a new message before our loop observed its abort), our
      // terminal events would land in the NEW turn's subscriber set —
      // finalizing the new active stream on the client and wiping it.
      // Skip publish in that case; the owner of the slot will publish its
      // own terminal events.
      const supersededSuccess = this.activeStreams.get(conversationId) !== streamState
      if (supersededSuccess) {
        logger.info('sse.execution.superseded.skip_success_terminal', {
          appId, conversationId, finishReason,
        })
      } else {
        // Log + swallow so a subscriber rejection doesn't flip the success path
        // into the outer catch (which would re-publish error + complete).
        await this.publishTerminal(appId, conversationId, {
          conversationId, type: 'step_complete',
          content: lastTurnResult?.accumulatedContent ?? '',
          data: {
            source: 'ai_response',
            step: lastTurnResult?.currentStep ?? 1,
            isFinal: true,
            agentId: finalAgentName,
            ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
          },
          agentName: finalAgentName,
        })

        await this.publishTerminal(appId, conversationId, {
          conversationId, type: 'complete', content: '',
          data: {
            source: 'ai_response',
            agentId: finalAgentName,
            finishReason,
            totalSteps: lastTurnResult?.currentStep ?? 1,
            commitHash,
            usedFreeGrants,
            ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
            ...getCurrentTraceIds(),
            ...(requestId && { requestId }),
          },
          agentName: finalAgentName,
        })
      }

      logger.info('sse.execution.complete', { appId, conversationId, agentId: finalAgentName, finishReason, iterations: loopResult.iterations, ...(requestId && { requestId }) })
      if (apmTransaction && !supersededSuccess) {
        apmTransaction.setLabel('finishReason', finishReason)
        apmTransaction.setLabel('agent_id', finalAgentName)
        if (lastTurnResult?.currentStep) apmTransaction.setLabel('steps', lastTurnResult.currentStep)
        apmTransaction.result = 'success'
        apmTransaction.setOutcome('success')
        apmTransaction.end()
        this.markApmTransactionEnded(apmTransaction)
      }
      turnResult = {
        success: true,
        outputText: turnOutputText(),
        ...(turnResponseData() !== undefined && { responseData: turnResponseData() }),
      }
    } catch (error) {
      const chunkTimeoutAborted = abortController.signal.aborted
        && abortController.signal.reason === 'chunk_timeout'
      if (this.deps.lifecycle) {
        const reason: 'error' | 'disconnection' = abortController.signal.aborted
          && !chunkTimeoutAborted ? 'disconnection' : 'error'
        if (assessmentHandle && !assessmentOutcome) {
          // awaitOutcome is designed never to throw (swallowed classifier
          // rejection + withTimeout), so a throw here is a contract violation
          // in startParallelAssessment — log at error to surface on monitoring.
          // Don't let it escape the outer catch and leave the SSE client
          // waiting for terminal events.
          assessmentOutcome = await assessmentHandle
            .awaitOutcome({ timeoutMs: ERRORED_TURN_ASSESSMENT_TIMEOUT_MS })
            .catch((err) => {
              logger.error('sse.execution.error_path_assessment_await_failed', {
                appId, conversationId, ...errorFields(err),
              })
              return undefined
            })
        }
        // An end-hook throw on an already-errored path would otherwise escape
        // and skip the persistence write and terminal events below.
        try {
          const endResult = await runMessageEndHooks(this.deps.lifecycle, {
            appId, conversationId, sessionKey: sseSocketId, reason, userPrompt: content,
            assessmentOutcome, enableAssessmentOverride,
          })
          persistenceContext.commitHash = endResult.commitHash
          persistenceContext.usedFreeGrants = endResult.usedFreeGrants
        } catch (hookErr) {
          logger.error('sse.execution.end_hooks_failed', { appId, conversationId, reason, ...errorFields(hookErr) })
        }
      }

      turnPersisted = await this.completeConversationAndMarkPersisted({
        appId,
        conversationId,
        streamingEvents: turnSnapshot.streamingEvents,
        result: undefined,
        persistenceContext,
        agentMessageIds: openedAgentMessageIds,
        failureLogEvent: 'sse.execution.error_persistence_failed',
      })

      if (bmsBudgetId && budgetSessionId && turnPersisted) {
        const errorBudgetReport = await this.reconcileBudgetReport({
          appId,
          conversationId,
          budgetId: bmsBudgetId,
          sessionId: budgetSessionId,
          streamState,
          steps: allExecutionSteps,
          assessmentOutcome,
          wasUserAborted: abortController.signal.aborted && !chunkTimeoutAborted,
          subscriptionId,
        })
        budgetReportFiled = errorBudgetReport.filed
      } else if (bmsBudgetId && budgetSessionId) {
        logger.error('sse.execution.budget_skipped_persistence_failed', {
          appId, conversationId, phase: 'error',
        })
      }

      // Same superseded-slot guard as the success path: our terminal
      // events would otherwise land in a newer turn's subscriber set.
      const supersededError = this.activeStreams.get(conversationId) !== streamState
      if (supersededError) {
        logger.info('sse.execution.superseded.skip_error_terminal', {
          appId, conversationId, aborted: abortController.signal.aborted,
        })
      } else if (abortController.signal.aborted && !chunkTimeoutAborted) {
        logger.info('sse.execution.aborted', { appId, conversationId, ...(requestId && { requestId }) })
        if (apmTransaction && !supersededError) {
          apmTransaction.setLabel('finishReason', 'aborted')
          apmTransaction.result = 'aborted'
          apmTransaction.setOutcome('unknown')
          apmTransaction.end()
          this.markApmTransactionEnded(apmTransaction)
        }
        await this.publishTerminal(appId, conversationId, {
          type: 'complete',
          content: '',
          data: {
            source: 'ai_response',
            finishReason: 'aborted',
            ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
            ...getCurrentTraceIds(),
            ...(requestId && { requestId }),
          },
          conversationId, agentName: resolvedAgentId,
        })
        turnResult = {
          success: false,
          outputText: turnOutputText(),
          error,
          ...(turnResponseData() !== undefined && { responseData: turnResponseData() }),
        }
      } else {
        const err = error instanceof Error ? error : new Error(String(error))
        const classified = classifyTurnError(err)
        // Prefer classified.clientMessage for errors that sanitize internal
        // detail (BMS API paths). Matches the WS wire contract.
        const clientMessage = classified.clientMessage ?? err.message
        const { errorType, statusCode, retryAttempts, retryReason } = classified
        const terminalErrorInfo = analyzeStreamError(err)
        logger.error('sse.execution.error', {
          appId, conversationId, ...errorFields(err), ...(requestId && { requestId }),
          ...(terminalErrorInfo.statusCode !== undefined && { statusCode: terminalErrorInfo.statusCode }),
          ...(terminalErrorInfo.responseBody !== undefined && { responseBody: terminalErrorInfo.responseBody }),
          ...(terminalErrorInfo.validationValue !== undefined && { validationValue: terminalErrorInfo.validationValue }),
          errorClass: terminalErrorInfo.type,
          isNetworkError: terminalErrorInfo.isNetworkError,
          ...(streamState.lastTrackerSnapshot && {
            chunksRead: streamState.lastTrackerSnapshot.chunksRead,
            streamElapsedMs: streamState.lastTrackerSnapshot.streamElapsedMs,
          }),
          ...(streamState.lastResponseMetadata?.headers && { responseHeaders: streamState.lastResponseMetadata.headers }),
          ...(streamState.lastResponseMetadata?.responseId && { responseId: streamState.lastResponseMetadata.responseId }),
          ...(streamState.lastResponseMetadata?.modelId && { responseModelId: streamState.lastResponseMetadata.modelId }),
        })
        if (apmTransaction && !supersededError) {
          apmTransaction.setLabel('finishReason', 'error')
          apmTransaction.setLabel('error_message', clientMessage)
          apmTransaction.setLabel('error_type', err.name || 'Error')
          apmTransaction.result = 'error'
          apmTransaction.setOutcome('failure')
          apmTransaction.end()
          this.markApmTransactionEnded(apmTransaction)
        }
        await this.publishTerminal(appId, conversationId, {
          type: 'error', content: clientMessage,
          data: {
            source: 'ai_response',
            error: clientMessage,
            timestamp: new Date().toISOString(),
            ...(errorType !== undefined && { errorType }),
            ...(statusCode !== undefined && { statusCode }),
            ...(retryAttempts !== undefined && { retryAttempts }),
            ...(retryReason !== undefined && { retryReason }),
            ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
            ...(requestId && { requestId }),
          },
          conversationId, agentName: 'system',
        })
        await this.publishTerminal(appId, conversationId, {
          type: 'complete',
          content: '',
          data: {
            source: 'ai_response',
            finishReason: 'error',
            ...(activeAgentMessageId && { messageId: activeAgentMessageId }),
            ...getCurrentTraceIds(),
            ...(requestId && { requestId }),
          },
          conversationId, agentName: 'system',
        })
        emitTurnError({
          conversationId,
          specialistKey: resolvedAgentId,
          error: err,
          ...(errorType !== undefined && { errorType }),
          errorPhase: 'execution',
          isRetryable: classified.isRetryable,
          logger: { warn: (event, fields) => logger.warn(event, fields) },
        })
        turnResult = {
          success: false,
          outputText: turnOutputText(),
          error: err,
          ...(turnResponseData() !== undefined && { responseData: turnResponseData() }),
        }
      }
    } finally {
      // Budget report fallback: if neither the success nor error path filed
      // the report, retry once before tearing down the stream slot (which
      // publishBudgetEvent guards on). Still gated on persistence — never bill
      // a turn whose output was not saved.
      if (bmsBudgetId && budgetSessionId && !budgetReportFiled && turnPersisted) {
        try {
          const fallbackResult = await this.reconcileBudgetReport({
            appId,
            conversationId,
            budgetId: bmsBudgetId,
            sessionId: budgetSessionId,
            streamState,
            steps: allExecutionSteps,
            assessmentOutcome,
            wasUserAborted: abortController.signal.aborted
              && abortController.signal.reason !== 'chunk_timeout',
            subscriptionId,
          })
          if (!fallbackResult.filed) {
            logger.error('budget.report.fallback_also_failed', {
              appId,
              conversationId,
              budgetId: bmsBudgetId,
              sessionId: budgetSessionId,
              stepCount: allExecutionSteps.length,
            })
          }
        } catch (fallbackErr) {
          logger.error('budget.report.finally_fallback_threw', {
            appId,
            conversationId,
            budgetId: bmsBudgetId,
            sessionId: budgetSessionId,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          })
        }
      }

      // Clean up grant session registration to prevent stale mappings
      if (useGrantRecovery) {
        grantSessionManager.removeSession(sseSocketId)
      }

      // If a racing execute() replaced the registry slot, it owns the
      // session seed data (lastUserMessage / lastAssessmentTaskType) —
      // touching any of it would corrupt the next turn.
      if (getActionService(sseSocketId) === clientActionService) {
        cleanupActionService(sseSocketId)
        this.deps.lifecycle?.sessionStore.clearSession(sseSocketId)
      } else {
        logger.warn('sse.execution.concurrent_submit_cleanup', { appId, conversationId })
        clientActionService.cleanup()
      }
      if (this.abortControllers.get(conversationId) === abortController) {
        this.abortControllers.delete(conversationId)
      }
      // Only tear down eventChannel subscriptions if we still own the active
      // stream slot. If a racing execute() took over (user sent a new
      // message after stop, before this turn's loop could observe its
      // abort), it has re-subscribed the SAME SSE subscriber ID for its
      // own stream — unsubscribing here would leave that new turn publishing
      // into an empty channel, so the client would see no events and the
      // UI would hang on "Thinking…".
      if (this.activeStreams.get(conversationId) === streamState) {
        for (const subId of streamState.subscriberIds) {
          this.deps.eventChannel.unsubscribe(conversationId, subId)
        }
        this.activeStreams.delete(conversationId)
      } else if (apmTransaction && !this.isApmTransactionEnded(apmTransaction)) {
        // Superseded by a newer execute() — the success/error paths skipped
        // ending the transaction (guarded by !superseded*), so end it here.
        apmTransaction.setLabel('finishReason', 'superseded')
        apmTransaction.result = 'aborted'
        apmTransaction.setOutcome('unknown')
        apmTransaction.end()
        this.markApmTransactionEnded(apmTransaction)
      }
    }
    return turnResult
  }
}
