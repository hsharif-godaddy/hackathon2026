/**
 * Insights GraphQL Client
 *
 * Provides robust GraphQL query execution with retry logic, timeouts, and error handling.
 */

import { logger } from '@/lib/request-context'
import { INITIAL_RETRY_DELAY_MS, MAX_RETRIES, MAX_RETRY_DELAY_MS, REQUEST_TIMEOUT_MS } from './config'
import { calculateBackoffDelay, classifyError, sleep } from './error-handler'
import type { InsightCountResponse } from './types'

/**
 * Execute GraphQL query with timeout, retry, and error handling
 *
 * Uses Next.js API route proxy to avoid CORS issues. All requests are made
 * through /api/analytics/graphql which handles authentication server-side.
 *
 * @param query - GraphQL query string
 * @param operationName - Name of the operation for logging
 * @param authToken - Authentication token (unused, kept for compatibility)
 * @returns Promise resolving to GraphQL response
 * @throws Error if all retries are exhausted
 */
export async function executeGraphQLQuery(
  query: string,
  operationName: string
): Promise<InsightCountResponse> {
  let lastError: Error | null = null

  // Use Next.js API route proxy to avoid CORS issues
  const proxyUrl = '/api/analytics/graphql'

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query }),
        signal: abortController.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const result: InsightCountResponse = await response.json()

      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map(e => e.message).join('; ')
        const error = new Error(`GraphQL errors: ${errorMessages}`)
        ;(error as Error & { isGraphQLError?: boolean }).isGraphQLError = true
        throw error
      }

      if (attempt > 1) {
        logger.info('analytics.graphql.retry-success', {
          operationName,
          attempt,
          maxAttempts: MAX_RETRIES
        })
      }

      return result
    } catch (error) {
      clearTimeout(timeoutId)
      lastError = error instanceof Error ? error : new Error(String(error))

      const classification = classifyError(error)

      if (!classification.retryable || attempt === MAX_RETRIES) {
        if (attempt === MAX_RETRIES) {
          logger.error('analytics.graphql.retry-exhausted', {
            operationName,
            attempt: MAX_RETRIES,
            maxAttempts: MAX_RETRIES,
            errorMessage: classification.message
          })
        }
        throw new Error(classification.message)
      }

      const delay = calculateBackoffDelay(attempt, INITIAL_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS)
      logger.warn('analytics.graphql.retry', {
        operationName,
        attempt,
        maxAttempts: MAX_RETRIES,
        errorCategory: classification.category,
        errorMessage: lastError.message,
        delayMs: delay
      })

      await sleep(delay)
    }
  }

  throw lastError || new Error('Request failed after all retries')
}

