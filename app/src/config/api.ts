/**
 * API Configuration
 * 
 * Centralizes API endpoint configuration with environment variable support
 * Now supports dynamic site-based URLs
 */

import { buildDynamicApiUrl, buildDynamicWsUrl } from './dynamic-api'
import { logger } from '@/lib/request-context'

export interface ApiConfig {
  baseUrl: string
  wsUrl: string
  agentUrl: string
}

/**
 * Get empty API configuration - all URLs are now dynamic based on site data
 */
function getApiConfig(): ApiConfig {
  // No static configuration - all URLs are dynamic based on site data
  return {
    baseUrl: '',
    wsUrl: '',
    agentUrl: ''
  }
}

// Export singleton configuration (empty - dynamic URLs only)
export const apiConfig = getApiConfig()

/**
 * DEPRECATED: Static API URL builder - no longer supported
 * Use buildDynamicApiUrl() with a siteId instead
 */
export function buildApiUrl(endpoint: string): string {
  throw new Error(`Static API URLs are no longer supported. Use buildDynamicApiUrl('${endpoint}', siteId) instead.`)
}

/**
 * DEPRECATED: Static WebSocket URL builder - no longer supported  
 * Use buildDynamicWsUrl() with a siteId instead
 */
export function buildWsUrl(endpoint: string): string {
  throw new Error(`Static WebSocket URLs are no longer supported. Use buildDynamicWsUrl('${endpoint}', siteId) instead.`)
}

/**
 * DEPRECATED: Static agent URL builder - no longer supported
 * Use buildDynamicApiUrl() with a siteId instead
 */
export function buildAgentUrl(endpoint: string): string {
  throw new Error(`Static agent URLs are no longer supported. Use buildDynamicApiUrl('${endpoint}', siteId) instead.`)
}

/**
 * Build API URLs using dynamic site-based configuration
 * siteId is required - there is no static fallback
 */
export async function buildApiUrlWithSite(endpoint: string, siteId: string): Promise<string> {
  // Always use dynamic URL based on site
  return await buildDynamicApiUrl(endpoint, siteId)
}

/**
 * Build WebSocket URLs using dynamic site-based configuration
 * siteId is required - there is no static fallback
 */
export async function buildWsUrlWithSite(endpoint: string, siteId: string): Promise<string> {
  // Always use dynamic WebSocket URL based on site
  return await buildDynamicWsUrl(endpoint, siteId)
}

// Log configuration in development
if (process.env.NODE_ENV === 'development') {
  logger.info('api.config.dynamic-mode', { message: 'Using Dynamic URLs Only - No static configuration' })
  logger.info('api.config.agent-urls', { message: 'All API calls use site-specific agent URLs from database' })
  logger.info('api.config.env-vars-deprecated', { message: 'Static environment variables (NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_API_WS_URL) are no longer used' })
}