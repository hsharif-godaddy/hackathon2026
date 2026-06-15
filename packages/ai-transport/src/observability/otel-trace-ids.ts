import { trace } from '@opentelemetry/api'

export interface TraceIds {
  traceId: string
  observationId: string
}

/**
 * Read the active OTel span's IDs for correlating client-side feedback events
 * to Langfuse traces/observations. Returns `undefined` only when no span is
 * active on the current context.
 *
 * Span ID is surfaced as `observationId` to match Langfuse's data model:
 * Langfuse treats each OTel span as an "observation" within a trace.
 */
export function getCurrentTraceIds(): TraceIds | undefined {
  const span = trace.getActiveSpan()
  if (!span) return undefined
  const ctx = span.spanContext()
  return { traceId: ctx.traceId, observationId: ctx.spanId }
}
