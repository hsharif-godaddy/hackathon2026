/**
 * Handler for Node's `unhandledRejection` event. Extracted from `app.ts` so
 * it can be unit-tested in isolation without loading the full server graph
 * (instrumentation, APM, Express wiring).
 *
 * Behavior: treat `AbortError` / `ABORT_ERR` as non-fatal (user-initiated
 * cancellation leaking through a lazy SDK promise is not an invariant
 * violation). Everything else triggers `shutdown()` as before.
 */
export interface UnhandledRejectionDeps {
  logger: { warn: (event: string, meta?: unknown) => void; error: (event: string, meta?: unknown) => void };
  shutdown: (cause: string) => void;
}

export function handleUnhandledRejection(
  reason: unknown,
  promise: unknown,
  deps: UnhandledRejectionDeps
): void {
  const err = reason as { name?: string; code?: string } | null | undefined;
  const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
  if (isAbort) {
    deps.logger.warn('server.unhandled.rejection.abort', {
      reason: String(reason),
      promise: String(promise),
    });
    return;
  }
  deps.logger.error('server.unhandled.rejection', {
    reason: String(reason),
    promise: String(promise),
  });
  deps.shutdown('unhandledRejection');
}
