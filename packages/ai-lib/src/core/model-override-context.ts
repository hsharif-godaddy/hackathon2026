import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<string>()

/**
 * Run a function with a model override active for all nested calls.
 * Any call to getActiveModelOverride() within fn (including in tools,
 * summarizer, or other async work) will return the override value.
 */
export function runWithModelOverride<T>(override: string, fn: () => T): T {
  return storage.run(override, fn)
}

/**
 * Get the currently active model override, if any.
 * Returns null when called outside of a runWithModelOverride() context.
 */
export function getActiveModelOverride(): string | null {
  return storage.getStore() ?? null
}
