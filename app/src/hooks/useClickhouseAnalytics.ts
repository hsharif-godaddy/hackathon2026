'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { fetchAllClickhouseAnalytics } from '@/lib/insights/clickhouse-fetchers'
import type {
  ClickhouseAnalyticsData,
  KpiExtras,
} from '@/lib/insights/clickhouse-types'
import { logger } from '@/lib/request-context'

interface UseClickhouseAnalyticsOptions {
  publishedUrl: string | null
  appId?: string
  days: number
  enabled?: boolean
}

/**
 * Extract bare hostname from a URL (strip protocol and trailing slash).
 *
 * "https://70mqshlu7h.c4.test-airoapp.ai/" → "70mqshlu7h.c4.test-airoapp.ai"
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

const EMPTY_ARRAY: never[] = []
const EMPTY_KPI: KpiExtras = {
  totalSessions: 0,
  bounceSessions: 0,
  bounceRate: '0%',
  peakHour: '0:00',
  peakHourClicks: 0,
  peakHourVisitors: 0,
  avgPagesPerSession: 0,
  avgSessionDuration: '0m 0s',
}

/** Stable empty-state object returned while loading or when disabled */
const EMPTY_DATA: Omit<ClickhouseAnalyticsData, 'isLoading' | 'error'> = {
  totalHostPageViews: 0,
  totalHostUniqueVisitors: 0,
  dailyHostPageViews: EMPTY_ARRAY,
  dailyUniqueVisitors: EMPTY_ARRAY,
  dailyTotalSessions: EMPTY_ARRAY,
  pageViewsByPathData: EMPTY_ARRAY,
  uniqueVisitorsByPageData: EMPTY_ARRAY,
  pageActivityShareData: EMPTY_ARRAY,
  clickTrendsData: EMPTY_ARRAY,
  clicksByElementData: EMPTY_ARRAY,
  clicksPerPageData: EMPTY_ARRAY,
  clickActivityShareData: EMPTY_ARRAY,
  exitRateData: EMPTY_ARRAY,
  newVsReturningData: EMPTY_ARRAY,
  browserSessionsData: EMPTY_ARRAY,
  sessionsByDeviceData: EMPTY_ARRAY,
  countryTrafficData: EMPTY_ARRAY,
  cityTrafficData: EMPTY_ARRAY,
  pageTransitionsTableData: EMPTY_ARRAY,
  topReferrersData: EMPTY_ARRAY,
  referrerLandingDetailData: EMPTY_ARRAY,
  topCTALabelsData: EMPTY_ARRAY,
  elementSectionData: EMPTY_ARRAY,
  avgClicksPerSessionData: EMPTY_ARRAY,
  clicksByHourData: EMPTY_ARRAY,
  hourlyPageviewVisitorData: EMPTY_ARRAY,
  dailyTrendByPageData: EMPTY_ARRAY,
  hourlyClicksByDeviceData: EMPTY_ARRAY,
  deviceDistributionData: EMPTY_ARRAY,
  deviceMixOverTimeData: EMPTY_ARRAY,
  sessionClickData: EMPTY_ARRAY,
  elementClicksBySectionData: EMPTY_ARRAY,
  kpiExtras: EMPTY_KPI,
  activityHitsData: EMPTY_ARRAY,
  countryTrafficWithCodeData: EMPTY_ARRAY,
  cityTrafficWithCountryData: EMPTY_ARRAY,
  browserTrendsOverTimeData: EMPTY_ARRAY,
}

/**
 * Hook that fetches all ClickHouse-backed analytics data for the dashboard.
 *
 * Uses React Query (`@tanstack/react-query`) for server-state management,
 * providing automatic caching, background refetch, deduplication, and
 * garbage collection — replacing manual useState/useEffect/cache logic.
 *
 * @returns All chart data + isLoading / error states
 */
export function useClickhouseAnalytics({
  publishedUrl,
  appId,
  days,
  enabled = true,
}: UseClickhouseAnalyticsOptions): ClickhouseAnalyticsData {
  const hostname = publishedUrl ? extractHostname(publishedUrl) : ''
  const isEnabled = enabled && !!hostname.trim()

  const { data, isLoading, error } = useQuery({
    queryKey: ['clickhouse-analytics', hostname, days],
    queryFn: async () => {
      logger.debug('analytics.clickhouse.fetch.start', { hostname, days })
      const result = await fetchAllClickhouseAnalytics(hostname, days, appId)
      logger.debug('analytics.clickhouse.fetch.success', { hostname, days })
      return result
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000, // 5 minutes — avoid refetching on every mount
    gcTime: 30 * 60 * 1000, // 30 minutes — keep unused data in cache
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return useMemo((): ClickhouseAnalyticsData => ({
    ...(data ?? EMPTY_DATA),
    isLoading,
    error: error ?? null,
  }), [data, isLoading, error])
}
