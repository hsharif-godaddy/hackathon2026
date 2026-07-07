'use client'

import Box from '@ux/box'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { AnalyticsChart } from '@/components/analytics/AnalyticsChart'
import { MetricCard } from '@/components/analytics/MetricCard'
import { useTranslations } from '@/hooks/useTranslations'
import {
  type BusinessAnalyticsMetrics,
  formatCommerceCurrency,
} from '@/lib/analytics/commerce-reporting'
import { defaultMessageForBusinessAnalyticsKey } from '@/lib/translations/business-analytics-defaults'

interface BusinessAnalyticsOverviewPanelProps {
  metrics: BusinessAnalyticsMetrics
  isLoading: boolean
  isFetched: boolean
}

function hasOrderActivity(metrics: BusinessAnalyticsMetrics): boolean {
  return metrics.totalRevenue > 0
    || metrics.orderCountOverTime.some((point) => point.value > 0)
}

function hasRevenueActivity(metrics: BusinessAnalyticsMetrics): boolean {
  return metrics.totalRevenue > 0
    || metrics.revenueOverTime.some((point) => point.value > 0)
}

export default function BusinessAnalyticsOverviewPanel({
  metrics,
  isLoading,
  isFetched,
}: BusinessAnalyticsOverviewPanelProps) {
  const t = useTranslations()
  function tr(key: string) {
    return t(key, undefined, defaultMessageForBusinessAnalyticsKey(key))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <Box gap="md">
      <text.span as="title" size={-2}>
        {tr('builder_analytics_business_sales_overview')}
      </text.span>

      <MetricCard
        label={tr('builder_analytics_business_total_revenue')}
        value={formatCommerceCurrency(metrics.totalRevenue)}
      />

      {isFetched && !hasRevenueActivity(metrics) ? (
        <AnalyticsCard
          title={tr('builder_analytics_business_daily_revenue')}
          description={tr('builder_analytics_business_no_orders')}
        />
      ) : (
        <AnalyticsChart
          data={metrics.revenueOverTime}
          label={tr('builder_analytics_business_daily_revenue')}
          fetched={isFetched}
          formatValue={formatCommerceCurrency}
        />
      )}

      {isFetched && !hasOrderActivity(metrics) ? (
        <AnalyticsCard
          title={tr('builder_analytics_business_order_count')}
          description={tr('builder_analytics_business_no_orders')}
        />
      ) : (
        <AnalyticsChart
          data={metrics.orderCountOverTime}
          label={tr('builder_analytics_business_order_count')}
          fetched={isFetched}
        />
      )}
    </Box>
  )
}
