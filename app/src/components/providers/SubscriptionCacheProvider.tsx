'use client'

import { useEffect } from 'react'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSubscriptionCache } from '@/hooks/useSubscriptionCache'
import { logger } from '@/lib/request-context'

/**
 * Get JWT token from browser cookies for API authentication
 * This matches the approach used by other production components
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

interface SubscriptionCacheProviderProps {
  children: React.ReactNode
}

/**
 * Subscription Cache Provider
 *
 * Initializes and manages the subscription cache for optimal V2 site lookups.
 * This provider should be placed high in the component tree to ensure cache
 * warming happens early in the application lifecycle.
 */
export default function SubscriptionCacheProvider({ children }: SubscriptionCacheProviderProps) {
  const auth = useAuthContext()
  const isAuthenticated = auth?.isAuthenticated || false
  // Use the same JWT extraction method as production components
  const jwt = getAuthTokenFromCookie()
  const cacheStatus = useSubscriptionCache(jwt)

  // Log cache initialization
  useEffect(() => {
    if (isAuthenticated && jwt) {
      logger.info('subscription-cache.provider.initialized', {
        hasJwt: !!jwt,
        isAuthenticated
      })
    }
  }, [isAuthenticated, jwt])

  // Log cache performance metrics when they change significantly
  useEffect(() => {
    const totalRequests = cacheStatus.cacheHits + cacheStatus.cacheMisses

    // Only log when we have meaningful data (at least 5 requests)
    if (totalRequests >= 5) {
      logger.info('subscription-cache.provider.performance', {
        hitRate: cacheStatus.hitRate,
        hits: cacheStatus.cacheHits,
        misses: cacheStatus.cacheMisses,
        totalRequests,
        lastRefresh: cacheStatus.lastRefresh,
        isRefreshing: cacheStatus.isRefreshing
      })
    }
  }, [cacheStatus])

  return <>{children}</>
}
