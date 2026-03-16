import { vi } from 'vitest'
import { APICallError } from '@ai-sdk/provider'

/**
 * Test Helper Utilities for Retry and Agent Testing
 */

/**
 * Creates a network error (e.g., ECONNREFUSED, ETIMEDOUT)
 */
export function createNetworkError(code: string = 'ECONNREFUSED', message?: string): Error {
  const error: any = new Error(message || `Network error: ${code}`)
  error.code = code
  error.errno = code
  return error
}

/**
 * Creates a rate limit error (429)
 */
export function createRateLimitError(message: string = 'Rate limit exceeded'): Error {
  const error: any = new Error(message)
  error.status = 429
  error.statusCode = 429
  return error
}

/**
 * Creates a server error (5xx)
 */
export function createServerError(statusCode: number = 500, message?: string): Error {
  const error: any = new Error(message || `Server error: ${statusCode}`)
  error.status = statusCode
  error.statusCode = statusCode
  return error
}

/**
 * Creates an auth error (401 or 403) - should NOT be retried
 */
export function createAuthError(statusCode: 401 | 403 = 401, message?: string): Error {
  const error: any = new Error(message || `Authentication failed: ${statusCode}`)
  error.status = statusCode
  error.statusCode = statusCode
  return error
}

/**
 * Creates a bad request error (400) - should NOT be retried by default
 */
export function createBadRequestError(message: string = 'Bad request'): Error {
  const error: any = new Error(message)
  error.status = 400
  error.statusCode = 400
  return error
}

/**
 * Creates a transient bad request error (400) - generic "Bad Request" that may be retried
 * These occur when LLM APIs return 400 during streaming due to client disconnection
 */
export function createTransientBadRequestError(message: string = 'Bad Request'): Error {
  const error: any = new Error(message)
  error.status = 400
  error.statusCode = 400
  return error
}

/**
 * Creates a tool validation bad request error (400) - should NOT be retried
 * These are specific validation errors from AI SDK
 */
export function createToolValidationError(message: string = 'toolUse.input is invalid JSON'): Error {
  const error: any = new Error(message)
  error.status = 400
  error.statusCode = 400
  return error
}

/**
 * Creates a service unavailable error
 */
export function createServiceUnavailableError(message: string = 'Service temporarily unavailable'): Error {
  const error: any = new Error(message)
  error.status = 503
  error.statusCode = 503
  return error
}

/**
 * Creates a real APICallError with response headers for testing header-based retry logic.
 * Uses the AI SDK's APICallError class so `APICallError.isInstance()` returns true.
 */
export function createAPICallErrorWithHeaders(
  statusCode: number,
  responseHeaders: Record<string, string>,
  message: string = `API error: ${statusCode}`
): APICallError {
  return new APICallError({
    message,
    url: 'https://litellm.example.com/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseHeaders,
    responseBody: message,
    isRetryable: undefined as unknown as boolean,
  })
}

/**
 * Wait for a specific delay with tolerance
 * Useful for testing timing of retries
 */
export async function waitForDelay(expectedMs: number, toleranceMs: number = 100): Promise<void> {
  const start = Date.now()
  await new Promise(resolve => setTimeout(resolve, expectedMs - toleranceMs))
  const elapsed = Date.now() - start

  // Verify we waited at least the minimum time
  if (elapsed < expectedMs - toleranceMs) {
    throw new Error(`Wait time ${elapsed}ms is less than expected ${expectedMs - toleranceMs}ms`)
  }
}

/**
 * Measure execution time of a function
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T, durationMs: number }> {
  const start = Date.now()
  const result = await fn()
  const durationMs = Date.now() - start
  return { result, durationMs }
}

/**
 * Create a mock function that fails N times then succeeds
 */
export function createFailingFunction<T>(
  failCount: number,
  errorFactory: () => Error,
  successValue: T
): () => Promise<T> {
  let attempts = 0

  return async () => {
    attempts++
    if (attempts <= failCount) {
      throw errorFactory()
    }
    return successValue
  }
}

/**
 * Create mock conversation messages for testing
 */
export function createMockConversationMessages() {
  return [
    { role: 'user' as const, content: 'Write a Haiku' },
    { role: 'assistant' as const, content: "Here's a haiku:\nCode flows like water\nBugs dance in the moonlight\nRefactor brings peace" },
    { role: 'user' as const, content: 'Tell me a joke' }
  ]
}

/**
 * Create mock context messages for testing
 */
export function createMockContextMessages() {
  return [
    {
      role: 'system' as const,
      content: 'You are a helpful assistant in an app development environment.',
      cachePoint: { type: 'ephemeral' as const }
    }
  ]
}

/**
 * Create mock files for vision testing
 */
export function createMockFiles() {
  return [
    {
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      base64Content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      metadata: {
        mimeType: 'image/png' as const,
        filename: 'test-image.png',
        size: 100
      }
    }
  ]
}

/**
 * Spy on console methods and collect log calls
 */
export function createConsoleSpy() {
  const logs: string[] = []
  const warns: string[] = []
  const errors: string[] = []

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  })

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    warns.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  })

  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  })

  return {
    logs,
    warns,
    errors,
    restore: () => {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    },
    contains: (level: 'log' | 'warn' | 'error', text: string) => {
      const arr = level === 'log' ? logs : level === 'warn' ? warns : errors
      return arr.some(msg => msg.includes(text))
    }
  }
}
