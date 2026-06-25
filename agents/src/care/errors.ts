import { AgentClientError, NetworkError, TimeoutError } from '@airo-care/client'

const GENERIC = 'Sorry, we lost connection to support. Try again in a moment.'
const TIMEOUT = 'Sorry, support took too long to respond. Try again in a moment.'
const NOT_FOUND = 'Your support conversation ended. Try again to start a new one.'

/** User-facing copy for an in-stream Care error event. Intentionally generic —
 * Care's raw diagnostic message may contain internal detail (IDs, stack fragments,
 * service names) that must not render in the customer chat. */
export const CARE_REPORTED_ERROR = 'Sorry, support hit a problem. Try again in a moment.'

/**
 * Map any thrown value to a single short English string safe to render
 * in the chat as an inline error chunk. Never throws; returns a generic
 * fallback when the input is not a recognized Care client error.
 */
export function userFacingErrorMessage(err: unknown): string {
  try {
    if (err instanceof TimeoutError) return TIMEOUT
    if (err instanceof NetworkError) return GENERIC
    if (err instanceof AgentClientError) {
      if (err.statusCode === 404) return NOT_FOUND
      return GENERIC
    }
    return GENERIC
  } catch {
    return GENERIC
  }
}
