/**
 * Insights Client Constants
 *
 * Request timeout and retry configuration used by both server and client code.
 * Separated from config.ts to avoid pulling gasket.ts into client bundles.
 */

export const REQUEST_TIMEOUT_MS = 30000
export const MAX_RETRIES = 3
export const INITIAL_RETRY_DELAY_MS = 1000
export const MAX_RETRY_DELAY_MS = 10000
export const TOKEN_FETCH_TIMEOUT_MS = 30000
