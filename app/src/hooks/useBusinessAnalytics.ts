import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useCommerceStoreId } from '@/hooks/useBusinessCommerceIds'
import { isConfiguredValue } from '@/lib/analytics/commerce-ids'
import {
  aggregateBusinessAnalyticsMetrics,
  type BusinessAnalyticsMetrics,
  fetchBusinessAnalyticsSourceData,
} from '@/lib/analytics/commerce-reporting'
import {
  analyticsDateKey,
  type AnalyticsDateSelection,
} from '@/lib/insights/clickhouse-queries'

const EMPTY_METRICS: BusinessAnalyticsMetrics = {
  totalRevenue: 0,
  orderCountOverTime: [],
  revenueOverTime: [],
}

export function useBusinessAnalyticsMetrics(
  appId: string | null | undefined,
  storeId: string | null | undefined,
  dateSelection: AnalyticsDateSelection,
) {
  const query = useQuery({
    queryKey: ['business-analytics-metrics', appId, storeId, analyticsDateKey(dateSelection)],
    queryFn: () => fetchBusinessAnalyticsSourceData(appId!, storeId!, dateSelection),
    enabled: !!appId && !!storeId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const metrics = useMemo(() => {
    if (!query.data) return EMPTY_METRICS
    return aggregateBusinessAnalyticsMetrics({
      orderCountOverTime: query.data.orderCountOverTime,
      revenueOverTime: query.data.revenueOverTime,
    })
  }, [query.data])

  return {
    metrics,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetched: query.isFetched,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}

export function useBusinessAnalyticsData(
  appId: string | null | undefined,
  dateSelection: AnalyticsDateSelection,
) {
  const storeIdQuery = useCommerceStoreId(appId)
  const storeId = isConfiguredValue(storeIdQuery.data ?? undefined) ? storeIdQuery.data! : null
  const analyticsMetrics = useBusinessAnalyticsMetrics(appId, storeId, dateSelection)

  const dataReady: boolean = !!storeId
    && !storeIdQuery.isError
    && !analyticsMetrics.isError

  return {
    showBusinessAnalytics: !!storeId,
    dataReady,
    storeId,
    isLoading: analyticsMetrics.isLoading,
    isFetched: storeIdQuery.isFetched && analyticsMetrics.isFetched,
    isFetching: analyticsMetrics.isFetching,
    metrics: analyticsMetrics.metrics,
    refetch: analyticsMetrics.refetch,
  }
}
