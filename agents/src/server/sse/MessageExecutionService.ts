import type { ConversationEventChannel, ConversationMessage, PersistenceStreamingEvent, ConversationContext, ValidationMessageEventData, StreamTimingData } from '@airo/ai-transport'
import {
  StreamPartProcessor,
  StreamTimingTracker,
  executeAgentLoop,
  buildChatSignalsTraceContext,
  createAgentInvocation,
  getCurrentTraceIds,
  formatAgentId,
  emitTurnError,
  classifyTurnError,
  runPostStreamValidation,
  turnEndedWithStopAfterTool,
  withBudgetRecovery,
} from '@airo/ai-transport'
import type { ResponseMetadata } from '@airo/ai-transport'
import { BudgetExceededError, containsBudgetExceededPattern } from '@airo/ai-common'
import { grantSessionManager } from '@airo/ai-grants'
import { createGrantBudgetRecoveryCallback } from '../grant-budget-recovery-callback.js'
import { context as otelContext, trace } from '@opentelemetry/api'
import type { AgentsMessagePersistence } from '../conversation-persistence.js'
import type { EventStreamRegistry } from './EventStreamRegistry.js'
import { SSEClientActionService } from './SSEClientActionService.js'
import { registerExternalActionService, unregisterExternalActionService, getClientActionService } from '../ai-lib-websocket-server.js'
import { sseSessionKey } from './session-key.js'
import { logger, errorFields } from '../../logging/index.js'
import { getBudgetServiceClient } from '../../services/budget-service-instance.js'
import { toBudgetUpdatePayload } from '@airo/ai-lib/budget'
import { safeProcessBudgetReport } from '../budget-report-handler.js'
import { runWithModelOverride } from '@airo/ai-lib'
import { resolveProfile, runWithProfile } from '../../profiles/index.js'
import { guardAllowedOverrideModel, resolveOverride } from '../model-override.js'
import type { AssessmentOutcome, ClassifierMode } from '../../agents/assessment-agent/index.js'
import { PARALLEL_ASSESSMENT_TIMEOUT_MS } from '../assessment-executor.js'
import type { PostStreamValidatorResult } from '../post-stream-validator.js'
import {
  runStartGitHook, startParallelAssessment, runMessageEndHooks,
  type MessageLifecycleDeps, type ParallelAssessmentHandle,
} from '../message-lifecycle.js'
import {
  buildDynamicDataMessage, buildTodoContextMessage, buildRagContextMessage,
  collectImagesFromFormattedContexts, dataUrlsToProcessedFiles,
  checkAndTriggerSummarization,
} from '../context-builders.js'
import { computeDebugTurnStats } from '../../utils/debug-turn-stats.js'

/** Short timeout for awaiting the classifier on an errored turn — the user is
 *  already seeing a failure, so don't delay terminal events for a slow classifier.
 *  usedFreeGrants defaults to false when the outcome is unavailable. */
const ERRORED_TURN_ASSESSMENT_TIMEOUT_MS = 500

interface ExecutionDeps {
  getAgent: (agentId?: string) => any
  contextManager: { loadContextMessages: (context: Record<string, unknown>) => Promise<{ contextMessages: any[]; formattedContexts?: any[] }> }
  loadConversationHistory: (conversationId: string, appId: string, agentName: string) => Promise<ConversationMessage[]>
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
}

/**
 * Persistence context carries optional commitHash / usedFreeGrants once the
 * end-of-message hooks compute them, so conversationPersistence.completeConversation
 * can stamp them on the persisted message metadata. The fields are optional and
 * mutated in place — reads use ?? defaults.
 */
interface SSEPersistenceContext extends ConversationContext {
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
    agentProfileSelectorEnabled?: boolean
    customerId?: string
    visitorId?: string
    trafficSessionId?: string
    debugStatsEnabled?: boolean
  }
  isInitialPrompt?: boolean
}

interface ExecuteParams {
  appId: string
  conversationId: string
  content: string
  siteId: string
  agentId: string
  agentProfile?: string
  templateId?: string
  modelOverride?: string
  // These are opaque wire shapes consumed by tools downstream. Kept as
  // unknown here so assignments into executionContext don't widen to any.
  visualContext?: unknown
  aiEditContext?: unknown
  selectedAssets?: unknown[]
  todoListContext?: unknown
  isActionRequest?: boolean
  customContext?: unknown
  buildErrorContext?: unknown
  bmsBudgetId?: string
  budgetSessionId?: string
  /** Original subscriptionId for override detection (care agent, test accounts) */
  subscriptionId?: string
  authType?: string
  /** Raw HTTP request headers — used to extract Signals/OTEL trace propagation. */
  requestHeaders?: Record<string, string | string[] | undefined>
  /** JWT agent context + derived lifecycle hints (isInitialPrompt, multi-turn caches). */
  lifecycleContext?: LifecycleContext
  market?: string
}

interface ActiveStream {
  appId: string
  convId: string
  subscriberIds: Set<string>
}

export class MessageExecutionService {
  private deps: ExecutionDeps
  private abortControllers = new Map<string, AbortController>()
  private activeStreams = new Map<string, ActiveStream>()

  constructor(deps: ExecutionDeps) {
    this.deps = deps
  }

  hasActiveStream(conversationId: string): boolean {
    return this.activeStreams.has(conversationId)
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

  stop(conversationId: string): void {
    const controller = this.abortControllers.get(conversationId)
    if (!controller) {
      logger.warn('sse.execution.stop_no_active_stream', { conversationId })
      return
    }

    controller.abort()
    logger.info('sse.execution.stopped', { conversationId })

    // The execute() loop observes the abort and publishes its own terminal
    // `complete` when it returns — but that can take seconds (mid-chunk
    // reader.read(), a getFinalResult() await, a provider that doesn't
    // honor abortSignal). Emit a user_stopped complete now so the client
    // UI resets immediately. execute()'s later publish is a no-op on the
    // client side (finalizeStream early-returns when activeStream is null)
    // and produces at most a duplicate event on any other subscriber.
    const active = this.activeStreams.get(conversationId)
    if (active) {
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
        data: { finishReason: 'user_stopped', ...getCurrentTraceIds() },
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

  private async streamAgentTurn(
    agent: any,
    agentName: string,
    message: string,
    opts: {
      conversationId: string
      appId: string
      siteId: string
      sseSocketId: string
      abortSignal: AbortSignal
      streamingEvents: PersistenceStreamingEvent[]
      executionContext: Record<string, unknown>
      streamState: ActiveStream
    },
  ): Promise<{ accumulatedContent: string; currentStep: number; finalResult: any; finishReason: string; responseMetadata: ResponseMetadata }> {
    const { conversationId, appId, siteId, sseSocketId, abortSignal, streamingEvents, executionContext, streamState } = opts

    const pendingPublishes: Promise<unknown>[] = []
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

    // emit is a no-op: tracker diagnostics surface via logger.warn, not the event channel.
    const tracker = new StreamTimingTracker({
      socket: { id: sseSocketId, emit: () => {} },
      agentName,
      modelName: 'unknown',
      logger,
      abortController: { signal: abortSignal },
    })

    const processor = new StreamPartProcessor({
      onTextDelta: (text) => {
        tracker.recordTextChunk()
        publish({ conversationId, type: 'chunk', content: text, data: {}, agentName })
        streamingEvents.push({ type: 'chunk', content: text, timestamp: new Date() })
      },
      onToolStart: (toolCallId, toolName, step) => {
        publish({
          conversationId, type: 'tool_start',
          content: `Using ${toolName}...`,
          data: { step, tool: { id: toolCallId, name: toolName, input: {} } },
          agentName,
        })
        streamingEvents.push({ type: 'tool_start', data: { tool: { id: toolCallId, name: toolName } }, timestamp: new Date() })
      },
      onToolInputDelta: (toolCallId, delta) => {
        publish({
          conversationId, type: 'tool_input_delta', content: '',
          data: { toolId: toolCallId, delta }, agentName,
        })
      },
      onToolCall: (toolCallId, toolName, parsedInput) => {
        tracker.pauseGapTracking(toolName)
        publish({
          conversationId, type: 'tool_call',
          content: `${toolName} input ready`,
          data: { step: processor.currentStep, tool: { id: toolCallId, name: toolName, input: parsedInput } },
          agentName,
        })
      },
      onToolResult: (toolCallId, result) => {
        tracker.resumeGapTracking()
        const toolCall = processor.getToolCall(toolCallId)
        publish({
          conversationId, type: 'tool_result',
          content: `${toolCall?.name ?? toolCallId} completed`,
          data: { step: processor.currentStep, tool: { id: toolCallId, name: toolCall?.name ?? toolCallId, input: toolCall?.input, output: result } },
          agentName,
        })
        streamingEvents.push({ type: 'tool_result', data: { tool: { id: toolCallId, name: toolCall?.name ?? toolCallId, input: toolCall?.input, output: result } }, timestamp: new Date() })
      },
      onToolError: (toolCallId, error) => {
        tracker.resumeGapTracking()
        const toolCall = processor.getToolCall(toolCallId)
        publish({
          conversationId, type: 'tool_result',
          content: `${toolCall?.name ?? toolCallId} failed: ${error.message}`,
          data: { step: processor.currentStep, tool: { id: toolCallId, name: toolCall?.name ?? toolCallId, input: toolCall?.input || {}, output: {}, error: error.message, is_error: true } },
          agentName,
        })
        streamingEvents.push({ type: 'tool_result', data: { tool: { id: toolCallId, name: toolCall?.name ?? toolCallId, input: toolCall?.input || {}, error: error.message, is_error: true } }, timestamp: new Date() })
      },
      onStepStart: (step) => {
        publish({
          conversationId, type: 'step_start', content: '',
          data: { step, stepType: 'reasoning', agentId: agentName, agentName: agent.getName?.() ?? agentName },
          agentName,
        })
        streamingEvents.push({ type: 'step_start', data: { step }, timestamp: new Date() })
      },
      onError: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (!BudgetExceededError.isInstance(error) && containsBudgetExceededPattern(errorMessage)) {
          throw new BudgetExceededError(
            'Your AI usage budget has been reached.',
            400,
            errorMessage
          )
        }
        throw error
      },
    })

    const contextResult = await this.deps.contextManager.loadContextMessages(executionContext)
    const allContextMessages = contextResult.contextMessages
    const beforeHistory = allContextMessages.filter((m: any) => m.insertionOrder === 'before_history')
      .map((m: any) => ({ role: m.role, content: m.content, ...(m.cachePoint && { cachePoint: m.cachePoint }) }))
    const afterHistory = allContextMessages.filter((m: any) => m.insertionOrder !== 'before_history')
      .map((m: any) => ({ role: m.role, content: m.content, ...(m.cachePoint && { cachePoint: m.cachePoint }) }))

    const allImages = collectImagesFromFormattedContexts(contextResult.formattedContexts)
    const processedFiles = allImages.length > 0 ? dataUrlsToProcessedFiles(allImages) : undefined
    if (processedFiles?.length) {
      logger.info('sse.vision.attach', { count: processedFiles.length })
    }

    const metadata = (executionContext.metadata ?? {}) as Record<string, unknown>
    const todoListContext = executionContext['todoListContext']

    const [ragContextMessage, todoContextMessage, historyMessages] = await Promise.all([
      buildRagContextMessage({ userMessage: message, appId, sessionId: sseSocketId }),
      buildTodoContextMessage({
        sessionId: sseSocketId, appId, metadata,
        contextAttachments: todoListContext
          ? [{ type: 'todo_list_context', data: todoListContext }]
          : undefined,
        stateManager: this.deps.stateManager,
      }),
      this.deps.loadConversationHistory(conversationId, appId, agentName).catch(err => {
        logger.warn('sse.execution.history_load_failed', { appId, conversationId, ...errorFields(err) })
        return [] as ConversationMessage[]
      }),
    ])
    const dynamicDataMessage = buildDynamicDataMessage(metadata)

    const extraAfterHistory = [ragContextMessage, todoContextMessage, dynamicDataMessage]
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map(m => ({ role: m.role, content: m.content }))

    const messages = [...historyMessages, ...afterHistory, ...extraAfterHistory]

    // Create the Langfuse-facing agent-invocation span under the trace context
    // established in execute(). This mirrors the WS path (streamAgentResponse)
    // so both transports produce identical invocation telemetry. The handle
    // ends on every exit path (success, abort, error), idempotently.
    const invocation = createAgentInvocation({
      agent,
      agentName,
      prompt: message,
      conversationId,
      logger: { warn: (event, fields) => logger.warn(event, fields) },
    })

    // Propagate OTel trace ID to GoCode via x-trace-id header for cross-service
    // log correlation (mirrors WS at experimental-websocket-server.ts:3761-3770).
    // unified-provider reads this off executionContext.metadata.traceId when
    // building outgoing GoCode requests; without it, SSE-initiated LLM calls
    // land in GoCode logs with no trace link back to the conversation.
    const invocationSpan = trace.getSpan(invocation.context)
    const traceId = invocationSpan?.spanContext().traceId
    const executionContextWithTrace: Record<string, unknown> = {
      socketId: sseSocketId,
      ...executionContext,
      ...(traceId && {
        metadata: {
          ...((executionContext.metadata as Record<string, unknown> | undefined) ?? {}),
          traceId,
        },
      }),
    }

    try {
      const streamResult: any = await invocation.runUnder(async () =>
        agent.streamGenerate(message, {
          ...(beforeHistory.length > 0 && { context: beforeHistory }),
          ...(messages.length > 0 && { messages }),
          executionContext: executionContextWithTrace,
          ...(processedFiles && processedFiles.length > 0 && { files: processedFiles }),
          abortSignal,
        }),
      )

      invocation.captureMetadata(streamResult.response)

      const baseStream = streamResult.baseStream
      if (baseStream) {
        const reader: ReadableStreamDefaultReader = (baseStream as ReadableStream).getReader()
        try {
          while (true) {
            if (abortSignal.aborted) break
            const { done, value } = await reader.read()
            if (done) break
            if (value?.part) {
              tracker.recordChunk()
              processor.processPart(value.part)
              await Promise.all(pendingPublishes.splice(0))
            }
          }
        } finally {
          reader.releaseLock()
          if (pendingPublishes.length > 0) await Promise.all(pendingPublishes.splice(0))
        }
      } else {
        for await (const chunk of streamResult.textStream) {
          if (abortSignal.aborted) break
          tracker.recordChunk()
          processor.processPart({ type: 'text-delta', text: chunk })
          await Promise.all(pendingPublishes.splice(0))
        }
        if (pendingPublishes.length > 0) await Promise.all(pendingPublishes.splice(0))
      }

      const timingData: StreamTimingData = tracker.finalize()
      logger.info('sse.stream.timing', { appId, conversationId, agentName, ...timingData })

      let finishReason = 'complete'
      let finalResult: any
      let finalResultError: unknown
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
        logger.warn('sse.execution.getFinalResult.failed', { appId, conversationId, ...errorFields(err) })
        finalResultError = err
        finishReason = 'result_fetch_failed'
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

      if (abortSignal.aborted) {
        invocation.endAborted({ outputText: accumulatedContent, responseType })
      } else if (finalResultError !== undefined) {
        invocation.endError(finalResultError, { finishReason })
      } else {
        const usageToTrack = finalResult?.totalUsage ?? finalResult?.usage
        invocation.endSuccess({
          outputText: accumulatedContent,
          responseType,
          ...(usageToTrack && { usage: usageToTrack }),
          finishReason,
        })
      }

      return { accumulatedContent, currentStep, finalResult, finishReason, responseMetadata: finalMetadata }
    } catch (err) {
      if (BudgetExceededError.isInstance(err)) {
        invocation.endError(err, { finishReason: 'budget_exceeded' })
      } else {
        invocation.endError(err)
      }
      throw err
    }
  }

  async execute(params: ExecuteParams): Promise<void> {
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
      logPrefix: 'sse',
      logFields: { appId: params.appId, conversationId: params.conversationId },
      logger: { warn: (event, fields) => logger.warn(event, fields) },
    })
    await otelContext.with(traceCtx, () => this.executeUnderTrace(params))
  }

  private async executeUnderTrace(params: ExecuteParams): Promise<void> {
    const {
      appId, conversationId, content, siteId, agentId, agentProfile,
      templateId, modelOverride,
      visualContext, aiEditContext, selectedAssets,
      todoListContext, isActionRequest, customContext, buildErrorContext,
      bmsBudgetId, budgetSessionId, subscriptionId, authType,
      lifecycleContext, market,
    } = params

    const resolvedAgentId = agentId
    const sseSocketId = sseSessionKey(conversationId)
    const agentCtx = lifecycleContext?.agentContext
    const enableAssessmentAgent = !!agentCtx?.enableAssessmentAgent
    const enableAssessmentOverride = !!agentCtx?.enableAssessmentOverride

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
        classifierMode: agentCtx?.assessmentClassifier,
      })
      await runStartGitHook(this.deps.lifecycle, {
        appId, conversationId, sessionKey: sseSocketId, message: content,
      })
    }

    const persistenceContext: SSEPersistenceContext = {
      socketId: sseSocketId,
      agentName: resolvedAgentId,
      appId,
      siteId,
      conversation: { conversationId },
      metadata: { authType },
    }

    this.deps.resetPostStreamRetries?.(sseSocketId)

    this.abortControllers.get(conversationId)?.abort()

    // Bridge sseRegistry → eventChannel BEFORE pre-turn persistence runs. If we
    // bridge after, a persistence failure publishes terminal events to an empty
    // eventChannel and the /stream client hangs forever.
    const streamState: ActiveStream = { appId, convId: conversationId, subscriberIds: new Set() }
    this.activeStreams.set(conversationId, streamState)
    const sseSubscribers = this.deps.sseRegistry.getSubscribers(conversationId)
    for (const sub of sseSubscribers) {
      this.deps.eventChannel.subscribe(conversationId, sub)
      streamState.subscriberIds.add(sub.id)
    }

    try {
      await this.deps.conversationPersistence.continueConversation(conversationId, content, persistenceContext)
      await this.deps.conversationPersistence.startAgentTurn(conversationId, persistenceContext)
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
      return
    }

    const abortController = new AbortController()
    this.abortControllers.set(conversationId, abortController)

    const clientActionService = new SSEClientActionService(conversationId, appId, this.deps.eventChannel)
    registerExternalActionService(sseSocketId, clientActionService)

    const streamingEvents: PersistenceStreamingEvent[] = []

    // Shared execution context - tools modify this in-place (e.g. __autoContinue)
    // Build contextAttachments from the incoming context data (SSE path)
    // This mirrors the ChatMessageBuilder conversion on the WebSocket path
    const contextAttachments: Array<{ type: string; data: unknown; persistence: string; renderStrategy: string; metadata: { timestamp: number; source: string } }> = []
    const timestamp = Date.now()

    if (aiEditContext) {
      contextAttachments.push({
        type: 'ai_edit_context',
        data: aiEditContext,
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'ai-edit-dialog'
        }
      })
    }

    if (visualContext) {
      contextAttachments.push({
        type: 'visual_context',
        data: visualContext,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'iframe-capture'
        }
      })
    }

    if (selectedAssets) {
      contextAttachments.push({
        type: 'selected_assets',
        data: selectedAssets,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'asset-manager'
        }
      })
    }

    if (buildErrorContext) {
      contextAttachments.push({
        type: 'build_error',
        data: buildErrorContext,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: 'publish-failure'
        }
      })
    }

    const executionContext: Record<string, unknown> = {
      metadata: {
        appId, siteId, conversationId, templateId, modelOverride, agentProfile,
        agentId: resolvedAgentId,
        ...(subscriptionId && { subscriptionId }),
        ...(agentCtx?.customerId && { customerId: agentCtx.customerId }),
        ...(bmsBudgetId && { bmsBudgetId, budgetServiceEnabled: true }),
        ...(budgetSessionId && { budgetSessionId }),
        ...(market && { market }),
      },
      ...(contextAttachments.length > 0 && { contextAttachments }),
      todoListContext, isActionRequest, customContext,
    }

    // Resolve agent profile + model override from flags (per-project metadata
    // takes precedence over JWT defaults; both require their own feature flags).
    const profile = resolveProfile({
      agentProfileSelectorEnabled: !!agentCtx?.agentProfileSelectorEnabled,
      perProjectProfile: agentProfile,
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

    // Budget recovery for grants-mode (non-BMS) sessions
    const useGrantRecovery = !bmsBudgetId && !budgetSessionId && !!subscriptionId
    const budgetRecoveryCallback = useGrantRecovery
      ? createGrantBudgetRecoveryCallback({ logger })
      : undefined
    if (useGrantRecovery) {
      grantSessionManager.registerSession(sseSocketId, subscriptionId!)
    }

    try {
      let lastTurnResult: Awaited<ReturnType<typeof this.streamAgentTurn>> | undefined
      let currentIteration = 0

      const runLoop = () => executeAgentLoop(resolvedAgentId, content, {
        getAgent: (name) => this.deps.getAgent(name),
        streamAgentTurn: async (agent, agentName, message, iteration) => {
          currentIteration = iteration
          if (iteration > 0) {
            persistenceContext.agentName = agentName
            try {
              await this.deps.conversationPersistence.startAgentTurn(conversationId, persistenceContext)
            } catch (err) {
              logger.error('sse.execution.persistence_handoff_turn_failed', {
                appId, conversationId, iteration, agentName, ...errorFields(err),
              })
              throw err
            }
          }

          const doStream = async (prompt: string) => this.streamAgentTurn(agent, agentName, prompt, {
            conversationId, appId, siteId, sseSocketId,
            abortSignal: abortController.signal,
            streamingEvents, executionContext, streamState,
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
                  streamingEvents
                    .filter((e) => e.type === 'tool_result' && e.data?.tool?.is_error)
                    .map((e) => e.data.tool.id as string),
                )
                return streamingEvents
                  .filter((e) => e.type === 'tool_start' && e.data?.tool?.name && !erroredToolIds.has(e.data.tool.id as string))
                  .map((e) => e.data.tool.name as string)
              },
              getAccumulatedContent: () => streamingEvents
                .filter((e) => e.type === 'chunk')
                .map((e) => e.content ?? '')
                .join(''),
              clearTurnState: () => { streamingEvents.length = 0 },
              publishStreamRetry: async (name: string) => {
                await this.deps.eventChannel.publish(conversationId, {
                  conversationId, type: 'stream_retry', content: '',
                  data: { reason: 'budget_exceeded_grant_advanced', agentName: name }, agentName: name,
                }).catch((err: unknown) => {
                  logger.warn('sse.stream_retry.publish_failed', { conversationId, error: err instanceof Error ? err.message : String(err) })
                })
              },
              logger,
            })
          } else {
            lastTurnResult = await doStream(message)
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
          try {
            await this.deps.onAgentChanged?.(conversationId, oldAgent, newAgent, appId)
          } catch (err) {
            // Tag handoff hook failures distinctly — without this, the outer
            // catch logs them as a generic sse.execution.error.
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
            const toolCalls = streamingEvents
              .filter((e: any) => e.type === 'tool_start' && e.data?.tool)
              .map((e: any) => ({ toolName: e.data.tool.name, args: e.data.tool.input }))

            const agent = this.deps.getAgent(agentName)
            const stopAfterTools = agent?.getConfig?.()?.stopAfterTools
            if (turnEndedWithStopAfterTool(toolCalls, stopAfterTools)) return

            const result = await runPostStreamValidation({
              validator: this.deps.postStreamValidator!,
              socketId: sseSocketId,
              agentName,
              context: executionContext,
              toolCalls,
              abortSignal: abortController.signal,
              iteration: currentIteration,
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
        getAgentId: formatAgentId,
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

      const loopResult = profile
        ? await runWithProfile(profile, runWithOverride)
        : await runWithOverride()

      const finalAgentName = loopResult.finalAgentName
      const loopAborted = loopResult.termination === 'aborted' || abortController.signal.aborted
      const finishReason = loopAborted ? 'aborted' : (lastTurnResult?.finishReason ?? 'complete')

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

      await this.deps.conversationPersistence.completeConversation(
        conversationId, streamingEvents, lastTurnResult?.finalResult, persistenceContext
      ).catch(err => {
        logger.error('sse.execution.persistence_failed', { appId, conversationId, ...errorFields(err) })
      })

      // Read back commitHash and usedFreeGrants (set above or by persistence fallback)
      const commitHash: string | null = persistenceContext.commitHash ?? null
      let usedFreeGrants: boolean = persistenceContext.usedFreeGrants ?? false

      if (!loopAborted && bmsBudgetId && budgetSessionId) {
        const reconcileTimer = setTimeout(() => {
          this.publishNonTerminal(appId, conversationId, {
            conversationId, type: 'budget_status', content: '',
            data: { status: 'reconciling' }, agentName: 'system',
          })
        }, 10_000)
        if (typeof reconcileTimer === 'object' && 'unref' in reconcileTimer) reconcileTimer.unref()
        try {
          const budgetClient = getBudgetServiceClient()
          if (budgetClient) {
            const session = await budgetClient.getSession(budgetSessionId)

            // safeProcessBudgetReport handles errors gracefully so createReport still executes
            const { result: budgetResult } = safeProcessBudgetReport(
              {
                budgetId: bmsBudgetId,
                sessionId: budgetSessionId,
                totalCost: session.costTotal,
                sessionItems: session.sessionItems,
                steps: [],
                assessmentOutcome,
                wasUserAborted: loopAborted,
                subscriptionId,
              },
              { budgetId: bmsBudgetId, sessionId: budgetSessionId },
            )
            const { reportItems, sessionWasFree } = budgetResult

            const report = await budgetClient.createReport(budgetSessionId, { reportItems, allowOverage: true })
            // BMS mode: update usedFreeGrants from cost attribution result
            // (persistenceContext.usedFreeGrants is always false in BMS mode since
            // deriveUsedFreeGrants returns false when budgetServiceEnabled=true)
            usedFreeGrants = sessionWasFree
            try {
              const budget = await budgetClient.getBudget(bmsBudgetId)
              const payload = toBudgetUpdatePayload(report, budget, sessionWasFree)

              logger.info('budget.update.payload_sent', {
                budgetId: bmsBudgetId,
                sessionId: budgetSessionId,
                reportId: report.reportId,
                sessionWasFree,
                reportItemCount: payload.assignment.reportItems.length,
                totalBudgetCost: report.budgetCostTotal,
                totalProductCost: report.productCostTotal,
                categories: payload.assignment.reportItems.map(item => item.category),
                budgetItemCount: payload.budgetItems.length,
              })

              await this.publishNonTerminal(appId, conversationId, {
                conversationId, type: 'budget_update', content: '',
                data: payload as unknown as Record<string, unknown>,
                agentName: 'system',
              })
            } catch (getBudgetErr) {
              logger.error('budget.report.payload_failed', { budgetId: bmsBudgetId, sessionId: budgetSessionId, reportId: report.reportId, ...errorFields(getBudgetErr) })
              await this.publishNonTerminal(appId, conversationId, {
                conversationId, type: 'budget_update', content: '', data: { refreshRequired: true }, agentName: 'system',
              })
            }
          }
        } catch (err) {
          logger.error('budget.report.failed', { appId, budgetId: bmsBudgetId, sessionId: budgetSessionId, ...errorFields(err) })
        } finally {
          clearTimeout(reconcileTimer)
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
          data: { step: lastTurnResult?.currentStep ?? 1, isFinal: true, agentId: finalAgentName },
          agentName: finalAgentName,
        })

        await this.publishTerminal(appId, conversationId, {
          conversationId, type: 'complete', content: '',
          data: { agentId: finalAgentName, finishReason, totalSteps: lastTurnResult?.currentStep ?? 1, commitHash, usedFreeGrants, ...getCurrentTraceIds() },
          agentName: finalAgentName,
        })
      }

      logger.info('sse.execution.complete', { appId, conversationId, agentId: finalAgentName, finishReason, iterations: loopResult.iterations })
    } catch (error) {
      if (this.deps.lifecycle) {
        const reason: 'error' | 'disconnection' = abortController.signal.aborted
          ? 'disconnection' : 'error'
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

      await this.deps.conversationPersistence.completeConversation(
        conversationId, streamingEvents, undefined, persistenceContext
      ).catch(persistErr => {
        logger.error('sse.execution.error_persistence_failed', { appId, conversationId, ...errorFields(persistErr) })
      })

      // Same superseded-slot guard as the success path: our terminal
      // events would otherwise land in a newer turn's subscriber set.
      const supersededError = this.activeStreams.get(conversationId) !== streamState
      if (supersededError) {
        logger.info('sse.execution.superseded.skip_error_terminal', {
          appId, conversationId, aborted: abortController.signal.aborted,
        })
      } else if (abortController.signal.aborted) {
        logger.info('sse.execution.aborted', { appId, conversationId })
        await this.publishTerminal(appId, conversationId, {
          type: 'complete', content: '', data: { finishReason: 'aborted', ...getCurrentTraceIds() },
          conversationId, agentName: resolvedAgentId,
        })
      } else {
        const err = error instanceof Error ? error : new Error(String(error))
        const classified = classifyTurnError(err)
        // Prefer classified.clientMessage for errors that sanitize internal
        // detail (BMS API paths). Matches the WS wire contract.
        const clientMessage = classified.clientMessage ?? err.message
        logger.error('sse.execution.error', { appId, conversationId, ...errorFields(err) })
        await this.publishTerminal(appId, conversationId, {
          type: 'error', content: clientMessage,
          data: { error: clientMessage, timestamp: new Date().toISOString() },
          conversationId, agentName: 'system',
        })
        await this.publishTerminal(appId, conversationId, {
          type: 'complete', content: '', data: { finishReason: 'error', ...getCurrentTraceIds() },
          conversationId, agentName: 'system',
        })
        emitTurnError({
          conversationId,
          agentId: formatAgentId(resolvedAgentId),
          error: err,
          ...(classified.errorType !== undefined && { errorType: classified.errorType }),
          errorPhase: 'execution',
          isRetryable: classified.isRetryable,
          logger: { warn: (event, fields) => logger.warn(event, fields) },
        })
      }
    } finally {
      // Clean up grant session registration to prevent stale mappings
      if (useGrantRecovery) {
        grantSessionManager.removeSession(sseSocketId)
      }

      // If a racing execute() replaced the registry slot, it owns the
      // session seed data (lastUserMessage / lastAssessmentTaskType) —
      // touching any of it would corrupt the next turn.
      if (getClientActionService(sseSocketId) === clientActionService) {
        unregisterExternalActionService(sseSocketId)
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
      }
    }
  }
}
