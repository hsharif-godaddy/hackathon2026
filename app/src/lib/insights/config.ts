/**
 * Insights API Configuration
 *
 * Centralized configuration for insights GraphQL API client.
 */

/**
 * Get insights API URL based on environment
 *
 * Checks hostname for test/dev prefixes or localhost when in browser, otherwise uses NODE_ENV.
 * localhost is always treated as test environment.
 *
 * @returns Insights GraphQL API URL
 */
export function getInsightsApiUrl(): string {
  // Check hostname in browser environment
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname
    // localhost is always test environment
    const isLocalhost = hostname === 'localhost' || 
                       hostname === '127.0.0.1' || 
                       hostname.startsWith('localhost:') ||
                       hostname.startsWith('127.0.0.1:')
    const isTestOrDev = isLocalhost || hostname.includes('test-') || hostname.includes('dev-')
    return isTestOrDev
      ? 'https://uip.api.int.test-godaddy.com/v1/insights/graphql'
      : 'https://uip.api.int.godaddy.com/v1/insights/graphql'
  }

  // Server-side: check NODE_ENV (default to test for local development)
  const isProduction = process.env.NODE_ENV === 'production'
  return isProduction
    ? 'https://uip.api.int.godaddy.com/v1/insights/graphql'
    : 'https://uip.api.int.test-godaddy.com/v1/insights/graphql'
}

export const INSIGHTS_API_URL = getInsightsApiUrl()

export const REQUEST_TIMEOUT_MS = 30000
export const MAX_RETRIES = 3
export const INITIAL_RETRY_DELAY_MS = 1000
export const MAX_RETRY_DELAY_MS = 10000
export const TOKEN_FETCH_TIMEOUT_MS = 30000

