import { context as otelContext, trace, type Context } from '@opentelemetry/api'
import {
  createAgentContext,
  createAgentInvocationSpan,
  emitError,
} from '@godaddy/agent-otel-sdk'
import { createError, type ErrorPhase } from '@godaddy/agent-observability-events'
import { inferProviderFromModelName } from './infer-llm-provider.js'
import { registerInvocationSpan, unregisterInvocationSpan } from './agent-invocation-context.js'
import {
  captureResponseMetadata,
  awaitResponseMetadata,
  type ResponseMetadata,
} from '../response-metadata-capture.js'

/** Minimal logger contract used by emitTurnError's fallback path. Named
 * after the sole consumer to avoid confusion with
 * `createAgentTelemetryLogger` (agents/src/utils/agent-logger.ts).
 *
 * `warn` MUST NOT throw. emitTurnError upholds its own "Never throws"
 * contract by wrapping this call in try/catch and falling back to
 * console.error, but implementors should still treat .warn as
 * non-throwing — a throwing logger defeats structured observability. */
export interface TurnErrorLogger {
  warn: (event: string, data: Record<string, unknown>) => void
}

export interface EmitTurnErrorOptions {
  conversationId: string
  /** Active specialist routing key (e.g. develop, initial-v3). Omit when unknown. */
  specialistKey?: string | undefined
  error: unknown
  /** Caller-provided classification (e.g. 'RETRY_ERROR', 'BUDGET_SERVICE_ERROR',
   * 'AgentNotFoundError'). Defaults to `error.name` for Error instances (the
   * stable, override-able property subclasses set — resilient to minifier
   * renaming, unlike `error.constructor.name`). */
  errorType?: string
  errorPhase?: ErrorPhase
  /** Whether a client retry has a chance of succeeding. Defaults to false;
   * WS sets true for 5xx/429 and retryable budget errors. */
  isRetryable?: boolean
  logger: TurnErrorLogger
}

/** Emit a Langfuse turn-error event. Never throws — telemetry failures are
 * logged via the provided logger and swallowed.
 *
 * Call site: the outer turn-error handler in each transport. WS wires this
 * up in Stage 1 (the initial PR); SSE follows in Stage 3 of the parity
 * series. Error classification is transport-specific (WS: HTTP status +
 * budget-service categorization; SSE: generic). */
export function emitTurnError(opts: EmitTurnErrorOptions): void {
  const { conversationId, specialistKey, error, errorType, errorPhase, isRetryable, logger } = opts
  try {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const resolvedErrorType = errorType ?? (error instanceof Error ? error.name : 'Error')
    emitError({
      conversationId,
      specialistKey,
      eventData: createError({
        errorType: resolvedErrorType,
        errorMessage,
        errorPhase: errorPhase ?? 'execution',
        isRetryable: isRetryable ?? false,
        ...(error instanceof Error && error.stack && { errorStack: error.stack }),
      }),
    })
  } catch (telemetryErr) {
    // The JSDoc above promises `Never throws` — callers rely on this inside
    // outer turn-error handlers where a secondary throw would replace the
    // original error and potentially leave the turn response undelivered.
    // Guard the logger call as well: a mis-wired stub, a future logger that
    // validates fields, or a transport with a dead backing channel could all
    // throw from .warn. Fall back to console.error so we never swallow the
    // diagnostic entirely, and catch that too for the truly-hopeless case
    // (console reassigned to a throwing proxy in tests etc.).
    const telemetryError = telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr)
    try {
      logger.warn('turn.error.telemetry_emit_failed', {
        conversationId,
        specialistKey,
        telemetryError,
      })
    } catch {
      try { console.error('turn.error.telemetry_emit_failed', { conversationId, specialistKey, telemetryError }) } catch { /* last-resort — preserve Never-throws contract */ }
    }
  }
}

/** Narrow structural contract covering both @airo/ai-lib Agents (WS) and
 * the agent object returned by the agents service's factory (SSE). */
export interface AgentForInvocation {
  getConfig?: () => { modelName?: string } | undefined
}

export interface AgentInvocationOptions {
  agent: AgentForInvocation
  agentName: string
  prompt: string
  /** Optional — Langfuse correlates events by conversationId when present;
   * a handle can still be created without one (e.g. ad-hoc single-turn flows). */
  conversationId?: string
  logger: TurnErrorLogger
}

/** Token usage — widens the SDK's `{inputTokens?, outputTokens?}` to accept any
 * `LanguageModelUsage`-shaped object (AI SDK adds totalTokens, cached tokens,
 * etc.). The extras are ignored by the invocation-end event schema. */
export interface InvocationUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  [key: string]: unknown
}

export interface InvocationEndSuccess {
  outputText: string
  responseType: 'llm_reply' | 'tool_call'
  usage?: InvocationUsage | undefined
  finishReason?: string | undefined
  /** Structured tool-result payload (WS attaches pending tool calls here). */
  responseData?: unknown
  /** Aggregated invocation cost in currency units (e.g. USD). WS-only today. */
  totalCost?: number | undefined
}

export interface AgentInvocationHandle {
  /** OTel context carrying the invocation span. Callers MUST wrap
   * streamGenerate (and any downstream LLM/tool work they want linked to
   * this invocation in Langfuse) in `otelContext.with(handle.context, ...)`. */
  readonly context: Context
  /** Convenience: runs `fn` under `handle.context`. Prefer this over the
   * raw `context` property when wrapping a single async block. */
  runUnder<T>(fn: () => Promise<T>): Promise<T>
  /** Eagerly captures response headers / responseId / modelId from the
   * AI SDK response promise. Fire-and-forget — the ai-lib boundary
   * suppresses rejection. Call once, right after `agent.streamGenerate`
   * resolves. */
  captureMetadata(responsePromise: Promise<unknown> | PromiseLike<unknown> | undefined): void
  /** Force-await the metadata with a 500ms deadline. Used for terminal
   * telemetry when the eager capture hasn't resolved yet. */
  awaitMetadata(responsePromise: Promise<unknown> | PromiseLike<unknown> | undefined): Promise<ResponseMetadata>
  /** Current metadata snapshot — mutated by captureMetadata. Read-only to
   * callers; never reassign. */
  readonly metadata: ResponseMetadata
  /** End the span on the happy path. Sets success:true. Idempotent. */
  endSuccess(params: InvocationEndSuccess): void
  /** End the span when the client aborted. Sets success:false, finishReason:'aborted'. Idempotent. */
  endAborted(params: {
    outputText: string
    responseType: 'llm_reply' | 'tool_call'
    responseData?: unknown
  }): void
  /** End the span on error. Sets success:false; caller may supply a
   * finishReason ('budget_retry', 'budget_continuation') for WS retry
   * paths. Idempotent. */
  endError(error: unknown, opts?: { finishReason?: string }): void
  /** True after any end*() has been called. */
  readonly ended: boolean
}

function resolveModelName(agent: AgentForInvocation, agentName: string): string {
  try {
    const cfg = agent.getConfig?.()
    return cfg?.modelName || agentName
  } catch {
    return agentName
  }
}

export function createAgentInvocation(opts: AgentInvocationOptions): AgentInvocationHandle {
  const { agent, agentName, prompt, conversationId, logger } = opts
  const modelName = resolveModelName(agent, agentName)

  const agentCtx = createAgentContext({
    ...(conversationId !== undefined && { conversationId }),
    specialistKey: agentName,
  })
  const invocation = otelContext.with(agentCtx, () =>
    createAgentInvocationSpan({
      prompt,
      model: modelName,
      provider: inferProviderFromModelName(modelName),
    }),
  )

  // Register the AGENT span in the Map so skill-loader can retrieve it by conversationId.
  const agentSpan = trace.getSpan(invocation.context)
  if (agentSpan && conversationId) {
    registerInvocationSpan(conversationId, agentSpan)
  }

  const metadata: ResponseMetadata = {}
  let ended = false

  /** Guarded span.end. Both transports call the end* methods from outer
   * catch blocks; a throw from the OTEL SDK there would replace the
   * original error (or silently turn a happy path into a 500). */
  const safeEnd = (endArgs: Parameters<typeof invocation.end>[0]): void => {
    if (conversationId && agentSpan) {
      unregisterInvocationSpan(conversationId, agentSpan)
    }
    try {
      invocation.end(endArgs)
    } catch (err) {
      const telemetryError = err instanceof Error ? err.message : String(err)
      const data = {
        ...(conversationId !== undefined && { conversationId }),
        specialistKey: agentName,
        telemetryError,
      }
      try {
        logger.warn('agent.invocation.end_failed', data)
      } catch {
        try { console.error('agent.invocation.end_failed', data) } catch { /* last-resort */ }
      }
    }
  }

  return {
    get context() {
      return invocation.context
    },
    get metadata() {
      return metadata
    },
    get ended() {
      return ended
    },

    runUnder<T>(fn: () => Promise<T>): Promise<T> {
      return otelContext.with(invocation.context, fn)
    },

    captureMetadata(responsePromise) {
      captureResponseMetadata(responsePromise as any, (m) => {
        Object.assign(metadata, m)
      })
    },

    async awaitMetadata(responsePromise) {
      if (metadata.headers || metadata.responseId) return metadata
      const m = await awaitResponseMetadata(responsePromise as any)
      Object.assign(metadata, m)
      return metadata
    },

    endSuccess(params) {
      if (ended) return
      ended = true
      safeEnd({
        outputText: params.outputText,
        responseType: params.responseType,
        ...(params.usage !== undefined && { usage: params.usage }),
        ...(params.finishReason !== undefined && { finishReason: params.finishReason }),
        ...(params.responseData !== undefined && { responseData: params.responseData as any }),
        ...(params.totalCost !== undefined && { totalCost: params.totalCost }),
        success: true,
      })
    },

    endAborted(params) {
      if (ended) return
      ended = true
      safeEnd({
        outputText: params.outputText,
        responseType: params.responseType,
        ...(params.responseData !== undefined && { responseData: params.responseData as any }),
        success: false,
        finishReason: 'aborted',
      })
    },

    endError(error, endOpts) {
      if (ended) return
      ended = true
      safeEnd({
        error: error instanceof Error ? error : String(error),
        success: false,
        ...(endOpts?.finishReason !== undefined && { finishReason: endOpts.finishReason }),
      })
    },
  }
}
