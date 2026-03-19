'use client'

import { useEffect, useRef, useState } from 'react'

import { transformDailyBreakdown } from '@/lib/insights/calculations'
import { fetchDailyPageViews, fetchRouteCount, fetchVisitors } from '@/lib/insights/data-fetchers'
import { getRoutesToQuery } from '@/lib/insights/route-discovery'
import type { DailyPageView, RoutePageView, UseInsightsAnalyticsOptions } from '@/lib/insights/types'
import { logger } from '@/lib/request-context'

/**
 * Session-level cache to persist data across component unmounts
 * This allows data to persist when navigating between views
 */
interface SessionCache {
  dailyPageViews: DailyPageView[]
  routePageViews: RoutePageView[]
  totalPageViews: number
  visitors: number
  viewsPerVisit: number
  publishedUrl: string | null
  appId: string | null
  days: number
  timestamp: number
}

/**
 * Generate cache key for a specific configuration
 *
 * @param publishedUrl - Published URL
 * @param appId - App ID
 * @param days - Number of days
 * @returns Cache key string
 */
function getCacheKey(publishedUrl: string | null, appId: string | null, days: number): string {
  return `${publishedUrl || ''}-${appId || ''}-${days}`
}

// Module-level cache (persists across component mounts/unmounts in same session)
// Keyed by publishedUrl-appId-days to support multiple time periods
const sessionCacheMap = new Map<string, SessionCache>()

/**
 * Hook to fetch page view analytics from insights GraphQL API
 *
 * Features:
 * - Single token fetch (cached server-side)
 * - Automatic retry with exponential backoff
 * - Request timeouts (30s per request)
 * - Comprehensive error handling
 * - Progress tracking for loading states
 * - Calculates daily page views from cumulative data: q(n) - q(n-1)
 *
 * @param options - Configuration options
 * @param options.publishedUrl - Published URL to query analytics for
 * @param options.appId - App ID to discover routes from (optional)
 * @param options.days - Number of days to fetch (default: 7)
 * @param options.enabled - Whether to enable fetching (default: true)
 * @returns Analytics data including daily page views, routes, total, loading state, and errors
 *
 * @example
 * ```tsx
 * const { dailyPageViews, totalPageViews, isLoading, error } = useInsightsAnalytics({
 *   publishedUrl: 'https://example.com',
 *   days: 7
 * })
 * ```
 */
export function useInsightsAnalytics({
  publishedUrl,
  appId,
  days = 7,
  enabled = true
}: UseInsightsAnalyticsOptions) {
  const [dailyPageViews, setDailyPageViews] = useState<DailyPageView[]>([])
  const [routePageViews, setRoutePageViews] = useState<RoutePageView[]>([])
  const [totalPageViews, setTotalPageViews] = useState<number>(0)
  const [visitors, setVisitors] = useState<number>(0)
  const [viewsPerVisit, setViewsPerVisit] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isInitialMountRef = useRef<boolean>(true)

  // Restore from session cache on mount if available
  useEffect(() => {
    const cacheKey = getCacheKey(publishedUrl, appId, days)
    const cached = sessionCacheMap.get(cacheKey)

    if (cached) {
      setDailyPageViews(cached.dailyPageViews)
      setRoutePageViews(cached.routePageViews)
      setTotalPageViews(cached.totalPageViews)
      setVisitors(cached.visitors)
      setViewsPerVisit(cached.viewsPerVisit)
      isInitialMountRef.current = false
    }
  }, [publishedUrl, appId, days])

  useEffect(() => {
    if (!enabled || !publishedUrl || publishedUrl.trim() === '') {
      setDailyPageViews([])
      setRoutePageViews([])
      setTotalPageViews(0)
      setVisitors(0)
      setViewsPerVisit(0)
      setLoadingProgress(null)
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      sessionCacheMap.clear()
      isInitialMountRef.current = true
      return
    }

    const cacheKey = getCacheKey(publishedUrl, appId, days)
    const cached = sessionCacheMap.get(cacheKey)

    // Check if we have cached data for this exact configuration
    const hasCachedData = cached &&
      (cached.dailyPageViews.length > 0 || cached.totalPageViews > 0)

    // If we have cached data, restore it immediately
    if (hasCachedData) {
      setDailyPageViews(cached.dailyPageViews)
      setRoutePageViews(cached.routePageViews)
      setTotalPageViews(cached.totalPageViews)
      setVisitors(cached.visitors)
      setViewsPerVisit(cached.viewsPerVisit)
      // Show refreshing indicator while fetching fresh data in background
      setIsRefreshing(true)
    } else {
      // No cached data - show full loader
      setIsLoading(true)
      setLoadingProgress({ current: 0, total: 1 })
    }

    // Always fetch fresh data (either in background if we have cache, or as initial load)
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setError(null)

    async function fetchAnalytics() {

      try {
        logger.debug('analytics.fetch.start', { publishedUrl, days, operation: 'start' })

        // Fetch daily page views in a single query
        // Auth is handled server-side in the API route, so we don't need to fetch token client-side
        setLoadingProgress({ current: 0, total: 1 })

        logger.debug('analytics.fetch.daily-page-views.begin', { publishedUrl, days, operation: 'daily-page-views' })
        const { count: total, dailyBreakdown } = await fetchDailyPageViews(
          publishedUrl,
          days
        )

        logger.debug('analytics.fetch.daily-page-views.success', {
          publishedUrl,
          days,
          operation: 'daily-page-views',
          total,
          dailyBreakdownCount: dailyBreakdown.length
        })

        if (abortController.signal.aborted) {
          return
        }

        setLoadingProgress({ current: 1, total: 1 })

        // Transform daily breakdown to DailyPageView format
        const dailyData = transformDailyBreakdown(dailyBreakdown)
        logger.debug('analytics.fetch.transform', {
          publishedUrl,
          days,
          operation: 'transform',
          dailyBreakdownCount: dailyData.length
        })

        // Fetch visitors count using full URL
        let visitorsCount = 0
        if (publishedUrl && !abortController.signal.aborted) {
          try {
            visitorsCount = await fetchVisitors(publishedUrl, days)
          } catch (err) {
            logger.debug('analytics.fetch.visitors.failure', {
              publishedUrl,
              days,
              operation: 'visitors',
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }

        // Calculate views per visit (pageViews / visitors)
        const viewsPerVisitValue = visitorsCount > 0 ? total / visitorsCount : 0

        // Update data (this will trigger re-render with new data)
        setDailyPageViews(dailyData)
        setTotalPageViews(total)
        setVisitors(visitorsCount)
        setViewsPerVisit(viewsPerVisitValue)

        // Update session cache for this period
        const cacheKey = getCacheKey(publishedUrl, appId, days)
        const cacheEntry: SessionCache = {
          dailyPageViews: dailyData,
          routePageViews: [],
          totalPageViews: total,
          visitors: visitorsCount,
          viewsPerVisit: viewsPerVisitValue,
          publishedUrl,
          appId: appId || null,
          days,
          timestamp: Date.now()
        }
        sessionCacheMap.set(cacheKey, cacheEntry)

        // Fetch route-specific data (non-blocking)
        if (!abortController.signal.aborted && appId) {
          try {
            const routesToQuery = await getRoutesToQuery(appId)
            const routePromises = routesToQuery.map(async (route) => {
              try {
                const count = await fetchRouteCount(publishedUrl, route, days)
                return count > 0 ? { route, pageViews: count } as RoutePageView : null
              } catch {
                return null
              }
            })

            const routeResults = await Promise.all(routePromises)
            const validRoutes = routeResults.filter((r): r is RoutePageView => r !== null)
            setRoutePageViews(validRoutes)

            // Update session cache with route data
            const updatedCache = sessionCacheMap.get(cacheKey)
            if (updatedCache) {
              updatedCache.routePageViews = validRoutes
              sessionCacheMap.set(cacheKey, updatedCache)
            }
          } catch {
            // Keep existing route data if fetch fails
            const existingCache = sessionCacheMap.get(cacheKey)
            if (existingCache) {
              setRoutePageViews(existingCache.routePageViews)
            } else {
              setRoutePageViews([])
            }
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          const error = err instanceof Error ? err : new Error('Failed to fetch analytics')
          // Only set error if we don't have cached data to show
          const cacheKey = getCacheKey(publishedUrl, appId, days)
          const cached = sessionCacheMap.get(cacheKey)
          if (!cached) {
            setError(error)
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false)
          setIsRefreshing(false)
          setLoadingProgress(null)
          isInitialMountRef.current = false
        }
      }
    }

    // Always fetch - either initial load or background refresh
    fetchAnalytics().catch((err) => {
      if (!abortController.signal.aborted) {
        const error = err instanceof Error ? err : new Error('Failed to fetch analytics')
        // Only set error if we don't have cached data to show
        if (!hasCachedData) {
          setError(error)
        }
        setIsLoading(false)
        setIsRefreshing(false)
        isInitialMountRef.current = false
      }
    })

    return () => {
      abortController.abort()
    }
  }, [publishedUrl, appId, days, enabled])

  // Background refresh: automatically refresh cached data every 5 minutes
  useEffect(() => {
    if (!enabled || !publishedUrl || publishedUrl.trim() === '') {
      return
    }

    const cacheKey = getCacheKey(publishedUrl, appId, days)
    const cached = sessionCacheMap.get(cacheKey)

    // Only set up background refresh if we have cached data
    if (!cached) {
      return
    }

    // Refresh interval: 5 minutes (300000 ms)
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000

    const refreshInterval = setInterval(async () => {
      const currentCache = sessionCacheMap.get(cacheKey)
      // Only refresh if this is still the active period
      if (currentCache?.publishedUrl === publishedUrl &&
          currentCache.appId === appId && currentCache.days === days) {
        logger.debug('analytics.refresh.start', { publishedUrl, days, operation: 'refresh' })
        setIsRefreshing(true)

        try {
          // Fetch fresh data in background
          const { count: total, dailyBreakdown } = await fetchDailyPageViews(publishedUrl, days)
          const dailyData = transformDailyBreakdown(dailyBreakdown)

          // Fetch visitors
          let visitorsCount = 0
          try {
            visitorsCount = await fetchVisitors(publishedUrl, days)
          } catch (err) {
            logger.debug('analytics.fetch.visitors.failure', {
              publishedUrl,
              days,
              operation: 'visitors',
              error: err instanceof Error ? err.message : String(err)
            })
          }

          const viewsPerVisitValue = visitorsCount > 0 ? total / visitorsCount : 0

          // Update cache silently (don't update state if user switched periods)
          const currentCacheKey = getCacheKey(publishedUrl, appId, days)
          const stillActive = sessionCacheMap.get(currentCacheKey)?.days === days

          if (stillActive) {
            const updatedCache: SessionCache = {
              dailyPageViews: dailyData,
              routePageViews: currentCache?.routePageViews || [],
              totalPageViews: total,
              visitors: visitorsCount,
              viewsPerVisit: viewsPerVisitValue,
              publishedUrl,
              appId: appId || null,
              days,
              timestamp: Date.now()
            }
            sessionCacheMap.set(currentCacheKey, updatedCache)

            // Update state only if this is still the active period
            setDailyPageViews(dailyData)
            setTotalPageViews(total)
            setVisitors(visitorsCount)
            setViewsPerVisit(viewsPerVisitValue)
          }
        } catch (err) {
          logger.debug('analytics.refresh.failure', {
            publishedUrl,
            days,
            operation: 'refresh',
            error: err instanceof Error ? err.message : String(err)
          })
        } finally {
          setIsRefreshing(false)
        }
      }
    }, REFRESH_INTERVAL_MS)

    return () => {
      clearInterval(refreshInterval)
    }
  }, [publishedUrl, appId, days, enabled])

  return {
    dailyPageViews,
    routePageViews,
    totalPageViews,
    visitors,
    viewsPerVisit,
    isLoading,
    isRefreshing,
    loadingProgress,
    error
  }
}

// Re-export types for convenience
export type { DailyPageView, RoutePageView } from '@/lib/insights/types'
