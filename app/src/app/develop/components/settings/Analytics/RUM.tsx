'use client'

import { useMemo, useState } from 'react'
import Box from '@ux/box'
import AlertIcon from '@ux/icon/alert'
import Select from '@ux/select'

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState';
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { AnalyticsChart } from '@/components/analytics/AnalyticsChart'
import { AnalyticsTables } from '@/components/analytics/AnalyticsTables'
import { MetricCard } from '@/components/analytics/MetricCard'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useInsightsAnalytics } from '@/hooks/useInsightsAnalytics'
import { useTranslations } from '@/hooks/useTranslations'
import { TooltipProvider } from '@/lib/shadcn/tooltip'
import { useSiteStore } from '@/stores/useSiteStore'
import { hasBeenPublished } from '@/utils/site'

/**
 * Calculate number of days passed in current month
 *
 * @returns Number of days from start of month to today (inclusive)
 */
function getDaysThisMonth(): number {
  const now = new Date()
  const dayOfMonth = now.getDate()
  return dayOfMonth
}

type TimePeriod = '7' | '30' | 'month'

/**
 * RUM component for Analytics panel view
 *
 * Displays website analytics data including metrics, charts, and tables
 * in a format suitable for the settings panel.
 * Supports multiple time periods with caching and background refresh.
 *
 * @returns RUM panel component
 */
export default function RUM() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const site = useSiteStore((state) => appId ? state.getSite(appId) : null)
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('7')

  // Calculate days based on selected period
  const days = useMemo(() => {
    switch (selectedPeriod) {
      case '7':
        return 7
      case '30':
        return 30
      case 'month':
        return getDaysThisMonth()
      default:
        return 7
    }
  }, [selectedPeriod])

  // Get published URL from site store with priority:
  // 1. Custom domain (domainType !== 'prefix')
  // 2. Prefix domain (domainType === 'prefix')
  // 3. Published URL from site.published_url
  const publishedUrl = useMemo(() => {
    if (!hasBeenPublished(site)) {
      return null
    }

    const customDomain = site?.domains?.find(d => d.domainType && d.domainType !== 'prefix' && d.status === 'active')
    const prefixDomain = site?.domains?.find(d => d.domainType === 'prefix' && d.status === 'active')
    const publishedFqdn = site?.published_url

    if (customDomain?.fqdn) {
      return customDomain.fqdn.startsWith('https://') ? customDomain.fqdn : `https://${customDomain.fqdn}`
    }
    if (prefixDomain?.fqdn) {
      return prefixDomain.fqdn.startsWith('https://') ? prefixDomain.fqdn : `https://${prefixDomain.fqdn}`
    }
    return publishedFqdn || null
  }, [site])

  // Fetch analytics data from insights API
  const {
    dailyPageViews,
    routePageViews,
    totalPageViews,
    visitors,
    viewsPerVisit,
    isLoading,
    isRefreshing,
    error
  } = useInsightsAnalytics({
    publishedUrl,
    appId,
    days,
    enabled: !!publishedUrl
  })

  const chartData = useMemo(() => {
    return dailyPageViews.map(d => ({
      date: d.date,
      value: d.pageViews
    }))
  }, [dailyPageViews])

  // Calculate metrics from real analytics data
  const metrics = useMemo(() => {
    return {
      pageviews: totalPageViews,
      visitors: visitors,
      viewsPerVisit: viewsPerVisit
    }
  }, [totalPageViews, visitors, viewsPerVisit])

  // Convert route page views to table format
  // Only use routes discovered from the app - no hardcoded fallback
  const pageData = useMemo(() => {
    return routePageViews.map(r => ({
      page: r.route,
      visitors: r.pageViews
    }))
  }, [routePageViews])

  // Show loading state only on initial load (when no data exists)
  // If we have data, show it even if refreshing in background
  if (isLoading && dailyPageViews.length === 0 && totalPageViews === 0) {
    return (
      <SettingsLoadingState
        fullPage
        title={t('builder_rum_fetching_data')}
      />
    )
  }

  // Show error state with actionable message
  if (error) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<AlertIcon width={48} height={48} />}
          title={t('builder_rum_error_title')}
          description={error.message || t('builder_rum_error_desc')}
          ctaLabel={t('builder_common_try_again')}
          onCtaClick={() => window.location.reload()}
        />
      </Box>
    )
  }

  return (
    <BigCard
      title={t('builder_rum_title')}
      description={t('builder_rum_desc')}
      hideStatus={true}
      button={(
        <Select
          value={selectedPeriod}
          id="period-select"
          name="period-select"
          onChange={(value) => setSelectedPeriod(value as TimePeriod)}
          label={t('builder_rum_select_period')}
          visualSize="md"
        >
          <option value="7">{t('builder_rum_period_7')}</option>
          <option value="30">{t('builder_rum_period_30')}</option>
          <option value="month">{t('builder_rum_period_month')}</option>
        </Select>
      )}
    >
      <TooltipProvider>
        <div className="h-full overflow-y-auto">
          <Box gap="md" className="relative">
            {isRefreshing && (
              <div className="absolute z-50 pointer-events-none inset-0 flex items-center justify-center w-full bg-intents-ux-boxLowContrastOverlay-backgroundColor">
                <SettingsLoadingState />
              </div>
            )}
            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MetricCard
                label={t('builder_rum_pageviews')}
                value={metrics.pageviews}
              />
              <MetricCard
                label={t('builder_rum_visitors')}
                value={metrics.visitors}
              />
              <MetricCard
                label={t('builder_rum_views_visit')}
                value={metrics.viewsPerVisit > 0 ? metrics.viewsPerVisit.toFixed(2) : '0.00'}
              />
            </div>
            <AnalyticsChart data={chartData} />
            <AnalyticsTables pageData={pageData} />
          </Box>
        </div>
      </TooltipProvider>
    </BigCard>
  )
}
