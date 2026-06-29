import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'

// Elastic's OTLP intake derives transaction.type from attribute namespaces
// (messaging.* → "messaging", http.* → "request", db.* → "db", else "unknown").
// Without one of those, a root SERVER span surfaces under the noisy "unknown"
// type that the APM Applications view hides. Every span runRootSpan creates is
// background/lifecycle work (startup pre-warm, fire-and-forget publish chains),
// not an HTTP request — messaging is the closest documented class. Setting it
// here makes "nothing under unknown" an invariant of the helper rather than
// per-callsite discipline.
const BACKGROUND_TRANSACTION_ATTRS = {
  'messaging.system': 'airo-agents',
  'messaging.operation': 'process',
} as const

/**
 * Run an async function inside a named root SERVER span — Elastic's OTLP
 * mapping promotes SERVER-kind spans to transactions, so each call shows up
 * in the APM Applications view as a top-level transaction with `name` as
 * the label. Use for boot-time pre-warm work and any fire-and-forget
 * background chain that runs without an inbound request context.
 *
 * Errors are recorded on the span (and the span set to ERROR status) before
 * being rethrown — caller decides whether to await or not.
 *
 * Span names must be low-cardinality static strings — put per-call detail
 * (appId, jobId, etc.) on attributes via the inner function instead.
 */
export function runRootSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer('airo-agents').startActiveSpan(
    name,
    // Intentionally NOT root: true — Elastic surfaces SpanKind.SERVER as a
    // transaction regardless of parent, so the messaging.* attributes do the
    // classification work alone. Leaving the span linked to whatever was in
    // context (the auto-instrumented HTTP server span for fire-and-forget post-
    // response work; nothing at boot) preserves distributed trace continuity if
    // a future caller propagates traceparent into us.
    { kind: SpanKind.SERVER, attributes: BACKGROUND_TRANSACTION_ATTRS },
    async (span): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)))
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

/**
 * Fire-and-forget variant: spawns runRootSpan, swallows the rejection so it
 * doesn't surface as an unhandled rejection, and routes any error to the
 * optional onError callback (typically used to update job state or log).
 */
export function runRootSpanBackground(
  name: string,
  fn: () => Promise<void>,
  onError?: (err: unknown) => void,
): void {
  runRootSpan(name, fn).catch((err: unknown): void => {
    if (onError) onError(err)
  })
}
