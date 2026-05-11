import { emitError } from '@godaddy/agent-otel-sdk'
import { createError, type ErrorPhase } from '@godaddy/agent-observability-events'

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

const AGENT_ID_PREFIX = 'airo-app-builder-'

/** Canonical agent ID used by all Langfuse/observability events in this
 * project. Both WS and SSE must produce the same string so invocations
 * from either transport group under the same agent in Langfuse. */
export function formatAgentId(agentName: string): string {
  return `${AGENT_ID_PREFIX}${agentName}`
}

export interface EmitTurnErrorOptions {
  conversationId: string
  agentId: string
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
  const { conversationId, agentId, error, errorType, errorPhase, isRetryable, logger } = opts
  try {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const resolvedErrorType = errorType ?? (error instanceof Error ? error.name : 'Error')
    emitError({
      conversationId,
      agentId,
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
        agentId,
        telemetryError,
      })
    } catch {
      try { console.error('turn.error.telemetry_emit_failed', { conversationId, agentId, telemetryError }) } catch { /* last-resort — preserve Never-throws contract */ }
    }
  }
}
