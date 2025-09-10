/**
 * Dynamic API Configuration Service
 *
 * Provides site-specific API configuration by fetching agent URLs from the sites database
 * Fallbacks to static configuration when no site context is available
 */

import { apiConfig as staticApiConfig } from './api'

export interface DynamicApiConfig {
  baseUrl: string
  wsUrl: string
  agentUrl: string
  isStatic: boolean
  siteId?: string
}

export class DynamicApiConfigService {
  private configCache: Map<string, { config: DynamicApiConfig; lastFetched: number }> = new Map()
  private readonly CACHE_TTL = 30000 // 30 seconds cache

  constructor() {
    // No longer needs direct database access - uses API routes instead
  }

  /**
   * Get API configuration for a specific site
   * Falls back to static configuration if site not found or agent_url not available
   */
  async getConfigForSite(siteId: string): Promise<DynamicApiConfig> {
    // Check cache first
    const cached = this.configCache.get(siteId)
    if (cached && Date.now() - cached.lastFetched < this.CACHE_TTL) {
      return cached.config
    }

    try {
      // Use API route to fetch site configuration
      // Handle both client-side and server-side calls
      const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000'
      const response = await fetch(`${baseUrl}/api/sites/${siteId}`)

      if (response.ok) {
        const site = await response.json()

        if (site?.agent_url && site.status === 'running') {
          // Site has agent URL and is running, use dynamic configuration
          // WebSocket needs base URL without the /apps/{id} suffix
          const baseAgentUrl = site.agent_url.replace(`/apps/${siteId}`, '')
          const config: DynamicApiConfig = {
            baseUrl: site.agent_url,
            wsUrl: this.transformToWebSocketUrl(baseAgentUrl),
            agentUrl: site.agent_url,
            isStatic: false,
            siteId
          }

          // Cache the result
          this.configCache.set(siteId, {
            config,
            lastFetched: Date.now()
          })

          console.log('🌐 Using dynamic API config for site:', {
            siteId,
            agentUrl: site.agent_url,
            wsUrl: config.wsUrl
          })

          return config
        } else {
          // Site exists but agent URL is not ready yet
          const status = site?.status || 'unknown'
          const hasAgentUrl = !!site?.agent_url

          console.log(`⏳ Site ${siteId} not ready:`, {
            status,
            hasAgentUrl,
            agentUrl: site?.agent_url
          })

          throw new Error(`Site ${siteId} agent is not ready yet. Status: ${status}, Has agent URL: ${hasAgentUrl}. Please wait for deployment to complete.`)
        }
      } else {
        throw new Error(`Failed to fetch site ${siteId}: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch dynamic config for site:', siteId, error)
      throw error
    }
  }

  /**
   * Get static configuration (deprecated - no longer supported)
   */
  getStaticConfig(): DynamicApiConfig {
    throw new Error('Static configuration is no longer supported. All URLs must be dynamic based on site data.')
  }

  /**
   * Transform HTTPS URL to WebSocket URL
   * https://example.com -> wss://example.com
   * http://example.com -> ws://example.com
   */
  private transformToWebSocketUrl(url: string): string {
    if (url.startsWith('https://')) {
      return url.replace('https://', 'wss://')
    }
    if (url.startsWith('http://')) {
      return url.replace('http://', 'ws://')
    }
    return url
  }

  /**
   * Poll for agent URL updates for a specific site
   * Returns a promise that resolves when agent URL becomes available
   */
  async waitForAgentUrl(siteId: string, maxAttempts = 60, interval = 5000): Promise<DynamicApiConfig | null> {
    let attempts = 0

    return new Promise((resolve) => {
      const poll = async () => {
        attempts++

        try {
          // Use API route to check site status
          // Handle both client-side and server-side calls
          const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000'
          const response = await fetch(`${baseUrl}/api/sites/${siteId}`)

          if (response.ok) {
            const site = await response.json()

            if (site?.agent_url && site.status === 'running') {
              const config = await this.getConfigForSite(siteId)
              console.log('✅ Agent URL became available for site:', siteId)
              resolve(config)
              return
            }

            if (site?.status === 'failed') {
              console.log('❌ Site deployment failed, stopping poll:', siteId)
              resolve(null)
              return
            }
          }

          if (attempts >= maxAttempts) {
            console.log('⏰ Polling timeout for agent URL:', siteId)
            resolve(null)
            return
          }

          console.log(`🔄 Waiting for agent URL (${attempts}/${maxAttempts}):`, siteId)
          setTimeout(poll, interval)

        } catch (error) {
          console.error('❌ Error polling for agent URL:', error)
          if (attempts >= maxAttempts) {
            resolve(null)
          } else {
            setTimeout(poll, interval)
          }
        }
      }

      poll()
    })
  }

  /**
   * Clear cache for a specific site
   */
  clearCache(siteId: string): void {
    this.configCache.delete(siteId)
  }

  /**
   * Clear all cached configurations
   */
  clearAllCache(): void {
    this.configCache.clear()
  }

  /**
   * Check if site has agent URL available (synchronous check using cache only)
   */
  isSiteReady(siteId: string): boolean {
    try {
      const cached = this.configCache.get(siteId)
      if (cached) {
        return !cached.config.isStatic
      }
      return false
    } catch {
      return false
    }
  }
}

// Export singleton instance
export const dynamicApiConfigService = new DynamicApiConfigService()

/**
 * Helper function to build API URLs with site context
 */
export async function buildDynamicApiUrl(endpoint: string, siteId: string): Promise<string> {
  const config = await dynamicApiConfigService.getConfigForSite(siteId)

  const cleanEndpoint = endpoint.replace(/^\//, '')

  // Agent service endpoints need /apps/{siteId}/ prefix
  if (cleanEndpoint) {
    return `${config.baseUrl}/apps/${siteId}/${cleanEndpoint}`
  } else {
    // Empty endpoint means we want the app details endpoint
    return `${config.baseUrl}/apps/${siteId}`
  }
}

/**
 * Helper function to build WebSocket URLs with site context
 */
export async function buildDynamicWsUrl(endpoint: string, siteId: string): Promise<string> {
  const config = await dynamicApiConfigService.getConfigForSite(siteId)

  const cleanEndpoint = endpoint.replace(/^\//, '')
  return `${config.wsUrl}/${cleanEndpoint}`
}

/**
 * Helper function to build agent URLs with site context
 */
export async function buildDynamicAgentUrl(endpoint: string, siteId: string): Promise<string> {
  const config = await dynamicApiConfigService.getConfigForSite(siteId)

  const cleanEndpoint = endpoint.replace(/^\//, '')
  return `${config.agentUrl}/${cleanEndpoint}`
}
