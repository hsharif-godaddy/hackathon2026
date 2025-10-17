/**
 * Site Context Provider
 *
 * Manages the current site ID context throughout the application
 * This allows components to know which site's agent URL to use for API calls
 */

'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { dynamicApiConfigService, type DynamicApiConfig } from '@/config/dynamic-api'
import { sitePollingService } from '@/services/SitePollingService'
import { useSubscriptionCache } from '@/hooks/useSubscriptionCache'

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

  // Initialize subscription cache for performance optimization
  const jwt = getAuthTokenFromCookie()
  const cacheStatus = useSubscriptionCache(jwt)

  // Update API configuration when site ID changes
  const updateConfig = useCallback(async (newSiteId: string | null) => {
    if (newSiteId) {
      try {
        const config = await dynamicApiConfigService.getConfigForSite(newSiteId)
        setApiConfig(config)
        setIsSiteReady(!config.isStatic && dynamicApiConfigService.isSiteReady(newSiteId))

        console.log('📱 Site context updated:', {
          siteId: newSiteId,
          isStatic: config.isStatic,
          isReady: !config.isStatic && dynamicApiConfigService.isSiteReady(newSiteId)
        })
      } catch (error) {
        console.error('❌ Failed to update site config:', error)
        // No fallback - API config is null when site config cannot be loaded
        setApiConfig(null)
        setIsSiteReady(false)
      }
    } else {
      // No site ID, no API config available
      console.log('📱 No siteId provided, clearing API config')
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
        console.log(`🔄 Checking site readiness (${attempts}/${maxAttempts}):`, siteId)

        const siteStatus = await sitePollingService.checkSiteStatus(siteId)

        if (siteStatus.ready) {
          console.log(`✅ Site is ready:`, siteId, siteStatus.agent_url)
          // Update config when site becomes ready
          const config = await dynamicApiConfigService.getConfigForSite(siteId)
          setApiConfig(config)
          setIsSiteReady(true)
          return true
        }

        if (siteStatus.status === 'failed') {
          console.log(`❌ Site failed:`, siteId)
          return false
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000))
      }

      console.log(`⏰ Site readiness check timed out:`, siteId)
      return false
    } catch (error) {
      console.error('❌ Error waiting for site:', error)
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
      console.log('🧹 SiteContext cleanup (no polling cancellation needed)')
    }
  }, [])

  // Log cache performance metrics periodically
  useEffect(() => {
    if (cacheStatus.hitRate > 0) {
      console.log('📊 Subscription Cache Performance:', {
        hitRate: `${cacheStatus.hitRate}%`,
        hits: cacheStatus.cacheHits,
        misses: cacheStatus.cacheMisses,
        lastRefresh: cacheStatus.lastRefresh ? new Date(cacheStatus.lastRefresh).toLocaleTimeString() : 'Never',
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
    console.warn('⚠️ No API config available - ensure siteId is set and site is ready')
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
