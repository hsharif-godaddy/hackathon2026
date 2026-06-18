/**
 * Insights API Error Handling
 *
 * Provides error classification and retry logic for GraphQL queries.
 */

import type { ErrorClassification } from './types'

/**
 * Classify error to determine if it's retryable
 *
 * @param error - Error to classify
 * @returns Error classification with retry decision
 */
export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      retryable: true,
      category: 'network',
      message: 'Network error: Unable to reach the analytics service'
    }
  }

  if (error instanceof Error) {
    if ((error as Error & { isGraphQLError?: boolean }).isGraphQLError) {
      return {
        retryable: false,
        category: 'client_error',
        message: error.message || 'GraphQL query error. Please check your query and parameters'
      }
    }

    const message = error.message.toLowerCase()
    const name = error.name.toLowerCase()

    if (message.includes('graphql errors:')) {
      return {
        retryable: false,
        category: 'client_error',
        message: error.message || 'GraphQL query error. Please check your query and parameters'
      }
    }

    if (message.includes('timeout') || message.includes('aborted') || name.includes('timeout')) {
      return {
        retryable: true,
        category: 'timeout',
        message: 'Request timed out. The analytics service may be slow to respond'
      }
    }

    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return {
        retryable: true,
        category: 'rate_limit',
        message: 'Rate limit exceeded. Please try again in a moment'
      }
    }

    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return {
        retryable: true,
        category: 'server_error',
        message: 'Server error: The analytics service is temporarily unavailable'
      }
    }

    if (message.includes('400') || message.includes('401') || message.includes('403') || message.includes('404')) {
      return {
        retryable: false,
        category: 'client_error',
        message: error.message || 'Invalid request. Please check your configuration'
      }
    }
  }

  return {
    retryable: true,
    category: 'unknown',
    message: error instanceof Error ? error.message : 'An unexpected error occurred'
  }
}


/**
 * Calculate exponential backoff delay with jitter
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param initialDelay - Initial delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number
): number {
  const baseDelay = initialDelay * Math.pow(2, attempt - 1)
  const jitter = Math.random() * 0.3 * baseDelay
  return Math.min(baseDelay + jitter, maxDelay)
}

