/**
 * Dynamic API Configuration Service
 *
 * Provides site-specific API configuration by fetching agent URLs from the sites database
 * Fallbacks to static configuration when no site context is available
 */
import { logger } from '@/lib/request-context'
import { AppErrorCode } from '@/types/error-codes'

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
      // Use centralized site store to prevent duplicate requests
      const { useSiteStore } = await import('@/stores/useSiteStore')
      const siteStore = useSiteStore.getState()
      const site = await siteStore.fetchSite(siteId)

      if (site) {
        // Accept 'running' or 'creating' status (V2 apps have agent URLs even while creating)
        if (site?.agent_url && (site.status === 'running' || site.status === 'creating')) {
          // Site has agent URL, use dynamic configuration
          // WebSocket/Socket.IO connects to base agent URL
          const config: DynamicApiConfig = {
            baseUrl: site.agent_url,
            wsUrl: this.transformToWebSocketUrl(site.agent_url),
            agentUrl: site.agent_url,
            isStatic: false,
            siteId
          }

          // Cache the result
          this.configCache.set(siteId, {
            config,
            lastFetched: Date.now()
          })

          return config
        } else {
          // Site exists but agent URL is not ready yet
          const status = site?.status || 'unknown'
          const hasAgentUrl = !!site?.agent_url

          logger.info('dynamic-api.site.not-ready', {
            message: `Site ${siteId} not ready`,
            siteId,
            status,
            hasAgentUrl,
            agentUrl: site?.agent_url
          })

          throw new Error(`Site ${siteId} agent is not ready yet. Status: ${status}, Has agent URL: ${hasAgentUrl}. Please wait for deployment to complete.`)
        }
      } else {
        throw new Error(AppErrorCode.SITE_NOT_FOUND)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Don't log SITE_NOT_FOUND as a warning - it's expected for invalid URLs
      if (errorMessage !== AppErrorCode.SITE_NOT_FOUND) {
        logger.warn('dynamic-api.config.fetch-failure', { message: 'Failed to fetch dynamic config for site', siteId, error: errorMessage })
      }

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
          // Use centralized site store to prevent duplicate requests
          const { useSiteStore } = await import('@/stores/useSiteStore')
          const siteStore = useSiteStore.getState()
          const site = await siteStore.fetchSite(siteId)

          if (site) {

            if (site?.agent_url && site.status === 'running') {
              const config = await this.getConfigForSite(siteId)
              logger.info('dynamic-api.agent-url.available', { message: 'Agent URL became available for site', siteId })
              resolve(config)
              return
            }

            if (site?.status === 'failed') {
              logger.warn('dynamic-api.polling.failure', { message: 'Site deployment failed, stopping poll', siteId })
              resolve(null)
              return
            }
          }

          if (attempts >= maxAttempts) {
            logger.warn('dynamic-api.polling.timeout', { message: 'Polling timeout for agent URL', siteId })
            resolve(null)
            return
          }

          logger.debug('dynamic-api.polling.waiting', { message: 'Waiting for agent URL', attempts, maxAttempts, siteId })
          setTimeout(poll, interval)

        } catch (error) {
          logger.error('dynamic-api.polling.error', { message: 'Error polling for agent URL', error: error instanceof Error ? error.message : String(error) })
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
