/**
 * Produce { error, stack? } fields for a logger payload. Stack is included
 * when present so production log lines from catch blocks contain enough to
 * do root-cause analysis without a subsequent reproduction run.
 *
 * Flat keys (error / stack) match the existing convention in catch blocks
 * across the agents service; prefer this helper over the richer nested
 * `errorToLogError` when adding a log line to a catch block so all SSE
 * subsystem logs stay uniform.
 */
export function errorFields(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack ? { error: err.message, stack: err.stack } : { error: err.message }
  }
  return { error: String(err) }
}
