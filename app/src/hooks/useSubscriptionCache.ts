import { useEffect } from 'react'

import { logger } from '@/lib/request-context'
import { useSubscriptionCacheStore } from '@/stores/useSubscriptionCacheStore'

/**
 * Hook for managing subscription cache lifecycle
 * 
 * @param jwt - Authentication token for API calls
 * @returns Cache status information
 */
export function useSubscriptionCache(jwt: string | null) {
  const initialize = useSubscriptionCacheStore((state) => state.initialize)
  const refresh = useSubscriptionCacheStore((state) => state.refresh)
  const lastRefresh = useSubscriptionCacheStore((state) => state.lastRefresh)
  const isRefreshing = useSubscriptionCacheStore((state) => state.isRefreshing)
  const cacheHits = useSubscriptionCacheStore((state) => state.cacheHits)
  const cacheMisses = useSubscriptionCacheStore((state) => state.cacheMisses)
  
  // Initialize cache on mount if JWT is available
  useEffect(() => {
    if (jwt) {
      logger.debug('subscription-cache.hook.initialize')
      initialize(jwt)
    }
  }, [jwt, initialize])
  
  // Background refresh every 5 minutes
  useEffect(() => {
    if (!jwt) {return}
    
    logger.debug('subscription-cache.hook.setup-refresh-timer')
    
    const interval = setInterval(() => {
      logger.debug('subscription-cache.hook.background-refresh')
      refresh(jwt, false) // Non-blocking background refresh
    }, 5 * 60 * 1000) // 5 minutes
    
    return () => {
      logger.debug('subscription-cache.hook.cleanup-refresh-timer')
      clearInterval(interval)
    }
  }, [jwt, refresh])
  
  // Calculate hit rate
  const hitRate = (cacheHits + cacheMisses) > 0 
    ? (cacheHits / (cacheHits + cacheMisses) * 100) 
    : 0
  
  return { 
    lastRefresh, 
    isRefreshing,
    cacheHits,
    cacheMisses,
    hitRate: Math.round(hitRate * 100) / 100 // Round to 2 decimal places
  }
}
