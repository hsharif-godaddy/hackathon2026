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
