'use client'

import { useMemo, useState } from 'react'
import Box from '@ux/box'
import AlertIcon from '@ux/icon/alert'
import Select from '@ux/select'
import text from '@ux/text'

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { usePublishedUrl } from '@/app/develop/hooks/usePublishedUrl'
import { AnalyticsChart } from '@/components/analytics/AnalyticsChart'
import { AnalyticsDetailTable } from '@/components/analytics/AnalyticsDetailTable'
import { AnalyticsHorizontalBarChart } from '@/components/analytics/AnalyticsHorizontalBarChart'
import { AnalyticsHorizontalSingleBarChart } from '@/components/analytics/AnalyticsHorizontalSingleBarChart'
import { AnalyticsMultiAreaChart } from '@/components/analytics/AnalyticsMultiAreaChart'
import { AnalyticsPieChart } from '@/components/analytics/AnalyticsPieChart'
import { MetricCard } from '@/components/analytics/MetricCard'
import BigCard from '@/components/layout/BigCard'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useClickhouseAnalytics } from '@/hooks/useClickhouseAnalytics'
import { useInsightsAnalytics } from '@/hooks/useInsightsAnalytics'
import { useTranslations } from '@/hooks/useTranslations'
import type {
  ActivityHitRow,
  CountryVisitorRow,
  TopPageRow,
} from '@/lib/insights/clickhouse-types'
import { TooltipProvider } from '@/lib/shadcn/tooltip'

/** Section header with title and colored badge pill */
function SectionHeader({ title, badge }: { title: string; badge: string }) {
  return (
    <div className="flex items-center gap-2.5 mt-5 mb-0.5">
      <h3 className="text-sm font-bold tracking-tight">{title}</h3>
      <text.span className="!text-[10px] !font-semibold px-2.5 py-0.5 rounded-full bg-ai/10 text-ai">{badge}</text.span>
    </div>
  )
}

function PageBadge({ value }: { value: string }) {
  return (
    <text.span
      className="!inline-block !px-2.5 !py-0.5 !rounded-md !text-[12px] !font-medium !whitespace-nowrap !font-mono"
      style={{ background: 'var(--color-ai-glow)', color: 'var(--color-ai)' }}
    >
      {value}
    </text.span>
  )
}

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
  const publishedUrl = usePublishedUrl()
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

  const [liveDataTab, setLiveDataTab] = useState<'pageviews' | 'visitors' | 'browsers'>('visitors')
  const [visitorInsightsTab, setVisitorInsightsTab] = useState<'clicks' | 'total-sessions'>('clicks')
  const [geoTab, setGeoTab] = useState<'country' | 'city'>('country')

  // Fetch analytics data from insights API (remaining: route count, loading state)
  const {
    totalClicks,
    isLoading,
    isRefreshing,
    error
  } = useInsightsAnalytics({
    publishedUrl,
    appId,
    days,
    enabled: !!publishedUrl
  })

  // Fetch all ClickHouse-backed chart data (replaces mock data)
  const {
    totalHostPageViews,
    totalHostUniqueVisitors,
    dailyHostPageViews,
    pageViewsByPathData,
    uniqueVisitorsByPageData,
    clickTrendsData,
    clicksPerPageData,
    newVsReturningData,
    browserSessionsData,
    sessionsByDeviceData,
    countryTrafficData,
    cityTrafficData,
    topReferrersData,
    referrerLandingDetailData,
    kpiExtras,
    activityHitsData,
  } = useClickhouseAnalytics({
    publishedUrl,
    appId,
    days,
    enabled: !!publishedUrl
  })

  const chartData = useMemo(() => {
    return dailyHostPageViews.map(d => ({
      date: d.date,
      value: d.value
    }))
  }, [dailyHostPageViews])

  // Calculate metrics from real analytics data
  const metrics = useMemo(() => {
    const vv = totalHostUniqueVisitors
    return {
      pageviews: totalHostPageViews,
      totalClicks: totalClicks,
      visitors: vv,
      viewsPerVisit: vv > 0 ? totalHostPageViews / vv : 0
    }
  }, [totalHostPageViews, totalHostUniqueVisitors, totalClicks])

  // Transform country traffic into a visitors table format (top 5)
  const countryVisitorTableData = useMemo((): CountryVisitorRow[] => {
    return countryTrafficData
      .slice()
      .sort((a, b) => b.value2 - a.value2)
      .slice(0, 5)
      .map((d) => ({
        country: d.date,
        visitors: d.value2,
      }))
  }, [countryTrafficData])

  // Transform city traffic into a visitors table format (top 5)
  const cityVisitorTableData = useMemo((): CountryVisitorRow[] => {
    return cityTrafficData
      .slice()
      .sort((a, b) => b.value2 - a.value2)
      .slice(0, 5)
      .map((d) => ({
        country: d.date,
        visitors: d.value2,
      }))
  }, [cityTrafficData])

  // Combine 4 data sources into a Top Pages table
  const topPagesData = useMemo((): TopPageRow[] => {
    const map = new Map<string, TopPageRow>()
    const ensure = (path: string) => {
      if (!map.has(path)) {
        const name = path === '/' ? t('builder_analytics_home_page') : path.replace(/^\//, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        map.set(path, { pagePath: path, pageName: name, visitors: 0, totalViews: 0, referralVisits: 0, clicks: 0 })
      }
      return map.get(path)!
    }
    // Visitors from airobuilder_unique_visitors_per_page
    for (const d of uniqueVisitorsByPageData) {
      ensure(d.date).visitors += d.value
    }
    // Total Views from airobuilder_page_views_per_path
    for (const d of pageViewsByPathData) {
      ensure(d.date).totalViews += d.value
    }
    // Referral Visits from airobuilder_referrer_landing_page
    for (const d of referrerLandingDetailData) {
      ensure(d.landingPage).referralVisits += d.visits
    }
    // Clicks from airobuilder_clicks_per_page
    for (const d of clicksPerPageData) {
      ensure(d.date).clicks += d.value
    }
    return [...map.values()].sort((a, b) => b.totalViews - a.totalViews).slice(0, 10)
  }, [uniqueVisitorsByPageData, pageViewsByPathData, referrerLandingDetailData, clicksPerPageData, t])

  // Enrich raw activity hits with referrer/page-name lookups (real data only, no fabrication)
  const enrichedActivityHits = useMemo((): ActivityHitRow[] => {
    if (activityHitsData.length === 0) return []

    // Build referrer lookup by landing page from airobuilder_referrer_landing_page
    const referrerByPage = new Map<string, string>()
    for (const r of referrerLandingDetailData) {
      if (!referrerByPage.has(r.landingPage) || r.visits > 0) {
        referrerByPage.set(r.landingPage, r.referrer)
      }
    }

    // Build page name from topPagesData (derived from path)
    const pageNameMap = new Map<string, string>()
    for (const p of topPagesData) {
      pageNameMap.set(p.pagePath, p.pageName)
    }

    const directLabel = t('builder_analytics_direct_referrer')

    return activityHitsData.map((hit) => ({
      date: hit.date,
      pagePath: hit.pagePath,
      pageName: hit.pageName || pageNameMap.get(hit.pagePath) || hit.pagePath,
      device: hit.device || t('builder_analytics_unknown'),
      referrer: hit.referrer || referrerByPage.get(hit.pagePath) || directLabel,
      views: hit.views,
      uniqueVisitors: hit.uniqueVisitors,
      country: hit.country || 'N/A',
      browser: hit.browser || t('builder_analytics_unknown'),
    }))
  }, [activityHitsData, referrerLandingDetailData, topPagesData, t])

  // Show loading state only on initial load (when no data exists)
  // If we have data, show it even if refreshing in background
  if (isLoading && dailyHostPageViews.length === 0 && totalHostPageViews === 0) {
    return (
      <SettingsLoadingState
        fullPage
        title={t('builder_analytics_fetching_data')}
      />
    )
  }

  // Show error state with actionable message
  if (error) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<AlertIcon width={48} height={48} />}
          title={t('builder_analytics_error_title')}
          description={error.message || t('builder_analytics_error_description')}
          ctaLabel={t('builder_analytics_try_again')}
          onCtaClick={() => window.location.reload()}
        />
      </Box>
    )
  }

  return (
    <BigCard
      title={t('builder_analytics_rum_title')}
      description={t('builder_analytics_rum_description')}
      hideStatus={true}
      button={(
        <Select
          value={selectedPeriod}
          id="period-select"
          name="period-select"
          onChange={(value) => setSelectedPeriod(value as TimePeriod)}
          label={t('builder_analytics_select_period')}
          visualSize="md"
        >
          <option value="7">{t('builder_analytics_last_7_days')}</option>
          <option value="30">{t('builder_analytics_last_30_days')}</option>
          <option value="month">{t('builder_analytics_this_month')}</option>
        </Select>
      )}
    >
      <TooltipProvider>
        <div className="h-full overflow-y-auto @container">
          <Box gap="md" className="relative">
            {isRefreshing && (
              <div className="absolute z-50 pointer-events-none inset-0 flex items-center justify-center w-full bg-intents-ux-boxLowContrastOverlay-backgroundColor">
                <SettingsLoadingState />
              </div>
            )}
            {/* Key Metrics — Row 1: Core Overview */}
            <div className="grid grid-cols-2 @md:grid-cols-5 gap-3">
              <MetricCard
                label={t('builder_analytics_pageviews')}
                value={metrics.pageviews}
                description={t('builder_analytics_total_page_loads')}
              />
              <MetricCard
                label={t('builder_analytics_visitors')}
                value={metrics.visitors}
                description={t('builder_analytics_unique_visitors')}
              />
              <MetricCard
                label={t('builder_analytics_views_per_visit')}
                value={metrics.viewsPerVisit > 0 ? metrics.viewsPerVisit.toFixed(2) : '0.00'}
                description={t('builder_analytics_pages_per_visitor')}
              />
              <MetricCard
                label={t('builder_analytics_total_sessions')}
                value={kpiExtras.totalSessions}
                description={t('builder_analytics_all_sessions')}
              />
              <MetricCard
                label={t('builder_analytics_engagement_rate')}
                value={kpiExtras.totalSessions > 0 ? `${Math.round(((kpiExtras.totalSessions - kpiExtras.bounceSessions) / kpiExtras.totalSessions) * 100)}%` : '0%'}
                description={t('builder_analytics_engaged_sessions', { engaged: kpiExtras.totalSessions - kpiExtras.bounceSessions, total: kpiExtras.totalSessions })}
              />
            </div>

            <SectionHeader title={t('builder_analytics_visitors_traffic')} badge={t('builder_analytics_badge_realtime')} />
            <div className="[&>*]:min-w-0">
              <div
                data-slot="chart"
                className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px"
              >
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setLiveDataTab('visitors')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      liveDataTab === 'visitors'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_new_vs_returning')}
                  </button>
                  <button
                    onClick={() => setLiveDataTab('browsers')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      liveDataTab === 'browsers'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_total_sessions')}
                  </button>
                  <button
                    onClick={() => setLiveDataTab('pageviews')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      liveDataTab === 'pageviews'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_page_views')}
                  </button>
                </div>
                {liveDataTab === 'pageviews' ? (
                  <AnalyticsChart data={chartData} label={t('builder_analytics_page_views')} embedded />
                ) : liveDataTab === 'visitors' ? (
                  <AnalyticsMultiAreaChart
                    data={newVsReturningData}
                    label={t('builder_analytics_new_vs_returning')}
                    series={[
                      { key: 'new_visitors', name: t('builder_analytics_new_visitors'), color: 'var(--color-ai)' },
                      { key: 'returning_visitors', name: t('builder_analytics_returning_visitors'), color: 'var(--color-ai-muted)', strokeDasharray: '5 5' }
                    ]}
                    embedded
                  />
                ) : (
                  <AnalyticsMultiAreaChart
                    data={browserSessionsData}
                    label={t('builder_analytics_total_sessions')}
                    series={[
                      { key: 'sessions', name: t('builder_analytics_sessions'), color: 'var(--color-ai)' },
                      { key: 'unique_visitors', name: t('builder_analytics_unique_visitors'), color: 'var(--color-ai-muted)', strokeDasharray: '5 5' }
                    ]}
                    embedded
                  />
                )}
              </div>
            </div>

            <SectionHeader title={t('builder_analytics_geographic')} badge={t('builder_analytics_badge_geo')} />
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
              <div className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm">
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setGeoTab('country')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      geoTab === 'country'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_visitors_by_country')}
                  </button>
                  <button
                    onClick={() => setGeoTab('city')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      geoTab === 'city'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_city_traffic')}
                  </button>
                </div>
                <AnalyticsDetailTable<CountryVisitorRow>
                  data={geoTab === 'country' ? countryVisitorTableData : cityVisitorTableData}
                  title={geoTab === 'country' ? t('builder_analytics_visitors_by_country') : t('builder_analytics_visitors_by_city')}
                  columns={[
                    { key: 'country', header: geoTab === 'country' ? t('builder_analytics_country') : t('builder_analytics_city'), render: (v) => (
                      <text.span className="!inline-block !px-2 !py-0.5 !rounded-md !text-[11px] !font-semibold" style={{ background: geoTab === 'country' ? 'color-mix(in srgb, var(--color-chart-blue) 8%, transparent)' : 'color-mix(in srgb, var(--color-chart-cyan) 8%, transparent)', color: geoTab === 'country' ? 'var(--color-chart-blue)' : 'var(--color-chart-cyan)' }}>{String(v)}</text.span>
                    )},
                    { key: 'visitors', header: t('builder_analytics_visitors'), align: 'right' },
                  ]}
                />
              </div>
              <AnalyticsHorizontalSingleBarChart
                data={(
                  geoTab === 'country'
                    ? countryTrafficData.map((d) => ({ date: d.date, value: d.value2 }))
                    : cityTrafficData.map((d) => ({ date: d.date, value: d.value2 }))
                ).sort((a, b) => b.value - a.value).slice(0, 10)}
                label={geoTab === 'country' ? t('builder_analytics_visitors_by_country') : t('builder_analytics_visitors_by_city')}
                color={geoTab === 'country' ? 'var(--color-chart-blue)' : 'var(--color-chart-cyan)'}
                labelWidth={80}
              />
            </div>

            <SectionHeader title={t('builder_analytics_devices_sources')} badge={t('builder_analytics_badge_audience')} />
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
              <AnalyticsPieChart data={sessionsByDeviceData} label={t('builder_analytics_sessions_by_device')} />
              <AnalyticsHorizontalBarChart data={topReferrersData} label={t('builder_analytics_top_referrers')} series1Name={t('builder_analytics_visits')} series2Name={t('builder_analytics_unique_visitors')} />
            </div>

            <SectionHeader title={t('builder_analytics_activity')} badge={t('builder_analytics_badge_page_analytics')} />
            <AnalyticsDetailTable<ActivityHitRow>
              data={enrichedActivityHits}
              title={t('builder_analytics_activity_last_20')}
              subtitle={t('builder_analytics_activity_subtitle')}
              maxHeight={350}
              columns={[
                { key: 'date', header: 'Date', render: (v) => <text.span className="!text-xs !font-medium">{String(v)}</text.span> },
                { key: 'pagePath', header: t('builder_analytics_page_path_name'), render: (_v, row) => (
                  <text.span className="!text-xs">
                    <PageBadge value={row.pagePath || '/'} />
                    {row.pageName ? <text.span emphasis="passive" className="!ml-1">({row.pageName})</text.span> : null}
                  </text.span>
                )},
                { key: 'device', header: t('builder_analytics_device'), render: (v) => <text.span className="!text-xs">{String(v)}</text.span> },
                { key: 'country', header: t('builder_analytics_country'), render: (v) => <text.span className="!text-xs">{String(v)}</text.span> },
                { key: 'browser', header: t('builder_analytics_browser'), render: (v) => <text.span className="!text-xs">{String(v)}</text.span> },
                { key: 'views', header: t('builder_analytics_page_views'), align: 'right' as const },
                { key: 'uniqueVisitors', header: t('builder_analytics_unique_visitors'), align: 'right' as const },
                { key: 'referrer', header: t('builder_analytics_referrer'), render: (v) => {
                  const r = String(v)
                  return <text.span className="!text-xs !truncate !max-w-[160px] !inline-block" title={r}>{r}</text.span>
                }},
              ]}
            />
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
              <AnalyticsHorizontalSingleBarChart data={pageViewsByPathData} label={t('builder_analytics_pageviews_by_path')} labelWidth={100} />
              <AnalyticsHorizontalSingleBarChart data={uniqueVisitorsByPageData} label={t('builder_analytics_unique_visitors_by_page')} color="var(--color-chart-blue)" labelWidth={100} />
            </div>

            <SectionHeader title={t('builder_analytics_engagement')} badge={t('builder_analytics_badge_clicks')} />
            <div className="[&>*]:min-w-0">
              <div
                data-slot="chart"
                className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px"
              >
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setVisitorInsightsTab('clicks')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      visitorInsightsTab === 'clicks'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_click_trends')}
                  </button>
                  <button
                    onClick={() => setVisitorInsightsTab('total-sessions')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      visitorInsightsTab === 'total-sessions'
                        ? 'bg-ai text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {t('builder_analytics_total_sessions')}
                  </button>
                </div>
                {visitorInsightsTab === 'clicks' ? (
                  <AnalyticsChart data={clickTrendsData} label={t('builder_analytics_click_trends')} embedded />
                ) : (
                  <AnalyticsMultiAreaChart
                    data={browserSessionsData}
                    label={t('builder_analytics_total_sessions')}
                    series={[
                      { key: 'sessions', name: t('builder_analytics_sessions'), color: 'var(--color-ai)' },
                      { key: 'unique_visitors', name: t('builder_analytics_unique_visitors'), color: 'var(--color-ai-muted)', strokeDasharray: '5 5' }
                    ]}
                    embedded
                  />
                )}
              </div>
            </div>

            <SectionHeader title={t('builder_analytics_content')} badge={t('builder_analytics_badge_top_pages')} />
            <AnalyticsDetailTable<TopPageRow>
              data={topPagesData}
              title={t('builder_analytics_top_pages')}
              subtitle={t('builder_analytics_top_pages_subtitle')}
              columns={[
                { key: 'pagePath', header: t('builder_analytics_page_path'), render: (v) => <PageBadge value={String(v)} /> },
                { key: 'pageName', header: t('builder_analytics_page_name'), render: (v) => <text.span className="!text-xs !font-medium">{String(v)}</text.span> },
                { key: 'visitors', header: t('builder_analytics_visitors'), align: 'right' },
                { key: 'totalViews', header: t('builder_analytics_total_views'), align: 'right' },
                { key: 'referralVisits', header: t('builder_analytics_referral_visits'), align: 'right' },
                { key: 'clicks', header: t('builder_analytics_clicks'), align: 'right' },
              ]}
            />

          </Box>
        </div>
      </TooltipProvider>
    </BigCard>
  )
}
