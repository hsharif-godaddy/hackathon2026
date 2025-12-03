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

const MAX_ERROR_MESSAGE_LENGTH = 20000

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
    // Allow localhost origins for development flexibility
    const origin = event.origin
    return origin.startsWith('http://localhost:') || 
           origin.startsWith('https://localhost:') ||
           origin === 'http://127.0.0.1:3000' ||
           origin === 'https://127.0.0.1:3000' ||
           (origin.startsWith('https://airo-builder') && origin.endsWith('godaddy.com'))
  }
  
  // In production or when specific origin is set, only allow that exact origin
  return event.origin === allowedOrigin
}

/**
 * Safe wrapper for postMessage that uses proper origin targeting
 */
export function safePostMessage(targetWindow: Window, message: any) {
  const origin = getTargetOrigin()
  
  const safeMessage = { ...message }
  if (safeMessage.errorMessage && typeof safeMessage.errorMessage === 'string') {
    safeMessage.errorMessage = safeMessage.errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH)
  }
  
  targetWindow.postMessage(safeMessage, origin)
}