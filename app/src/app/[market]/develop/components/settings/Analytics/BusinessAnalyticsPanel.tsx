'use client'

import Box from '@ux/box'
import Collapsible from '@ux/collapsible'
import text from '@ux/text'

import BusinessAnalyticsOverviewPanel from '@/app/[market]/develop/components/settings/Analytics/BusinessAnalyticsOverviewPanel'
import { useTranslations } from '@/hooks/useTranslations'
import type { BusinessAnalyticsMetrics } from '@/lib/analytics/commerce-reporting'
import { defaultMessageForBusinessAnalyticsKey } from '@/lib/translations/business-analytics-defaults'

interface BusinessAnalyticsPanelProps {
  metrics: BusinessAnalyticsMetrics
  isLoading: boolean
  isFetched: boolean
}

export default function BusinessAnalyticsPanel({
  metrics,
  isLoading,
  isFetched,
}: BusinessAnalyticsPanelProps) {
  const t = useTranslations()

  return (
    <Collapsible
      id="business-analytics"
      size="sm"
      defaultOpen
      title={(
        <text.span as="title" size={-2}>
          {t('builder_analytics_business_analytics', undefined, defaultMessageForBusinessAnalyticsKey('builder_analytics_business_analytics'))}
        </text.span>
      )}
    >
      <Box gap="md" className="pt-1 pb-3" data-testid="business-analytics-panel">
        <BusinessAnalyticsOverviewPanel
          metrics={metrics}
          isLoading={isLoading}
          isFetched={isFetched}
        />
      </Box>
    </Collapsible>
  )
}
