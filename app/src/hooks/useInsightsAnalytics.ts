'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { transformDailyBreakdown } from '@/lib/insights/calculations'
import {
  fetchButtonClicks,
  fetchDailyPageViews,
  fetchLinkClicks,
  fetchRouteCount,
  fetchTotalClicks,
  fetchVisitors,
} from '@/lib/insights/data-fetchers'
import { getRoutesToQuery } from '@/lib/insights/route-discovery'
import type { DailyClickCount, DailyPageView, RoutePageView, UseInsightsAnalyticsOptions } from '@/lib/insights/types'
import { logger } from '@/lib/request-context'

/** Shape returned by the queryFn (raw fetched data). */
interface InsightsQueryResult {
  dailyPageViews: DailyPageView[]
  dailyClicks: DailyClickCount[]
  routePageViews: RoutePageView[]
  totalPageViews: number
  totalClicks: number
  buttonClicks: number
  linkClicks: number
  visitors: number
  viewsPerVisit: number
}

const EMPTY_ARRAY: never[] = []

/** Stable empty-state object returned while loading or when disabled. */
const EMPTY_DATA: InsightsQueryResult = {
  dailyPageViews: EMPTY_ARRAY,
  dailyClicks: EMPTY_ARRAY,
  routePageViews: EMPTY_ARRAY,
  totalPageViews: 0,
  totalClicks: 0,
  buttonClicks: 0,
  linkClicks: 0,
  visitors: 0,
  viewsPerVisit: 0,
}

/**
 * Fetch all insights analytics data in parallel.
 *
 * This is the single queryFn consumed by React Query.
 */
async function fetchAllInsightsAnalytics(
  publishedUrl: string,
  appId: string | null | undefined,
  days: number,
): Promise<InsightsQueryResult> {
  logger.debug('analytics.insights.fetch.start', { publishedUrl, days })

  // Fire all independent fetches in parallel
  const [
    pageViewsResult,
    totalClicksResult,
    buttonClicksResult,
    linkClicksResult,
    visitorsCount,
  ] = await Promise.all([
    fetchDailyPageViews(publishedUrl, days, appId ?? undefined),
    fetchTotalClicks(publishedUrl, days, appId ?? undefined),
    fetchButtonClicks(publishedUrl, days, appId ?? undefined),
    fetchLinkClicks(publishedUrl, days, appId ?? undefined),
    fetchVisitors(publishedUrl, days, appId ?? undefined),
  ])

  const dailyPageViews = transformDailyBreakdown(pageViewsResult.dailyBreakdown)

  const dailyClicks: DailyClickCount[] = totalClicksResult.dailyBreakdown.map((d) => ({
    date: d.date,
    totalClicks: d.count,
    cumulativeCount: 0,
  }))

  const viewsPerVisit = visitorsCount > 0 ? pageViewsResult.count / visitorsCount : 0

  // Fetch route-specific data (non-critical, best-effort)
  let routePageViews: RoutePageView[] = []
  if (appId) {
    try {
      const routes = await getRoutesToQuery(appId)
      const routeResults = await Promise.all(
        routes.map(async (route) => {
          try {
            const count = await fetchRouteCount(publishedUrl, route, days, appId ?? undefined)
            return count > 0 ? ({ route, pageViews: count } as RoutePageView) : null
          } catch {
            return null
          }
        }),
      )
      routePageViews = routeResults.filter((r): r is RoutePageView => r !== null)
    } catch {
      // Route discovery failed — proceed without route data
    }
  }

  logger.debug('analytics.insights.fetch.success', { publishedUrl, days })

  return {
    dailyPageViews,
    dailyClicks,
    routePageViews,
    totalPageViews: pageViewsResult.count,
    totalClicks: totalClicksResult.count,
    buttonClicks: buttonClicksResult.count,
    linkClicks: linkClicksResult.count,
    visitors: visitorsCount,
    viewsPerVisit,
  }
}

/**
 * Hook to fetch page view analytics from insights GraphQL API.
 *
 * Uses React Query (`@tanstack/react-query`) for server-state management,
 * providing automatic caching, background refetch, deduplication, and
 * garbage collection — replacing manual useState/useEffect/cache logic.
 *
 * @example
 * ```tsx
 * const { totalPageViews, isLoading, error } = useInsightsAnalytics({
 *   publishedUrl: 'https://example.com',
 *   days: 7,
 * })
 * ```
 */
export function useInsightsAnalytics({
  publishedUrl,
  appId,
  days = 7,
  enabled = true,
}: UseInsightsAnalyticsOptions) {
  const isEnabled = enabled && !!publishedUrl?.trim()

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['insights-analytics', publishedUrl, appId, days],
    queryFn: () => fetchAllInsightsAnalytics(publishedUrl!, appId, days),
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,  // 5 minutes — avoid refetching on every mount
    gcTime: 30 * 60 * 1000,    // 30 minutes — keep unused data in cache
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return useMemo(() => ({
    ...(data ?? EMPTY_DATA),
    isLoading,
    isRefreshing: !isLoading && isFetching,
    error: error ?? null,
  }), [data, isLoading, isFetching, error])
}

// Re-export types for convenience
export type { DailyPageView, RoutePageView } from '@/lib/insights/types'
