/**
 * Site Context Provider
 *
 * Manages the current site ID context throughout the application
 * This allows components to know which site's agent URL to use for API calls
 */

'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { type DynamicApiConfig,dynamicApiConfigService } from '@/config/dynamic-api'
import { useSubscriptionCache } from '@/hooks/useSubscriptionCache'
import { logger } from '@/lib/request-context'
import { sitePollingService } from '@/services/SitePollingService'

/**
 * Get JWT token from browser cookies for API authentication
 */
const getAuthTokenFromCookie = (): string | null => {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'auth_idp') {
      return decodeURIComponent(value);
    }
  }
  return null;
};

interface SiteContextValue {
  // Current site ID
  siteId: string | null

  // Current dynamic API configuration
  apiConfig: DynamicApiConfig | null

  // Whether the site is ready (has agent URL)
  isSiteReady: boolean

  // Set current site ID and trigger config update
  setSiteId: (siteId: string | null) => void

  // Manually refresh the API configuration for current site
  refreshConfig: () => Promise<void>

  // Wait for site to be ready with agent URL
  waitForSite: (timeoutMs?: number) => Promise<boolean>

  // Clear current site context
  clearSite: () => void
}

const SiteContext = createContext<SiteContextValue | undefined>(undefined)

interface SiteProviderProps {
  children: React.ReactNode
  initialSiteId?: string
}

export function SiteProvider({ children, initialSiteId }: SiteProviderProps) {
  const [siteId, setSiteIdState] = useState<string | null>(initialSiteId || null)
  const [apiConfig, setApiConfig] = useState<DynamicApiConfig | null>(null)
  const [isSiteReady, setIsSiteReady] = useState(false)

  // Track latest request to prevent race conditions when siteId changes rapidly
  const latestRequestIdRef = useRef(0)

  // Initialize subscription cache for performance optimization
  const jwt = getAuthTokenFromCookie()
  const cacheStatus = useSubscriptionCache(jwt)

  // Update API configuration when site ID changes
  const updateConfig = useCallback(async (newSiteId: string | null) => {
    // Generate unique request ID and track it as the latest
    const requestId = ++latestRequestIdRef.current

    if (newSiteId) {
      try {
        const config = await dynamicApiConfigService.getConfigForSite(newSiteId)

        // Only update state if this is still the latest request
        // This prevents stale responses from overwriting current state
        if (requestId !== latestRequestIdRef.current) {
          logger.debug('site.context.stale_response_ignored', {
            siteId: newSiteId,
            requestId,
            latestRequestId: latestRequestIdRef.current
          })
          return
        }

        setApiConfig(config)
        setIsSiteReady(!config.isStatic && dynamicApiConfigService.isSiteReady(newSiteId))

        logger.info('site.context.updated', {
          siteId: newSiteId,
          isStatic: config.isStatic,
          isReady: !config.isStatic && dynamicApiConfigService.isSiteReady(newSiteId)
        })
      } catch (error) {
        // Only update error state if this is still the latest request
        if (requestId !== latestRequestIdRef.current) {
          logger.debug('site.context.stale_error_ignored', {
            siteId: newSiteId,
            requestId,
            latestRequestId: latestRequestIdRef.current
          })
          return
        }

        logger.error('site.context.update.failed', {
          error: error instanceof Error ? error.message : String(error),
          siteId: newSiteId
        })
        // No fallback - API config is null when site config cannot be loaded
        setApiConfig(null)
        setIsSiteReady(false)
      }
    } else {
      // No site ID, no API config available
      logger.info('site.context.cleared', {
        message: 'No siteId provided, clearing API config'
      })
      setApiConfig(null)
      setIsSiteReady(false)
    }
  }, [])

  // Set site ID and update configuration
  const setSiteId = useCallback(async (newSiteId: string | null) => {
    setSiteIdState(newSiteId)
    await updateConfig(newSiteId)
  }, [updateConfig])

  // Manually refresh configuration
  const refreshConfig = useCallback(async () => {
    if (siteId) {
      dynamicApiConfigService.clearCache(siteId)
      await updateConfig(siteId)
    }
  }, [siteId, updateConfig])

  // Wait for site to be ready
  const waitForSite = useCallback(async (timeoutMs = 300000): Promise<boolean> => {
    if (!siteId) return false

    try {
      const maxAttempts = Math.ceil(timeoutMs / 10000) // Convert to attempts (10s intervals)
      let attempts = 0

      while (attempts < maxAttempts) {
        attempts++
        logger.debug('site.readiness.checking', {
          siteId,
          attempt: attempts,
          maxAttempts
        })

        const siteStatus = await sitePollingService.checkSiteStatus(siteId)

        if (siteStatus.ready) {
          logger.info('site.readiness.ready', {
            siteId,
            agentUrl: siteStatus.agent_url
          })
          // Update config when site becomes ready
          const config = await dynamicApiConfigService.getConfigForSite(siteId)
          setApiConfig(config)
          setIsSiteReady(true)
          return true
        }

        if (siteStatus.status === 'failed') {
          logger.error('site.readiness.failed', { siteId })
          return false
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000))
      }

      logger.warn('site.readiness.timeout', { siteId, timeoutMs })
      return false
    } catch (error) {
      logger.error('site.readiness.error', {
        error: error instanceof Error ? error.message : String(error),
        siteId
      })
      return false
    }
  }, [siteId])

  // Clear site context
  const clearSite = useCallback(() => {
    // Note: The new polling service doesn't need manual cancellation as it's promise-based

    setSiteIdState(null)
    setApiConfig(null)
    setIsSiteReady(false)
  }, [])

  // Initialize configuration when component mounts or siteId changes
  useEffect(() => {
    updateConfig(siteId)
  }, [siteId, updateConfig])

  // Cleanup polling when component unmounts
  useEffect(() => {
    return () => {
      // Note: The new polling service doesn't need manual cancellation as it's promise-based
      logger.debug('site.context.cleanup', {
        message: 'SiteContext cleanup, no polling cancellation needed'
      })
    }
  }, [])

  // Log cache performance metrics periodically
  useEffect(() => {
    if (cacheStatus.hitRate > 0) {
      // Use raw values for structured logging (hitRate as number, lastRefresh as timestamp)
      // This allows log aggregation tools to filter/format values appropriately
      // rather than pre-formatting as strings which loses precision and flexibility
      logger.debug('subscription.cache.performance', {
        hitRate: cacheStatus.hitRate,
        hits: cacheStatus.cacheHits,
        misses: cacheStatus.cacheMisses,
        lastRefresh: cacheStatus.lastRefresh,
        isRefreshing: cacheStatus.isRefreshing
      })
    }
  }, [cacheStatus])

  const contextValue: SiteContextValue = {
    siteId,
    apiConfig,
    isSiteReady,
    setSiteId,
    refreshConfig,
    waitForSite,
    clearSite
  }

  return (
    <SiteContext.Provider value={contextValue}>
      {children}
    </SiteContext.Provider>
  )
}

/**
 * Hook to use site context
 */
export function useSiteContext(): SiteContextValue {
  const context = useContext(SiteContext)
  if (context === undefined) {
    throw new Error('useSiteContext must be used within a SiteProvider')
  }
  return context
}

/**
 * Hook to get current API configuration with site context
 */
export function useApiConfig(): DynamicApiConfig | null {
  const { apiConfig } = useSiteContext()
  if (!apiConfig) {
    logger.warn('api.config.unavailable', {
      message: 'No API config available - ensure siteId is set and site is ready'
    })
  }
  return apiConfig
}

/**
 * Hook to get current site ID
 */
export function useSiteId(): string | null {
  const { siteId } = useSiteContext()
  return siteId
}

/**
 * Hook to check if current site is ready
 */
export function useIsSiteReady(): boolean {
  const { isSiteReady } = useSiteContext()
  return isSiteReady
}
