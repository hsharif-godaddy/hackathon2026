/**
 * Supplementary root-cause fields for an error or promise-rejection value: the
 * error `name` and `stack`, the system `code`, and any nested `cause` (plus the
 * cause's own `code` and `stack`, where network/socket failures hide their real
 * origin).
 *
 * Returns an empty object for non-Error values — the caller logs the primary
 * `error`/`reason` field itself. Shared by the agents service's crash handlers
 * (`uncaughtException`, `unhandledRejection`) and the `@airo/ai-lib`
 * response-promise backstop so every crash/abort log carries the same triage
 * detail.
 */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {};
  }
  // A pathological error with a throwing getter or `toString` must never take
  // down a crash/abort handler — drop the detail rather than rethrow. Not
  // reachable from real Node/undici errors, but cheap insurance where a throw
  // is most costly.
  try {
    const err: Error & { code?: unknown; cause?: unknown } = error;
    const cause: { code?: unknown; message?: unknown } | undefined =
      err.cause && typeof err.cause === 'object' ? (err.cause as { code?: unknown; message?: unknown }) : undefined;
    // Errors stringify to "Name: message"; a non-Error object would stringify to
    // a useless "[object Object]", so prefer its `message` when it exposes one.
    const causeText: string | undefined =
      err.cause === undefined
        ? undefined
        : err.cause instanceof Error || typeof cause?.message !== 'string'
          ? String(err.cause)
          : cause.message;
    // When the cause is itself an Error, its stack can hold the real origin that
    // the top-level stack (often pure framework internals on a wrapped error) lacks.
    const causeStack: string | undefined = err.cause instanceof Error ? err.cause.stack : undefined;
    return {
      name: err.name,
      stack: err.stack,
      ...(err.code !== undefined && { code: String(err.code) }),
      ...(causeText !== undefined && { cause: causeText }),
      ...(cause?.code !== undefined && { causeCode: String(cause.code) }),
      ...(causeStack !== undefined && { causeStack }),
    };
  } catch {
    return {};
  }
}
