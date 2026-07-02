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
  recordTokenUsageObservability,
  TOOL_VALIDATION_ERROR_TYPE,
  BUSINESS_CONTEXT_SCHEMA_ID,
} from '@airo/ai-transport'
import type { ResponseMetadata, ResolveToolMetadata } from '@airo/ai-transport'
import { BudgetExceededError, classifyError } from '@airo/ai-common'
import { grantSessionManager, BudgetOverride } from '@airo/ai-grants'
import { createGrantBudgetRecoveryCallback } from '../grant-budget-recovery-callback.js'
import { context as otelContext, trace, SpanStatusCode } from '@opentelemetry/api'
import type { AgentsMessagePersistence } from '../conversation-persistence.js'
import type { EventStreamRegistry, SubscriberLifecycleListener } from './EventStreamRegistry.js'
import { SSEClientActionService } from './SSEClientActionService.js'
import { registerActionService, cleanupActionService, getActionService, getAgentFactory } from '../agent-runtime.js'
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
import { checkCorrelationIdRace, safeProcessBudgetReport, type BudgetReportContext } from '../budget-report-handler.js'
import { parseChunkTimeoutMs, runWithModelOverride, buildTokenUsage, calculateCostEstimate } from '@airo/ai-lib'
import { resolveProfile, runWithProfile } from '../../profiles/index.js'
import matter from 'gray-matter'
import { runWithAutomations } from '../../agents/automations-context.js'
import { resolveTurnscriptEnabled, runWithTurnscript } from '../../agents/turnscript-context.js'
import { getShopperFlag } from '../../services/switchboard.js'
import { guardAllowedOverrideModel, resolveOverride } from '../model-override.js'
import type { AssessmentOutcome } from '../../agents/assessment-agent/index.js'
import { AssessmentTaskType, ClassifierMode, AssessmentReason, ConversationRole, FixSessionPhase } from '../../agents/assessment-agent/index.js'
import { isFixIntentContext, corroborateFixIntent } from '../fix-intent-types.js'
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
  isOverrideApplicable,
  type MessageLifecycleDeps, type ParallelAssessmentHandle,
} from '../message-lifecycle.js'
import { agentAskedQuestion, agentMadeCodeChanges } from '../fix-session.js'
import {
  buildDynamicDataMessage, buildTodoContextMessage,
  buildMemoryContextMessage,
  collectImagesFromFormattedContexts, dataUrlsToProcessedFiles,
  checkAndTriggerSummarization,
} from '../context-builders.js'
import { computeDebugTurnStats } from '../../utils/debug-turn-stats.js'
import { raceAbortGrace, withTimeout } from '../../utils/promise-utils.js'
import { interactiveSubAgentManager } from '../../agents/interactive-sub-agent-manager.js'
import { subAgentJobRegistry } from '../../agents/sub-agent-job-registry.js'
import { AppRepository } from '../../database/repositories/index.js'
import { trackPostInteractionIfEligible } from '../../services/agent-lifecycle-events/initial-build-post-interaction.js'
import { trackInitialBuildStartedAsync } from '../../services/agent-lifecycle-events/initial-build-funnel.js'
import { enrichWithForcedDesignKit, isDesignSystemVariant } from '../../services/design-system/forced-install.js'
import { createForWorkspace } from '../../workspace/index.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { workspaceScopeFromAppId, customerIdFromContext } from '../../memory/interfaces/scope.js'
import { buildAppliedSkillsContextMessage } from '../applied-skills-context.js'
import { recordRolloutsOnSpan } from '../../lib/feature-rollouts.js'
import { conformExistingPages } from '../../services/content-conform.js'
import { buildWorkflowContextMessage } from '../workflow-context.js'
import { runClassification } from '../prompt-classification.js'

/** Short timeout for awaiting the classifier on an errored turn — the user is
 *  already seeing a failure, so don't delay terminal events for a slow classifier.
 *  usedFreeGrants defaults to false when the outcome is unavailable. */
const ERRORED_TURN_ASSESSMENT_TIMEOUT_MS = 500

/** Design-kit onboarding: after the user submits their business name the agent
 *  is silent for several seconds while it assembles the vibe picker
 *  (suggestDesignKits). These server-narrated, ephemeral `status_narration`
 *  texts fill that pause in the "Thinking…" indicator. The second is scheduled
 *  ~1.6s after the first and cancelled the instant real content arrives. */
const DESIGN_KIT_NARRATION_FIRST = 'Setting up your project…'
const DESIGN_KIT_NARRATION_SECOND = 'Finding vibes that match your brand…'
const DESIGN_KIT_NARRATION_SECOND_DELAY_MS = 1_600

/** Server-side eval-only diagnostics gate. Single source of truth for the
 *  SOCKET_DIAGNOSTICS flag so the call sites can't drift on the var name. The
 *  StreamTimingTracker gates its own socket.emit on the same env var internally. */
function isDiagnosticsEnabled(): boolean {
  return process.env.SOCKET_DIAGNOSTICS === 'true'
}

function generateRunSummary(output: string): string {
  return output.slice(-1000)
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
  }
  onAgentChanged?: (conversationId: string, oldAgent: string, newAgent: string, appId?: string) => Promise<void>
  backgroundSummarizer?: {
    checkAndSummarize(appId: string, triggerTokenCount?: number, budgetOverride?: string, customerId?: string, conversationId?: string, siteId?: string): Promise<void>
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
  /**
   * Optional Care bridge. When set and `effectiveAgentId === 'support'`,
   * the message-execution branches to `executeSupportUnderTrace` and
   * forwards Care's NDJSON stream to the event channel. Null in dev
   * environments without `AIRO_CARE_BASE_URL`; the support path emits
   * a "Care not configured" inline error chunk in that case.
   */
  careBridge?: import('../../care/index.js').CareBridge | null
  /**
   * Optional kill-switch reader for the Care integration. Returning false
   * gates `executeSupportUnderTrace` before the bridge is invoked, emitting
   * a "temporarily unavailable" inline error chunk. Undefined leaves the
   * support path ungated (treated as enabled). Read once per support turn.
   *
   * Why fail-open by default: a Switchboard outage or absent flag must not
   * take down working support. The kill-switch is an explicit ops action
   * (flag = false), not the absence of one. The Switchboard reader
   * (`getSwitchboardFlag`) already returns its `defaultValue` when the
   * client is uninitialized or throws, so passing `true` as the default
   * preserves the fail-open contract end-to-end.
   */
  isCareEnabled?: () => boolean
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
    enableFixSession?: boolean
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
    careAgentId?: string
    careAgentUsernameHash?: string
    useTestBudget?: boolean
    budgetServiceEnabled?: boolean
    subscriptionId?: string
    bmsBudgetId?: string
    useAtlasCrawler?: boolean
    rebuildIntakeFormEnabled?: boolean
    rebuildSourceImagesEnabled?: boolean
    debugStatsEnabled?: boolean
    market?: string
    fqdn?: string
    marketingCampaignsEnabled?: boolean
    googleBusinessProfileSyncEnabled?: boolean
    skillSuggestionsEnabled?: boolean
    shopperId?: string
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
  /** Full bring-over choice from the homepage modal (four toggles). */
  rebuildBringOverChoice?: unknown
  uploadedFileName?: string
  automationId?: string
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
  /** OTel span — attributes set progressively, ended at terminal. */
  messageSpan?: import('@opentelemetry/api').Span | null
  /** User-selected design kit slug from the gallery; forces install on turn 1 for design-system variants. */
  designKitSlug?: string
  /** Whether the client is running inside an iframe (embedded in a parent product). */
  isEmbedded?: boolean
}

interface ActiveStream {
  appId: string
  convId: string
  subscriberIds: Set<string>
  requestId?: string
  messageSpan?: import('@opentelemetry/api').Span | null
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
  if (useAttachedVariant && name === resolvedAgentId && !resolvedAgentId.endsWith('-attached')) {
    return getAgent(`${resolvedAgentId}-attached`) ?? getAgent(name)
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

interface StreamAgentTurnResult {
  accumulatedContent: string
  currentStep: number
  finalResult: any
  finishReason: string
  responseMetadata: ResponseMetadata
  steps: ExecutionStep[]
}

// Post-abort backstop for the single-consumer getFinalResult await. Once a turn
// aborts (chunk-timeout guard, user_stopped, server_shutdown), getFinalResult
// must settle within this window or finalization falls through to the catch's
// abort branches rather than hanging the SSE connection + activeStreams slot on
// an SDK that ignored the abort. The pre-AIROBUILD-3088 reader skipped
// getFinalResult on a dead socket; the single-consumer path awaits it, so this
// restores that deterministic bound. A cooperative abort settles near-instantly,
// well under the default. Overridable for tests.
function parseGetFinalAbortGraceMs(): number {
  const raw: string | undefined = process.env.AI_GETFINAL_ABORT_GRACE_MS
  const parsed: number = raw !== undefined ? Number(raw) : Number.NaN
  // Default intentionally exceeds SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS so that on a
  // server_shutdown abort the shutdown path's own (shorter) finalize bound
  // governs — abandoning a getFinalResult-ignoring turn within the kill grace —
  // while this grace stays the sole backstop for chat-path aborts (chunk_timeout
  // / user_stopped) that have no other bound.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SSE_SHUTDOWN_FINALIZE_TIMEOUT_MS * 2
}

export class MessageExecutionService implements SubscriberLifecycleListener {
  private deps: ExecutionDeps
  private readonly chunkTimeoutMs = parseChunkTimeoutMs()
  private readonly getFinalAbortGraceMs: number = parseGetFinalAbortGraceMs()
  private abortControllers = new Map<string, AbortController>()
  private activeStreams = new Map<string, ActiveStream>()
  private endedSpans = new WeakSet<NonNullable<ActiveStream['messageSpan']>>()
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

  /** Publish a single error chunk + complete to the event channel, then persist
   * both events via completeConversation. Shared by all guard paths in
   * executeSupportUnderTrace so the agent message in the DB always has segments
   * matching what the live SSE client saw — avoids the NaN% reduction log and
   * the empty-agent-message reload bug. */
  private async emitGuardPathFailure(
    appId: string,
    conversationId: string,
    chunkContent: string,
    persistenceContext: SSEPersistenceContext,
  ): Promise<void> {
    await this.publishNonTerminal(appId, conversationId, {
      type: 'chunk', content: chunkContent, data: {},
      agentName: 'support', conversationId,
    })
    await this.publishTerminal(appId, conversationId, {
      type: 'complete', content: '', data: { finishReason: 'error' },
      agentName: 'support', conversationId,
    })
    const persistenceEvents: PersistenceStreamingEvent[] = [
      { type: 'chunk', content: chunkContent, data: {}, timestamp: new Date() },
      { type: 'complete', content: '', data: { finishReason: 'error' }, timestamp: new Date() },
    ]
    await this.deps.conversationPersistence.completeConversation(
      conversationId, persistenceEvents, { finishReason: 'error' }, persistenceContext
    ).catch((persistErr: unknown) => {
      logger.error('sse.execution.support.complete_failed', { appId, conversationId, ...errorFields(persistErr) })
    })
  }

  private markSpanEnded(transaction: ActiveStream['messageSpan']): void {
    if (transaction) this.endedSpans.add(transaction)
  }

  private isSpanEnded(transaction: ActiveStream['messageSpan']): boolean {
    return !!transaction && this.endedSpans.has(transaction)
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
      if (active.messageSpan) {
        active.messageSpan.setAttribute('finishReason', 'user_stopped')
        active.messageSpan.setAttribute('result', 'aborted')
        active.messageSpan.setStatus({ code: SpanStatusCode.UNSET })
        active.messageSpan.end()
        this.markSpanEnded(active.messageSpan)
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
        if (active.messageSpan) {
          active.messageSpan.setAttribute('finishReason', 'server_shutdown')
          active.messageSpan.setAttribute('result', 'aborted')
          active.messageSpan.setStatus({ code: SpanStatusCode.UNSET })
          active.messageSpan.end()
          this.markSpanEnded(active.messageSpan)
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
    hadSelfRepair?: boolean
    careContext?: BudgetReportContext['careContext']
  }): Promise<{ filed: boolean; sessionWasFree?: boolean }> {
    const { appId, conversationId, budgetId, sessionId, streamState, steps, assessmentOutcome, wasUserAborted, subscriptionId, hadSelfRepair, careContext } = opts
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
          hadSelfRepair,
          careContext,
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
    // Wall-clock of the first observed stream part; with turnStartMs this yields
    // the pre-stream init duration for the timing diagnostic. Defaults to
    // turnStartMs so a turn that never streams reports 0 rather than a negative delta.
    let streamFirstReadMs = turnStartMs
    // Set by the processor's onError when a terminal `error` part is observed
    // (the factory also aborts the shared request on that part). The consumption
    // await below re-throws it so the outer catch classifies + publishes the
    // terminal error — distinguishing it from a genuine getFinalResult fetch
    // failure (which stays a soft result_fetch_failed).
    let terminalStreamError: Error | undefined
    // Set by `observe` when processing a part throws (a processor-callback bug or
    // a synchronous publish failure — NOT a provider/network fault). The
    // consumption await re-throws it so the turn hard-fails (matching the
    // pre-collapse reader loop, where a processPart throw unwound to the outer
    // catch) rather than being mislabelled as the soft result_fetch_failed the
    // dashboard reserves for genuine final-result fetch failures.
    let streamObserveError: Error | undefined

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

    // Design-kit onboarding: narrate the silent pre-picker pause BEFORE the LLM
    // stream begins. Cancelled as soon as any tool starts/completes (below) and,
    // best-effort, in the finally at turn end. No-op for every non-design-kit /
    // non-gathering turn.
    const clearStatusNarration = await this.startDesignKitStatusNarration({
      agent, appId, conversationId, executionContext, publish,
    })

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
        // Once any tool starts the pre-picker silence is over — cancel the scheduled
        // narration here (not only on tool_result) so a fast tool that errors, or a slow
        // one that runs past the 2nd-emit delay, can't flash "Finding vibes…" mid-turn.
        clearStatusNarration()
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
        clearStatusNarration()
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
        clearStatusNarration()
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
          tool: { id: toolCallId, name: toolName, input, output: error.message, error: error.message, is_error: true, ...toolMetadataFields(toolName, this.deps.resolveToolMetadata, logger) },
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
        // Record (don't throw) the terminal `error` part. The factory's
        // observing pipeline (AIROBUILD-3088 PR1) also aborts the shared request
        // on this part; the consumption await below re-throws this recorded error
        // to execute()'s outer catch for classification + terminal-event publish.
        // Recording rather than throwing keeps the result_fetch_failed soft path
        // intact for a getFinalResult fetch failure that is NOT a stream error part.
        terminalStreamError = error
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

    const [todoContextMessage, memoryContextMessage, historyMessages] = await Promise.all([
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

    // Derive first-turn status from the EFFECTIVE history. The current message
    // is persisted (continueConversation) before history is loaded, so on a
    // genuine first turn it is the sole trailing history entry.
    const isFirstTurn: boolean = dropTrailingPrompt(historyMessages, message).length === 0

    // Run classification, applied skills, and workflow context in parallel.
    // Classification needs historyMessages (for continuation detection) so it
    // fires after history is loaded but concurrently with other context builders.
    const agentConfig = agent?.getConfig?.()
    const [appliedSkillsMessage, workflowContextMessage, classificationMessage] = await Promise.all([
      buildAppliedSkillsContextMessage(appId),
      agentName === 'deep-build'
        ? buildWorkflowContextMessage(appId).catch(err => {
          logger.warn('sse.execution.workflow_context_failed', { appId, conversationId, ...errorFields(err) })
          return null
        })
        : null,
      agentConfig
        ? runClassification({
          agentConfig,
          prompt: message,
          historyMessages,
          isInitialPrompt: isFirstTurn,
          appId,
          conversationId,
          templateId: metadata.templateId as string | undefined,
          uploadedFileName: metadata.uploadedFileName as string | undefined,
        })
        : null,
    ])

    const extraAfterHistory = [todoContextMessage, memoryContextMessage, dynamicDataMessage, appliedSkillsMessage, workflowContextMessage, classificationMessage]
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map(m => ({ role: m.role, content: m.content, ...(m.cachePoint && { cachePoint: m.cachePoint }) }))

    // Preflight tool synthesis: when conversation is empty and the agent declares
    // preflightTools in its metadata, run them server-side and prepend synthesized
    // assistant tool_call + tool result pairs so the model sees the result on turn 1.
    let preflightMessages: Array<{ role: string; content: unknown }> = []
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

    // First-turn, per-app, one-time content-conform scan. The on-create conform
    // only heals pages written via `command === 'create'`; pages that pre-date
    // the content layer or only get incremental edits keep their inline arrays.
    // On the first DEVELOP turn we conform the whole `src/pages` tree once.
    //   - develop-only: skip InitialAgent (scaffolding) and every other agent —
    //     develop is where existing pages get worked on (agentName is the
    //     resolved agent id, e.g. 'develop').
    //   - AWAITED, before the agent's edit stream starts (below), so the scan is
    //     serialized with this turn's own writes — same effective ordering as the
    //     on-create conform (a synchronous post-edit handler). Fire-and-forget
    //     would race the develop agent editing the same `src/pages/*.tsx`: the
    //     scan reads source, then writes a rewrite of that now-stale source,
    //     clobbering a concurrent edit or breaking a `str_replace` mid-turn.
    //     Cost is bounded + one-time: `conformExistingPages` is fail-safe (never
    //     throws) and idempotent — once an app is conformed, each page hits the
    //     cheap "no extractable arrays" short-circuit, so steady-state is ~reads.
    //     Ungated (no feature flag), matching the on-create path.
    const conformAppPath = (executionContext.metadata as { appPath?: string } | undefined)?.appPath
    if (isFirstTurn && agentName === 'develop' && conformAppPath) {
      try {
        await conformExistingPages({ appId, appPath: conformAppPath })
      } catch (err) {
        // conformExistingPages is whole-scan fail-safe; this is belt-and-suspenders
        // so a scan bug can never break the user's first turn.
        logger.warn('content-extract.scan.failed', { appId, ...errorFields(err) })
      }
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
      const closeTiming: StreamTimingData = tracker.finalize()
      logger.warn('sse.stream.premature_close.soft_commit', {
        appId, conversationId, agentName, finishReason: outcome.finishReason,
        trigger: upstreamTimeout ? 'upstream_timeout' : 'network_close',
        statusCode: (err as { statusCode?: number }).statusCode,
        streamDurationMs: closeTiming.streamDurationMs,
        maxChunkGapMs: closeTiming.maxChunkGapMs,
        timeToFirstTextChunkMs: closeTiming.timeToFirstTextChunkMs,
        chunksRead: closeTiming.chunksRead,
        ...errorFields(err),
      })
      return true
    }

    // Single consumer: the AI SDK drives the stream; we observe each part as it
    // passes through the factory's experimental_transform (AIROBUILD-3088 PR1)
    // and emit SSE here, replacing the old baseStream reader loop. The SDK is the
    // sole consumer, so no teed fork can disagree on termination. streamFirstReadMs
    // defaults to turnStartMs; stamp it on the first part for the
    // timeToStreamStartMs diagnostic.
    const observe = async (part: { type: string; [key: string]: unknown }): Promise<void> => {
      if (abortSignal.aborted) return
      if (streamFirstReadMs === turnStartMs) streamFirstReadMs = Date.now()
      tracker.recordChunk()
      guard?.reset()
      try {
        processor.processPart(part)
        // Once the terminal `finish` frame is seen the stream is done; no further
        // chunks are legitimate, so pause the gap guard rather than letting it
        // fire a false chunk_timeout while getFinalResult's promise settles.
        if (processor.isFinished()) guard?.pause()
        await flushPendingWork()
      } catch (observeError: unknown) {
        // A throw here rejects the factory's observing transform, which rejects
        // getFinalResult below. Log the origin distinctly so the failure isn't
        // misattributed to a provider/network fault, record it so the consumption
        // catch hard-fails the turn (not result_fetch_failed), then rethrow to
        // reject getFinalResult promptly (the part was being processed, not fetched).
        streamObserveError = observeError instanceof Error ? observeError : new Error(String(observeError))
        logger.error('sse.stream.observe.failed', { appId, conversationId, agentName, partType: part.type, ...errorFields(observeError) })
        throw streamObserveError
      }
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
            observe,
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
            observe,
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

      // The AI SDK is the sole stream consumer: `observe` (passed to
      // streamGenerate above) emitted SSE per part as the loop ran. Await
      // getFinalResult to confirm consumption finished and obtain the terminal
      // result. A terminal `error` part is recorded by onError (terminalStreamError)
      // and re-thrown to execute()'s outer catch for classification +
      // terminal-event publishing; chunk-timeout and premature-close soft-commit
      // as before; and a getFinalResult fetch failure that is NOT a stream error
      // part stays a soft result_fetch_failed.
      let finishReason = 'complete'
      let finalResult: any
      let finalResultError: unknown
      try {
        // raceAbortGrace bounds the wait only after an abort fires: a
        // non-cooperative SDK that never settles getFinalResult on the
        // terminal-error / chunk-timeout / shutdown abort rejects here instead
        // of hanging the connection + activeStreams slot. The catch branches
        // below (keyed on abortSignal.reason) then finalize as before.
        finalResult = await raceAbortGrace(streamResult.getFinalResult(), abortSignal, this.getFinalAbortGraceMs)
        finishReason = finalResult?.finishReason ?? 'complete'
      } catch (err) {
        finalResultError = err
        if (terminalStreamError) {
          // A terminal `error` part was observed (CONTENT_FILTERED, budget,
          // validation, …). The factory aborted the request and getFinalResult
          // rejected as a consequence; surface the original error part for
          // classification rather than the abort fallout.
          throw terminalStreamError
        }
        if (streamObserveError) {
          // A part failed to process/emit (callback bug or synchronous publish
          // failure). Hard-fail the turn via the outer catch rather than the soft
          // result_fetch_failed below — the stream broke, the result fetch didn't.
          // `observe` already logged sse.stream.observe.failed and is mutually
          // exclusive with the abort branches (observe no-ops once aborted).
          throw streamObserveError
        }
        if (abortSignal.reason === 'chunk_timeout') {
          // The chunk-timeout guard aborted mid-consumption; soft-commit when
          // content/finish is present, else throwChunkTimeoutError propagates
          // out to the outer catch (preserving today's fail-fast behaviour).
          handleChunkTimeout()
          finishReason = chunkTimeoutFinishReason ?? finishReason
          const captured = processor.getFinishResult()
          finalResult = captured
            ? { finishReason: captured.finishReason, totalUsage: captured.totalUsage }
            : { finishReason }
        } else if (handlePrematureClose(err)) {
          // Premature upstream close / 408 / 504 with content already streamed:
          // soft-commit (handlePrematureClose sets prematureCloseError +
          // chunkTimeoutFinishReason and logs sse.stream.premature_close.soft_commit).
          finishReason = chunkTimeoutFinishReason ?? 'incomplete'
          const captured = processor.getFinishResult()
          finalResult = captured
            ? { finishReason: captured.finishReason, totalUsage: captured.totalUsage }
            : { finishReason }
        } else if (abortSignal.aborted) {
          // Deliberate abort (user_stopped / server_shutdown) — expected, not a
          // fetch failure. Logged distinctly so result_fetch_failed (trusted by
          // the dashboard / sse-rollout-check.py) counts only genuine failures.
          logger.info('sse.execution.getFinalResult.aborted', {
            appId, conversationId,
            reason: String(abortSignal.reason ?? 'unknown'),
          })
          finishReason = 'aborted'
        } else if (isNetworkError(err) || isUpstreamTimeoutError(err)) {
          // Premature upstream close / 408 / 504 with NO content to salvage
          // (handlePrematureClose returned false): hard-fail exactly as the old
          // reader path did — rethrow to the outer catch for network-error
          // classification + a terminal `error` event, not the soft
          // result_fetch_failed reserved for non-network fetch failures.
          throw err
        } else {
          logger.warn('sse.execution.getFinalResult.failed', { appId, conversationId, ...errorFields(err) })
          finishReason = 'result_fetch_failed'
        }
      }
      // An error part can be observed while getFinalResult still resolves (the
      // factory aborts on the part, but the result promise may settle first);
      // surface it so the turn errors rather than silently completing.
      if (terminalStreamError) {
        throw terminalStreamError
      }

      const timingData: StreamTimingData = tracker.finalize()
      guard?.dispose()
      logger.info('sse.stream.timing', { appId, conversationId, agentName, ...timingData })

      // Restore the WS `stream.timing.summary` diagnostic as a first-class SSE
      // event for the gosym-probe eval's LatencyEvaluator (AIROBUILD-2681).
      // timeToStreamStartMs is the agent-init + LLM-connect time before the first
      // observed part (turnStartMs → streamFirstReadMs), mirroring the WS server's
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
      clearStatusNarration()
      guard?.dispose()
    }
  }

  /**
   * Design-kit onboarding narration. On a design-kit gathering turn the agent
   * goes silent for several seconds while it assembles the vibe picker; emit a
   * dedicated, ephemeral `status_narration` event immediately and schedule a
   * second ~1.6s later so the "Thinking…" indicator shows progress text.
   *
   * Returns a canceller the caller invokes as soon as the first tool starts/completes
   * and, best-effort, at turn end, so a late status can't flash after the picker renders.
   * (If setup throws before the stream's try/finally the canceller may be skipped; the
   * ownership-guarded publish still drops the superseded emit, so a leaked timer is benign.)
   * Returns a no-op canceller (and emits nothing) unless BOTH gates hold:
   *   (a) the resolved agent is the design-kit initial agent (id
   *       'initial-design-kit'), and
   *   (b) the wizard phase (KV `brand.wizard.phase`) is unset or 'gathering' —
   *       never brand/website/ready, which have their own progress UI.
   *
   * The emit rides the guarded `publish` closure, so a superseded stream drops
   * the event even if the scheduled timer outlives the ownership handover.
   * status_narration is ephemeral: it is not tracked in the turn snapshot and
   * falls through the persistence switch, so it is never saved as assistant text.
   */
  private async startDesignKitStatusNarration(opts: {
    agent: { getConfig?: () => { id?: string } | undefined } | undefined
    appId: string
    conversationId: string
    executionContext: Record<string, unknown>
    publish: (event: Parameters<ConversationEventChannel['publish']>[1]) => void
  }): Promise<() => void> {
    const noop = (): void => {}
    const { agent, appId, conversationId, executionContext, publish } = opts
    if (agent?.getConfig?.()?.id !== 'initial-design-kit') return noop

    const scope = workspaceScopeFromAppId(appId, customerIdFromContext(executionContext as { metadata?: Record<string, unknown> }))
    let phase: string | undefined
    try {
      const result = await getKvMemoryStore().get(scope, 'brand.wizard.phase')
      phase = result.exists ? (result.value as { phase?: string } | undefined)?.phase : undefined
    } catch (err) {
      logger.warn('sse.status_narration.phase_read_failed', { appId, conversationId, ...errorFields(err) })
      return noop
    }
    if (phase !== undefined && phase !== 'gathering') return noop

    const emit = (text: string): void => {
      publish({ conversationId, type: 'status_narration', content: '', data: { text, appId }, agentName: 'system' })
      logger.debug('sse.status_narration.emit', { appId, conversationId, text })
    }

    emit(DESIGN_KIT_NARRATION_FIRST)
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => emit(DESIGN_KIT_NARRATION_SECOND), DESIGN_KIT_NARRATION_SECOND_DELAY_MS)
    return () => clearTimeout(timer)
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
   * whether to stream the tool-less `-attached` variant for this turn.
   */
  private async prepareForcedDesignKit(opts: {
    resolvedAgentId: string
    designKitSlug: string | undefined
    appId: string
    conversationId: string
    isInitialPrompt: boolean
    executionContext: Record<string, unknown>
    customerId?: string
  }): Promise<{ forcedKitMessages: Array<{ role: string; content: unknown }>; useAttachedVariant: boolean }> {
    const { resolvedAgentId, designKitSlug, appId, isInitialPrompt, executionContext, customerId } = opts
    let forcedKitMessages: Array<{ role: string; content: unknown }> = []

    if (isInitialPrompt && designKitSlug) {
      // Resolve the agent whose toolset/config drives the install. Safe against
      // the factory's throw-on-unknown-id and legacy already-attached ids.
      const { agent: installAgent } = pickForcedInstallAgent({
        resolvedAgentId, getAgent: (id) => this.deps.getAgent(id),
      })
      const installConfig = installAgent?.getConfig?.()
      if (installConfig) {
        try {
          forcedKitMessages = await enrichWithForcedDesignKit({
            designKitSlug, appId, agentConfig: installConfig, transport: 'sse', logger, customerId,
          })
        } catch (error) {
          logger.warn('design_kit.forced_install.skipped', { reason: 'unexpected error', designKitSlug, appId, ...errorFields(error) })
        }
      }
    }

    let resolvedAgentConfig: { id?: string; metadata?: Record<string, unknown> } | undefined
    try {
      resolvedAgentConfig = this.deps.getAgent(resolvedAgentId)?.getConfig?.()
    } catch {
      resolvedAgentConfig = undefined
    }
    const isDesignSystemResolved: boolean = isDesignSystemVariant(resolvedAgentConfig)
    const hasAttachedSibling: boolean = isDesignSystemResolved
      && !resolvedAgentId.endsWith('-attached')
      && !!getAgentFactory()?.agents.has(`${resolvedAgentId}-attached`)
    let kitMetaExists = false
    if (hasAttachedSibling) {
      if (forcedKitMessages.length > 0) {
        kitMetaExists = true
      } else {
        const workspace = createForWorkspace(appId, 'preview')
        if (workspace) {
          try {
            const statResult = await workspace.files.stat({ paths: ['docs/ui-kit/kit-meta.json'] })
            const entry = statResult.entries[0]
            kitMetaExists = !!entry && entry.error === undefined && entry.kind === 'file'
          } catch (error) {
            logger.warn('design_kit.kit_meta_stat.failed', { reason: 'stat threw', appId, ...errorFields(error) })
            kitMetaExists = false
          }
        }
      }
      const metadata = executionContext.metadata as Record<string, unknown> | undefined
      if (metadata) {
        metadata.kitMetaExists = kitMetaExists
      }
    }

    const useAttachedVariant: boolean = isDesignSystemResolved
      && hasAttachedSibling
      && kitMetaExists
    if (useAttachedVariant) {
      logger.info('design_kit.attached_variant.substituted', { resolvedAgentId, appId, transport: 'sse' })
    }

    return { forcedKitMessages, useAttachedVariant }
  }

  private setupStreamState(opts: {
    conversationId: string
    appId: string
    agentNameForApm: string
    requestId?: string
    messageSpan?: ActiveStream['messageSpan']
  }): ActiveStream {
    const { conversationId, appId, agentNameForApm, requestId, messageSpan } = opts
    const streamState: ActiveStream = {
      appId, convId: conversationId, subscriberIds: new Set(),
      ...(requestId && { requestId }),
      messageSpan,
    }
    this.activeStreams.set(conversationId, streamState)
    if (messageSpan) {
      messageSpan.setAttribute('agent_name', agentNameForApm)
      messageSpan.updateName(`SSE Message: ${agentNameForApm}`)
    }
    const sseSubscribers = this.deps.sseRegistry.getSubscribers(conversationId)
    for (const sub of sseSubscribers) {
      this.deps.eventChannel.subscribe(conversationId, sub)
      streamState.subscriberIds.add(sub.id)
    }
    return streamState
  }

  private async executeUnderTrace(params: ExecuteParams, turnSnapshot: TurnSnapshotState): Promise<TurnExecutionResult> {
    // Start of message handling — anchors the stream_timing_summary diagnostic's
    // timeToStreamStartMs (agent init + LLM-connect time before the first stream
    // read). Mirrors the WS server's per-message startTime.
    const turnStartMs = Date.now()
    const {
      appId, conversationId, content, siteId, agentId,
      templateId, modelOverride, rebuildBuildPageSlug, rebuildDesignDirection, rebuildBringOverChoice,
      visualContext, aiEditContext, aiEditContexts, selectedAssets,
      todoListContext, isActionRequest, customContext, buildErrorContext,
      bmsBudgetId, budgetSessionId, subscriptionId, authType,
      lifecycleContext, uploadedFileName, automationId, market, userTimezone, requestId, messageSpan,
      designKitSlug, isEmbedded,
    } = params

    recordRolloutsOnSpan(appId)

    const resolvedAgentId = agentId
    if (resolvedAgentId === 'support') {
      return this.executeSupportUnderTrace(params, turnSnapshot)
    }
    let turnResult: TurnExecutionResult = { success: false }
    const sseSocketId = sseSessionKey(conversationId)
    const agentCtx = lifecycleContext?.agentContext
    // Impersonation context for attributing care-agent (BMS override) spend at report time.
    const careContext: BudgetReportContext['careContext'] = {
      careAgentId: agentCtx?.careAgentId,
      careAgentUsernameHash: agentCtx?.careAgentUsernameHash,
      appId,
      conversationId,
    }
    const enableAssessmentAgent = !!agentCtx?.enableAssessmentAgent
    const enableAssessmentOverride = !!agentCtx?.enableAssessmentOverride
    const enableFixSession = !!agentCtx?.enableFixSession

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
      enableFixSession,
      assessmentClassifier: agentCtx?.assessmentClassifier,
      effectiveClassifierMode,
      budgetServiceEnabled: agentCtx?.budgetServiceEnabled,
    })

    if (appId) {
      if (lifecycleContext?.isInitialPrompt) {
        trackInitialBuildStartedAsync(appId)
      } else {
        try {
          await trackPostInteractionIfEligible(appId, conversationId)
        } catch (error) {
          logger.warn('initial_build.post_interaction.lookup_failed', {
            appId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Run message-start hooks (git branch + assessment classification).
    // Failures are logged inside the helpers; neither throws out of here.
    //
    // Cost attribution is driven by the post-turn BMS report (when BMS is active)
    // or by mid-stream grant recovery (when in grants mode). We fire the classifier
    // non-blocking and await it right before runMessageEndHooks / safeProcessBudgetReport.
    let assessmentOutcome: AssessmentOutcome | undefined
    let assessmentHandle: ParallelAssessmentHandle | undefined
    let hadSelfRepair: boolean = false
    if (this.deps.lifecycle) {
      const corroboration = isFixIntentContext(customContext)
        ? corroborateFixIntent(appId, customContext!.type!)
        : undefined
      if (corroboration?.verified) {
        assessmentOutcome = {
          result: { taskType: AssessmentTaskType.Fix, confidence: 100 },
          overrideApplied: true,
          appliedBudget: BudgetOverride.FixTask,
          completedInTime: true,
          durationMs: 0,
          reason: AssessmentReason.FixIntentBypass,
        }
        logger.info('assessment_agent.fix_intent_bypass', {
          appId,
          customContextType: customContext!.type,
          corroborationReason: corroboration.reason,
        })
      } else {
        // Fire the classifier so it overlaps the git hook's branch creation.
        assessmentHandle = startParallelAssessment(this.deps.lifecycle, {
          appId,
          sessionKey: sseSocketId,
          message: content,
          customerId: agentCtx?.customerId,
          isInitialPrompt: !!lifecycleContext?.isInitialPrompt,
          enableAssessmentAgent,
          enableAssessmentOverride,
          classifierMode: effectiveClassifierMode,
          enableFixSession,
        })
        if (corroboration) {
          logger.info('assessment_agent.fix_intent_corroboration_failed', {
            appId,
            customContextType: customContext!.type,
            reason: corroboration.reason,
          })
        }
      }
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
    const streamState = this.setupStreamState({
      conversationId, appId, agentNameForApm: resolvedAgentId,
      requestId, messageSpan,
    })

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
      if (messageSpan) {
        messageSpan.setAttribute('finishReason', 'persistence_pre_turn_failed')
        messageSpan.setAttribute('result', 'error')
        messageSpan.setStatus({ code: SpanStatusCode.ERROR })
        messageSpan.end()
        this.markSpanEnded(messageSpan)
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
        ...(agentCtx?.fqdn && { fqdn: agentCtx.fqdn }),
        ...(userTimezone && { userTimezone }),
        permissions: {
          canDownload: agentCtx?.canDownload ?? false,
          canPublish: agentCtx?.canPublish ?? false,
          canPurchaseDomain: agentCtx?.canPurchaseDomain ?? false,
        },
        isE2S: agentCtx?.isE2S ?? false,
        authType,
        marketingCampaignsEnabled: agentCtx?.marketingCampaignsEnabled ?? false,
        googleBusinessProfileSyncEnabled: agentCtx?.googleBusinessProfileSyncEnabled ?? false,
        ...(agentCtx?.useTestBudget !== undefined && { useTestBudget: agentCtx.useTestBudget }),
        ...(agentCtx?.useAtlasCrawler && { useAtlasCrawler: true }),
        ...(agentCtx?.rebuildIntakeFormEnabled && { rebuildIntakeFormEnabled: true }),
        ...(agentCtx?.rebuildSourceImagesEnabled && { rebuildSourceImagesEnabled: true }),
        ...(agentCtx?.skillSuggestionsEnabled && { skillSuggestionsEnabled: true }),
        ...(rebuildDesignDirection && { rebuildDesignDirection }),
        ...(rebuildBringOverChoice !== undefined && { rebuildBringOverChoice }),
        // isRebuildFlow is SSE-only — WS handoff re-spreads client metadata and would drop it.
        ...(rebuildBuildPageSlug && { rebuildBuildPageSlug, isRebuildFlow: true }),
        ...(isEmbedded !== undefined && { isEmbedded }),
        ...(content && { _userMessage: content }),
        ...(agentCtx?.marketingCampaignsEnabled && { marketingCampaignsEnabled: true }),
      },
      ...(contextAttachments.length > 0 && { contextAttachments }),
      todoListContext, isActionRequest, customContext,
    }

    // Tool metadata for sub-agent streaming (runAgent) and optional debug_turn_stats (Sora).
    const execMeta = executionContext.metadata as Record<string, unknown>
    if (agentCtx?.debugStatsEnabled) {
      execMeta.debugStatsEnabled = true
    }
    execMeta.agentName = resolvedAgentId
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
        } else if (type === 'skill_diagnostics' && process.env.SKILL_DIAGNOSTICS === 'true') {
          this.publishNonTerminal(appId, conversationId, {
            conversationId,
            type: 'skill_diagnostics',
            content: '',
            data: data as Record<string, unknown>,
            agentName: '',
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
      if (assessmentOutcome?.overrideApplied && assessmentOutcome.appliedBudget) {
        // Fix-intent bypass already determined the outcome. Apply the override
        // to the grant path the same way the classifier outcome would be applied.
        const meta = executionContext.metadata as Record<string, unknown>
        meta.subscriptionId = assessmentOutcome.appliedBudget
        logger.info('grants.assessment.fix_intent_bypass_override', {
          appId,
          socketId: sseSocketId,
          appliedBudget: assessmentOutcome.appliedBudget,
        })
      } else if (enableAssessmentOverride && assessmentHandle) {
        // awaitOutcome is designed never to throw (swallowed classifier
        // rejection + withTimeout), so a throw here is a contract violation
        // in startParallelAssessment — guard to match the post-turn error path
        // and prevent leaving the SSE client waiting for terminal events.
        const earlyOutcome = await assessmentHandle
          .awaitOutcome({ timeoutMs: PARALLEL_ASSESSMENT_TIMEOUT_MS })
          .catch((err) => {
            logger.error('sse.execution.early_assessment_await_failed', {
              appId, socketId: sseSocketId, ...errorFields(err),
            })
            return undefined
          })
        if (earlyOutcome) {
          assessmentOutcome = earlyOutcome
          if (isOverrideApplicable(earlyOutcome, enableAssessmentOverride)) {
            // This is the load-bearing assignment: buildLitellmMetadataFromContext
            // takes the isBudgetOverride branch when subscriptionId matches a
            // budget key, routing cost away from the customer's grant. The
            // registerSession skip below just avoids dead state — the override
            // branch precedes grant lookup either way.
            const meta = executionContext.metadata as Record<string, unknown>
            meta.subscriptionId = earlyOutcome.appliedBudget
            logger.info('grants.assessment.sse_early_override', {
              appId,
              socketId: sseSocketId,
              appliedBudget: earlyOutcome.appliedBudget,
              durationMs: earlyOutcome.durationMs,
            })
          } else {
            grantSessionManager.registerSession(sseSocketId, subscriptionId!)
          }
        } else {
          // Timeout: fall through to customer grant. Cache a no-override sentinel so
          // the post-turn await doesn't re-fire and free_task_completed stays suppressed —
          // we must not tell the user a task was free when the grant was charged.
          assessmentOutcome = { result: null, completedInTime: false, durationMs: 0, overrideApplied: false, reason: AssessmentReason.Timeout }
          logger.warn('grants.assessment.sse_early_override_timeout', {
            appId,
            socketId: sseSocketId,
            reason: 'timeout_or_failure',
          })
          grantSessionManager.registerSession(sseSocketId, subscriptionId!)
        }
      } else {
        grantSessionManager.registerSession(sseSocketId, subscriptionId!)
      }
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
    const { forcedKitMessages, useAttachedVariant } = await this.prepareForcedDesignKit({
      resolvedAgentId, designKitSlug, appId, conversationId, isInitialPrompt: lifecycleContext?.isInitialPrompt ?? false,
      executionContext,
      customerId: agentCtx?.customerId,
    })
    // The forced kit install ran THIS turn iff it produced synthesized
    // messages. That single turn parks on the `-attached` interview's
    // askQuestion stop-after with a dirty tree (deterministic token writes the
    // model never authored), so we grant the validator immunity for it only —
    // every later turn leaves this false and is validated normally
    // (AIROBUILD-2665).
    const forcedInstallThisTurn = forcedKitMessages.length > 0

    try {
      let lastTurnResult: StreamAgentTurnResult | undefined
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

      const runLoop = () => executeAgentLoop(resolvedAgentId, agentContent, {
        getAgent: (name) => resolveTurnAgent({
          name, resolvedAgentId, useAttachedVariant, getAgent: (id) => this.deps.getAgent(id),
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
              forcedInstallThisTurn,
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
              hadSelfRepair = true
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

      const automationsEnabled = getShopperFlag('appbuilder-automations', agentCtx?.shopperId)
      // Resolve turnscript per turn from the Switchboard flag + shopperId (+ env fallback)
      // and wrap the loop so the develop agent's resolvers can read it via the ALS. Nested
      // inside runWithAutomations so resolvers see both contexts; off by default.
      const turnscriptOn = resolveTurnscriptEnabled(agentCtx?.shopperId)
      const loopResult = profile
        ? await runWithProfile(profile, () => runWithAutomations(automationsEnabled, () => runWithTurnscript(turnscriptOn, runner), automationId))
        : await runWithAutomations(automationsEnabled, () => runWithTurnscript(turnscriptOn, runner), automationId)

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

      if (automationId && automationsEnabled) {
        const status = loopAborted ? 'failed' : 'completed'
        const now = new Date()
        const summaryBody = generateRunSummary(turnOutputText())
        const timestamp = now.toISOString().replace(/:/g, '-')
        const runPath = `.airo/jobs/${automationId}/runs/${timestamp}_${conversationId}_summary.md`
        const fileContent = matter.stringify(summaryBody, {
          automationId,
          conversationId,
          timestamp: now.toISOString(),
          status,
        })
        const workspace = createForWorkspace(appId, 'preview')
        if (workspace) {
          try {
            await workspace.files.write({ path: runPath, content: fileContent })
          } catch (err: unknown) {
            logger.warn('automation.run-summary.write-failed', {
              appId,
              automationId,
              message: err instanceof Error ? err.message : String(err),
            })
          }
        }
      }

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
          siteId,
          summarizer: this.deps.backgroundSummarizer,
        })
      }

      // Await the parallel classifier now — its outcome feeds both the end
      // hooks (usedFreeGrants accounting) and the BMS report below. Timeout
      // yields `undefined`, which both consumers handle (accounting defaults
      // to "customer pays", BMS attribution defaults to the base subscription).
      if (assessmentHandle && !assessmentOutcome) {
        assessmentOutcome = await assessmentHandle.awaitOutcome({ timeoutMs: PARALLEL_ASSESSMENT_TIMEOUT_MS })
          ?? assessmentHandle.getTimeoutFallback()
        if (!assessmentOutcome) {
          logger.info('assessment.parallel.unresolved_customer_pays', { appId, conversationId, sseSocketId })
        }
      }

      // Run end-of-message git squash + compute usedFreeGrants BEFORE persistence,
      // so the commitHash propagates into the persisted message metadata (matches
      // the WS beforeMessageComplete -> completeConversation ordering).
      if (this.deps.lifecycle) {
        const endResult = await runMessageEndHooks(this.deps.lifecycle, {
          appId, conversationId, sessionKey: sseSocketId,
          reason: loopAborted ? 'disconnection' : 'complete', userPrompt: content,
          assessmentOutcome, enableAssessmentOverride, budgetServiceEnabled,
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
          hadSelfRepair,
          careContext,
        })
        budgetReportFiled = budgetReport.filed
        // BMS mode: reconciliation is the source of truth for free-task billing.
        // runMessageEndHooks already returns false via deriveUsedFreeGrants when
        // budgetServiceEnabled=true; this override handles the positive case
        // (sessionWasFree=true from the budget report).
        if (budgetReport.sessionWasFree !== undefined) {
          usedFreeGrants = budgetReport.sessionWasFree
        }
      } else if (bmsBudgetId && budgetSessionId) {
        logger.error('sse.execution.budget_skipped_persistence_failed', {
          appId, conversationId, phase: 'success',
        })
      }

      // Fix session: record agent turn and manage phase transitions
      const lifecycleStore = this.deps.lifecycle?.sessionStore
      if (lifecycleStore && enableFixSession) {
        if (lifecycleStore.isFixSessionActive(sseSocketId)) {
          const askedQuestion = agentAskedQuestion(allExecutionSteps)
          const madeCodeChanges = agentMadeCodeChanges(allExecutionSteps)

          // Record agent turn in conversation arc for next Haiku call context.
          // Use the last 150 chars of the agent's actual response so Haiku can
          // reason about whether the agent asked a clarification question in prose.
          const agentText = lastTurnResult?.accumulatedContent ?? ''
          const agentTurnContent = agentText.length > 150
            ? agentText.slice(-150)
            : agentText || (madeCodeChanges ? 'made code changes' : 'investigated/searched')
          lifecycleStore.pushTurn(sseSocketId, { role: ConversationRole.agent, content: agentTurnContent })

          // Track agent signals for next turn's classification context
          lifecycleStore.setLastTurnAgentAskedQuestion(sseSocketId, askedQuestion)
          lifecycleStore.setLastTurnAgentMadeCodeChanges(sseSocketId, madeCodeChanges)

          // Phase transition: gathering → attempted when code changes made without asking
          if (lifecycleStore.getFixSessionPhase(sseSocketId) === FixSessionPhase.Gathering
              && madeCodeChanges && !askedQuestion) {
            lifecycleStore.transitionToAttempted(sseSocketId)
            logger.info('fix_session.phase.attempted', {
              appId, sessionKey: sseSocketId,
              turnCount: lifecycleStore.getFixSessionTurnCount(sseSocketId),
            })
          }
        }
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
            duration: `${Date.now() - turnStartMs}ms`,
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
      if (messageSpan && !supersededSuccess) {
        messageSpan.setAttribute('finishReason', finishReason)
        messageSpan.setAttribute('agent_id', finalAgentName)
        if (lastTurnResult?.currentStep) messageSpan.setAttribute('steps', lastTurnResult.currentStep)
        messageSpan.setAttribute('result', 'success')
        messageSpan.setStatus({ code: SpanStatusCode.OK })
        messageSpan.end()
        this.markSpanEnded(messageSpan)
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
            assessmentOutcome, enableAssessmentOverride, budgetServiceEnabled,
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
          hadSelfRepair,
          careContext,
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
        if (messageSpan && !supersededError) {
          messageSpan.setAttribute('finishReason', 'aborted')
          messageSpan.setAttribute('result', 'aborted')
          messageSpan.setStatus({ code: SpanStatusCode.UNSET })
          messageSpan.end()
          this.markSpanEnded(messageSpan)
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
        const rawErr = error instanceof Error ? error : new Error(String(error))
        // Preserve the stream-budget PATTERN detection the chat onError did
        // before AIROBUILD-3088 collapsed the reader: classifyTurnError only
        // recognizes BudgetExceededError instances, not the budget-text patterns
        // classifyStreamBudgetError matches (containsBudgetExceededPattern).
        // Normalize first so a pattern-matched budget error surfaced via
        // getFinalResult still classifies as BUDGET_EXCEEDED.
        const streamBudget = classifyStreamBudgetError(rawErr)
        const err = streamBudget.type === 'budget_exceeded' ? streamBudget.budgetError : rawErr
        const classified = classifyTurnError(err)
        // Prefer classified.clientMessage for errors that sanitize internal
        // detail (BMS API paths). Matches the WS wire contract.
        const clientMessage = classified.clientMessage ?? err.message
        const { errorType, statusCode, retryAttempts, retryReason } = classified
        const terminalErrorInfo = analyzeStreamError(err)
        // Log the same status/errorType that drive the client wire event below,
        // not just analyzeStreamError's. analyzeStreamError has no statusCode for
        // errors classifyTurnError assigns a synthetic one to (e.g. a
        // TypeValidationError → STREAM_TYPE_VALIDATION/502), so those otherwise
        // log as blank-status with no errorType and stay invisible in Loki/the
        // dashboard. Prefer the analyzed upstream status when present (keeps the
        // existing 400/408/503/504 capture), fall back to the classified one.
        // Matches the WS agent.error log shape.
        const logStatusCode = terminalErrorInfo.statusCode ?? statusCode
        logger.error('sse.execution.error', {
          appId, conversationId, ...errorFields(err), ...(requestId && { requestId }),
          ...(logStatusCode !== undefined && { statusCode: logStatusCode }),
          ...(errorType !== undefined && { errorType }),
          // Same value sent on the wire; logged so Loki can measure the
          // retryable share of terminal errors per errorType.
          isRetryable: classified.isRetryable,
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
        if (messageSpan && !supersededError) {
          messageSpan.setAttribute('finishReason', 'error')
          messageSpan.setAttribute('error_message', clientMessage)
          messageSpan.setAttribute('error_type', err.name || 'Error')
          messageSpan.setAttribute('result', 'error')
          messageSpan.setStatus({ code: SpanStatusCode.ERROR })
          messageSpan.end()
          this.markSpanEnded(messageSpan)
        }
        await this.publishTerminal(appId, conversationId, {
          type: 'error', content: clientMessage,
          data: {
            source: 'ai_response',
            error: clientMessage,
            timestamp: new Date().toISOString(),
            ...(errorType !== undefined && { errorType }),
            ...(statusCode !== undefined && { statusCode }),
            // Wire-level retry hint: lets the client auto-resend transient
            // classes (e.g. a transient STREAM_TYPE_VALIDATION) that the server
            // cannot retry itself because they surface in-band after the
            // retryWithBackoff stream-open boundary.
            isRetryable: classified.isRetryable,
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
            hadSelfRepair,
            careContext,
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
        this.deps.lifecycle?.sessionStore.clearTurnState(sseSocketId)
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
      } else if (messageSpan && !this.isSpanEnded(messageSpan)) {
        // Superseded by a newer execute() — the success/error paths skipped
        // ending the transaction (guarded by !superseded*), so end it here.
        messageSpan.setAttribute('finishReason', 'superseded')
        messageSpan.setAttribute('result', 'aborted')
        messageSpan.setStatus({ code: SpanStatusCode.UNSET })
        messageSpan.end()
        this.markSpanEnded(messageSpan)
      }
    }
    return turnResult
  }

  private async executeSupportUnderTrace(
    params: ExecuteParams,
    // _turnSnapshot intentionally unused — kept for signature parity with executeUnderTrace.
    _turnSnapshot: TurnSnapshotState,
  ): Promise<TurnExecutionResult> {
    const {
      appId, conversationId, content, siteId, authType,
      lifecycleContext, requestId, messageSpan,
    } = params
    const agentCtx = lifecycleContext?.agentContext
    const sseSocketId = sseSessionKey(conversationId)

    // Cancel any in-flight prior turn for this conversation.
    this.abortControllers.get(conversationId)?.abort()
    const abortController = new AbortController()
    this.abortControllers.set(conversationId, abortController)

    // Bridge sseRegistry → eventChannel. Capture streamState for subscriber
    // cleanup and ownership-guarded activeStreams.delete in finally.
    const streamState = this.setupStreamState({
      conversationId, appId, agentNameForApm: 'support',
      requestId, messageSpan,
    })

    // Persist user message + open agent-turn slot.
    const persistenceContext: SSEPersistenceContext = {
      socketId: sseSocketId, agentName: 'support', appId, siteId,
      conversation: { conversationId },
      metadata: {
        authType,
        ...(agentCtx?.customerId && { customerId: agentCtx.customerId }),
      },
    }

    let turnResult: TurnExecutionResult = { success: false }

    // Single outer try/finally ensures cleanup (unsubscribe, activeStreams.delete,
    // abortControllers.delete, APM end) runs on ALL exit paths — persist failure,
    // guard paths, happy path, and thrown exceptions.
    try {
      // Persist user message + open agent-turn slot.
      try {
        await this.deps.conversationPersistence.continueConversation(conversationId, content, persistenceContext)
        await this.deps.conversationPersistence.startAgentTurn(conversationId, persistenceContext)
      } catch (err) {
        logger.error('sse.execution.support.persist_failed', { appId, conversationId, ...errorFields(err) })
        await this.emitGuardPathFailure(
          appId, conversationId,
          'Sorry, something went wrong. Try again in a moment.',
          persistenceContext,
        )
        return { success: false }
      }

      this.emitConversationStartIfFirstTurn(lifecycleContext, conversationId, 'support')

      // Guard 0: Switchboard kill-switch. Read once per turn; defaults to
      // enabled when the dep is unwired (tests, dev) so the support path is
      // never accidentally shut off. Sits above guards 1 & 2 so an ops-driven
      // disable wins over visitor / bridge configuration.
      if (this.deps.isCareEnabled && !this.deps.isCareEnabled()) {
        logger.warn('sse.execution.support.flag_disabled', { appId, conversationId })
        await this.emitGuardPathFailure(
          appId, conversationId,
          'Support is temporarily unavailable. Please try again shortly.',
          persistenceContext,
        )
        return { success: false }
      }

      // Guard 1: missing visitorId. Guards publish to the event channel, so
      // setupStreamState must have run before reaching this point.
      if (!agentCtx?.visitorId) {
        logger.warn('sse.execution.support.visitor_missing', { appId, conversationId })
        await this.emitGuardPathFailure(
          appId, conversationId,
          'Sorry, support is unavailable — visitor session missing. Reload and try again.',
          persistenceContext,
        )
        return { success: false }
      }

      // Guard 2: bridge not configured. Fires when AIRO_CARE_BASE_URL is
      // unset — the local-dev default points at the Care dev environment, so
      // this is now reached only when a dev explicitly clears the var or in
      // an environment that intentionally disables Care.
      const careBridge = this.deps.careBridge
      if (!careBridge) {
        logger.warn('sse.execution.support.bridge_disabled', { appId, conversationId })
        await this.emitGuardPathFailure(
          appId, conversationId,
          'Support is not configured on this server.',
          persistenceContext,
        )
        return { success: false }
      }

      // Drain the bridge → publish to event channel. Bridge guarantees exactly
      // one terminal `complete` at the end; we use publishTerminal for it,
      // publishNonTerminal for everything else. Accumulate events for persistence.
      const accumulatedEvents: PersistenceStreamingEvent[] = []
      let sawTerminal: boolean = false
      let finishReason: 'stop' | 'error' = 'stop'
      for await (const event of careBridge.streamSupportTurn({
        aabConversationId: conversationId,
        visitorId: agentCtx.visitorId,
        message: content,
        abortSignal: abortController.signal,
      })) {
        accumulatedEvents.push({ type: event.type, content: event.content, data: event.data, timestamp: new Date() })
        if (event.type === 'complete') {
          sawTerminal = true
          const reason = (event.data as { finishReason?: string } | undefined)?.finishReason
          finishReason = reason === 'error' ? 'error' : 'stop'
          await this.publishTerminal(appId, conversationId, event)
        } else {
          await this.publishNonTerminal(appId, conversationId, event)
        }
      }
      if (!sawTerminal) {
        // Defensive: bridge should always end with complete. If it didn't,
        // emit one ourselves so the client doesn't hang.
        logger.warn('sse.execution.support.no_terminal', { appId, conversationId })
        const defensiveComplete = {
          type: 'complete' as const, content: '', data: { finishReason: 'stop' },
          agentName: 'support', conversationId,
        }
        accumulatedEvents.push({ type: defensiveComplete.type, content: defensiveComplete.content, data: defensiveComplete.data, timestamp: new Date() })
        await this.publishTerminal(appId, conversationId, defensiveComplete)
      }
      await this.deps.conversationPersistence.completeConversation(
        conversationId, accumulatedEvents, { finishReason }, persistenceContext
      ).catch((persistErr: unknown) => {
        logger.error('sse.execution.support.complete_failed', { appId, conversationId, ...errorFields(persistErr) })
      })
      turnResult = { success: finishReason === 'stop' }
      return turnResult
    } finally {
      if (this.abortControllers.get(conversationId) === abortController) {
        this.abortControllers.delete(conversationId)
      }
      // Unsubscribe all event channel subscribers registered for this turn.
      if (this.activeStreams.get(conversationId) === streamState) {
        for (const subId of streamState.subscriberIds) {
          this.deps.eventChannel.unsubscribe(conversationId, subId)
        }
        this.activeStreams.delete(conversationId)
      }
      // End the messageSpan to match the build path lifecycle.
      if (messageSpan && !this.isSpanEnded(messageSpan)) {
        messageSpan.setAttribute('result', turnResult.success ? 'success' : 'error')
        messageSpan.setStatus({ code: turnResult.success ? SpanStatusCode.OK : SpanStatusCode.ERROR })
        messageSpan.end()
        this.markSpanEnded(messageSpan)
      }
    }
  }
}
