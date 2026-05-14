export function formatSSEEvent(type: string, data: Record<string, unknown>, id?: number): string {
  const idLine = id !== undefined ? `id: ${id}\n` : ''
  return `${idLine}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

export interface SSEFormatLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

/**
 * Format an SSE event, catching all throws reaching it and returning null
 * on failure. Every call site that would otherwise reach formatSSEEvent
 * directly should go through this helper instead: a throw reaching a
 * writer call site would either (a) propagate through a blocking
 * subscriber's fail-fast path and flip a healthy turn into a spurious
 * error+complete, or (b) escape to asyncHandler after SSE headers were
 * already sent, stranding the client.
 *
 * The catch is deliberately broad (not scoped to JSON.stringify) — its
 * purpose is "anything that would strand the client becomes a logged
 * no-op." If you add a validation step to formatSSEEvent that throws
 * on invalid input, that throw will also be swallowed here; add the
 * validation before invoking formatSSEEvent if you need the failure to
 * propagate.
 *
 * Today's known trigger cases: BigInt values (TypeError) and circular
 * references (TypeError) in the data payload.
 */
export function safeFormatSSEEvent(
  type: string,
  data: Record<string, unknown>,
  id?: number,
  logger?: SSEFormatLogger,
  context?: Record<string, unknown>,
): string | null {
  try {
    return formatSSEEvent(type, data, id)
  } catch (err) {
    logger?.warn('sse.format_failed', {
      ...context,
      kind: type,
      sequence: id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Build a stream_error fallback frame for a single event whose payload could
 * not be serialized. Used by SSESubscriber when safeFormatSSEEvent returns
 * null on a normal event: without this, the client never sees the failure
 * and hangs waiting for stream_complete. The payload shape is fixed and
 * primitive-only so it cannot itself fail JSON.stringify.
 *
 * The fallback frame carries the original event's sequence so the client's
 * Last-Event-Id advances past the unformattable frame on reconnect.
 *
 * INVARIANT: every field below must be a primitive (string | number | boolean).
 * No object/array/BigInt fields, ever. This helper calls the unsafe
 * formatSSEEvent directly (not safeFormatSSEEvent) precisely because we rely
 * on the shape being total — wrapping it in safeFormatSSEEvent would convert a
 * future serialization throw into another null-on-the-wire and re-introduce
 * the bug this helper exists to fix.
 */
export function formatStreamErrorFallback(originalKind: string, sequence: number): string {
  return formatSSEEvent(
    'stream_error',
    {
      error: 'event_format_failed',
      kind: originalKind,
      sequence,
      timestamp: new Date().toISOString(),
    },
    sequence,
  )
}
