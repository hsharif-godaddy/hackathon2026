/**
 * Security utility for postMessage operations
 *
 * Gets the target origin for postMessage calls. Uses environment variable
 * VITE_PARENT_ORIGIN if set, otherwise falls back to '*' (not recommended for production).
 *
 * This function centralizes origin handling to make security auditing easier.
 */
export function getTargetOrigin(): string {
  // Use configured parent origin from environment if available
  const parentOrigin = import.meta.env.VITE_PARENT_ORIGIN

  if (parentOrigin) {
    return parentOrigin
  }

  // Fallback to wildcard (security risk - should only be used in development)
  console.warn('VITE_PARENT_ORIGIN not set, using wildcard origin for postMessage (security risk)')
  return '*'
}

/**
 * Validates if the message event origin is allowed
 *
 * @param event - MessageEvent to validate
 * @returns true if origin is allowed, false otherwise
 */
export function isOriginAllowed(event: MessageEvent): boolean {
  const allowedOrigin = import.meta.env.VITE_PARENT_ORIGIN

  if (!allowedOrigin || allowedOrigin === '*') {
    // If no specific origin is configured, we're in development mode
    // Allow localhost origins and GoDaddy domains for development flexibility
    const origin = event.origin

    // Pattern matches: airo-builder.godaddy.com, airo-builder.dev-godaddy.com, airo-builder.test-godaddy.com
    const airoBuilderPattern = /^https:\/\/airo-builder\.(dev-|test-)?godaddy\.com(:\d+)?$/

    return origin.startsWith('http://localhost:') ||
           origin.startsWith('https://localhost:') ||
           origin.startsWith('https://local.gasket.dev-godaddy.com:') ||
           origin === 'http://127.0.0.1:3000' ||
           origin === 'https://127.0.0.1:3000' ||
           airoBuilderPattern.test(origin)
  }

  // In production or when specific origin is set, only allow that exact origin
  // Normalize by removing trailing slash since event.origin never has one
  return event.origin === allowedOrigin.replace(/\/$/, '')
}

/**
 * Safe wrapper for postMessage that uses proper origin targeting.
 *
 * Swallows DataCloneError so dev-tools telemetry with non-cloneable payloads
 * (SVGAnimatedString, DOM nodes, functions, circular refs, etc.) never
 * escalates into a user-facing "Something went wrong" overlay via
 * window.onerror. Retries once with a JSON-sanitized copy as best-effort
 * delivery, otherwise drops the message and logs a console warning. Any other
 * error is rethrown so genuine issues still surface.
 */
export function safePostMessage(targetWindow: Window, message: any) {
  const origin = getTargetOrigin()
  // Callers are responsible for bounding their payload sizes (see
  // AiroErrorBoundary.buildErrorData). This wrapper does not mutate
  // user content; the previous `errorMessage` top-level truncation
  // guard was dead code — no caller used that shape.
  const safeMessage = { ...message }

  try {
    targetWindow.postMessage(safeMessage, origin)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'DataCloneError') {
      try {
        targetWindow.postMessage(JSON.parse(JSON.stringify(safeMessage)), origin)
        // Retry succeeded but the JSON round-trip silently drops
        // `undefined`, functions, Symbol keys, Maps, Sets, Dates (become
        // strings), and other non-JSON values. Log so lossy delivery is
        // diagnosable for the platform team.
        console.warn('[dev-tools] postMessage payload was JSON-sanitized (DataCloneError)', safeMessage?.type)
      } catch (retryErr) {
        // Distinguish failure modes so a cross-origin misconfiguration
        // (SecurityError — e.g. wrong VITE_PARENT_ORIGIN) doesn't hide
        // under a "non-cloneable payload" label.
        if (retryErr instanceof DOMException && retryErr.name === 'SecurityError') {
          console.warn('[dev-tools] postMessage blocked by SecurityError on retry (check VITE_PARENT_ORIGIN)', safeMessage?.type, retryErr)
        } else {
          console.warn('[dev-tools] dropped postMessage with non-cloneable payload', safeMessage?.type, retryErr)
        }
      }
      return
    }
    throw err
  }
}
