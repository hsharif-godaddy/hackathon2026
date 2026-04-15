/**
 * Insights Authentication Utilities
 *
 * Handles authentication token fetching with timeout and error handling.
 */

import { TOKEN_FETCH_TIMEOUT_MS } from './constants'

/**
 * Get authentication token with timeout
 *
 * Attempts to get hostname from client-side (window.location) if available,
 * otherwise relies on server-side header detection in getInsightsAuthToken.
 *
 * @returns Authentication token
 * @throws Error if token fetch fails or times out
 */
export async function getAuthToken(): Promise<string> {
  const { getInsightsAuthToken } = await import('@/lib/insights-auth')
  
  // Try to get hostname from client-side if available
  let hostname: string | null = null
  if (typeof window !== 'undefined' && window.location) {
    hostname = window.location.hostname
  }
  
  const tokenPromise = getInsightsAuthToken(hostname)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Token fetch timeout after 30 seconds')), TOKEN_FETCH_TIMEOUT_MS)
  })
  
  const token = await Promise.race([tokenPromise, timeoutPromise])
  
  if (!token) {
    throw new Error('Token not found in response')
  }
  
  return token
}

