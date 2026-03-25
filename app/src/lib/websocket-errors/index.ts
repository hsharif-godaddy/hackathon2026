/**
 * WebSocket Error System
 *
 * Structured error handling for WebSocket operations with:
 * - Type-safe error codes
 * - Contextual debugging information
 * - User-friendly messages
 * - Retryability flags
 */

/**
 * WebSocket error codes representing different failure scenarios
 */
export enum WebSocketErrorCode {
  // Connection errors
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_LOST = 'CONNECTION_LOST',
  SOCKET_NOT_INITIALIZED = 'SOCKET_NOT_INITIALIZED',

  // Authentication errors
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_TIMEOUT = 'AUTH_TIMEOUT',
  TOKEN_REQUEST_FAILED = 'TOKEN_REQUEST_FAILED',
  TOKEN_REFRESH_LIMIT_EXCEEDED = 'TOKEN_REFRESH_LIMIT_EXCEEDED',
  TOKEN_MISSING = 'TOKEN_MISSING',

  // Message errors
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  MESSAGE_EMPTY = 'MESSAGE_EMPTY',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',

  // Visual context errors
  VISUAL_CONTEXT_CAPTURE_FAILED = 'VISUAL_CONTEXT_CAPTURE_FAILED',

  // State errors
  INVALID_STATE = 'INVALID_STATE',
  APP_ID_MISSING = 'APP_ID_MISSING',

  // Transport errors
  TRANSPORT_UPGRADE_FAILED = 'TRANSPORT_UPGRADE_FAILED',
  TRANSPORT_ERROR = 'TRANSPORT_ERROR',

  // Unknown
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Context information for debugging errors
 */
export interface WebSocketErrorContext {
  appId?: string | null
  socketId?: string
  socketState?: 'connected' | 'disconnected' | 'connecting'
  machineState?: string
  messageLength?: number
  attemptNumber?: number
  maxAttempts?: number
  timestamp?: number
  [key: string]: unknown
}

/**
 * Base WebSocket error class with structured information
 */
export class WebSocketError extends Error {
  public readonly code: WebSocketErrorCode
  public readonly context: WebSocketErrorContext
  public readonly userMessage: string
  public readonly retryable: boolean
  public readonly timestamp: number

  constructor(
    code: WebSocketErrorCode,
    options: {
      message?: string
      context?: WebSocketErrorContext
      userMessage?: string
      retryable?: boolean
      cause?: Error
    } = {}
  ) {
    const finalMessage = options.message || code
    super(finalMessage)

    this.name = 'WebSocketError'
    this.code = code
    const timestamp = Date.now()
    this.context = { ...options.context, timestamp }
    this.userMessage = options.userMessage || this.getDefaultUserMessage(code)
    this.retryable = options.retryable ?? this.isRetryableByDefault(code)
    this.timestamp = timestamp

    if (options.cause) {
      this.cause = options.cause
    }

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WebSocketError)
    }
  }

  /**
   * Get default user-friendly message for error code
   */
  private getDefaultUserMessage(code: WebSocketErrorCode): string {
    switch (code) {
      // Connection errors
      case WebSocketErrorCode.CONNECTION_FAILED:
        return 'Could not connect to the server. Please check your internet connection.'
      case WebSocketErrorCode.CONNECTION_TIMEOUT:
        return 'Connection timed out. Please try again.'
      case WebSocketErrorCode.CONNECTION_LOST:
        return 'Connection lost. Attempting to reconnect...'
      case WebSocketErrorCode.SOCKET_NOT_INITIALIZED:
        return 'Initializing connection. Please wait a moment.'

      // Authentication errors
      case WebSocketErrorCode.AUTH_FAILED:
        return 'Authentication failed. Please refresh the page.'
      case WebSocketErrorCode.AUTH_TIMEOUT:
        return 'Authentication timed out. Please try again.'
      case WebSocketErrorCode.TOKEN_REQUEST_FAILED:
        return 'Could not obtain authentication token. Please refresh the page.'
      case WebSocketErrorCode.TOKEN_REFRESH_LIMIT_EXCEEDED:
        return 'Too many authentication attempts. Please refresh the page.'
      case WebSocketErrorCode.TOKEN_MISSING:
        return 'Authentication token is missing. Please refresh the page.'

      // Message errors
      case WebSocketErrorCode.MESSAGE_SEND_FAILED:
        return 'Failed to send message. Please try again.'
      case WebSocketErrorCode.MESSAGE_EMPTY:
        return 'Cannot send an empty message.'
      case WebSocketErrorCode.MESSAGE_TOO_LARGE:
        return 'Message is too large. Please reduce the content or assets.'

      // Visual context errors
      case WebSocketErrorCode.VISUAL_CONTEXT_CAPTURE_FAILED:
        return 'Could not capture page preview. Your message will be sent without it.'

      // State errors
      case WebSocketErrorCode.INVALID_STATE:
        return 'Connection is in an invalid state. Please refresh the page.'
      case WebSocketErrorCode.APP_ID_MISSING:
        return 'App information is missing. Please refresh the page.'

      // Transport errors
      case WebSocketErrorCode.TRANSPORT_UPGRADE_FAILED:
        return 'Connection upgrade failed. Using fallback transport.'
      case WebSocketErrorCode.TRANSPORT_ERROR:
        return 'Network error occurred. Please check your connection.'

      default:
        return 'An unexpected error occurred. Please try again.'
    }
  }

  /**
   * Determine if error code is retryable by default
   */
  private isRetryableByDefault(code: WebSocketErrorCode): boolean {
    const retryableCodes = new Set([
      WebSocketErrorCode.CONNECTION_TIMEOUT,
      WebSocketErrorCode.CONNECTION_LOST,
      WebSocketErrorCode.MESSAGE_SEND_FAILED,
      WebSocketErrorCode.VISUAL_CONTEXT_CAPTURE_FAILED,
      WebSocketErrorCode.TRANSPORT_UPGRADE_FAILED,
      WebSocketErrorCode.TRANSPORT_ERROR,
    ])

    return retryableCodes.has(code)
  }

  /**
   * Convert error to loggable object
   */
  toLogObject(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    }
  }

  /**
   * Convert error to JSON (for API responses)
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.userMessage, // Use user message for API responses
      retryable: this.retryable,
      timestamp: this.timestamp,
    }
  }
}

/**
 * Create a WebSocketError from an unknown error
 */
export function toWebSocketError(
  error: unknown,
  code = WebSocketErrorCode.UNKNOWN_ERROR,
  context: WebSocketErrorContext = {}
): WebSocketError {
  if (error instanceof WebSocketError) {
    // Merge new context with existing context
    return new WebSocketError(error.code, {
      message: error.message,
      context: { ...error.context, ...context },
      userMessage: error.userMessage,
      retryable: error.retryable,
      cause: error.cause as Error | undefined,
    })
  }

  const cause = error instanceof Error ? error : undefined
  const message = error instanceof Error ? error.message : String(error)

  return new WebSocketError(code, {
    message,
    context,
    cause,
  })
}

/**
 * Check if an error is a WebSocketError with a specific code
 */
export function isWebSocketError(
  error: unknown,
  code?: WebSocketErrorCode
): error is WebSocketError {
  if (!(error instanceof WebSocketError)) {
    return false
  }

  if (code !== undefined) {
    return error.code === code
  }

  return true
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof WebSocketError) {
    return error.retryable
  }
  return false
}

/**
 * Extract user-friendly message from any error
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof WebSocketError) {
    return error.userMessage
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
