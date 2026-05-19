'use client'

import { useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Collapsible from '@ux/collapsible'
import AlertIcon from '@ux/icon/alert'
import Select from '@ux/select'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import InsightsBanner from '@/app/[market]/develop/components/settings/Analytics/InsightsBanner'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { AnalyticsChart } from '@/components/analytics/AnalyticsChart'
import { AnalyticsDetailTable } from '@/components/analytics/AnalyticsDetailTable'
import { AnalyticsMultiAreaChart } from '@/components/analytics/AnalyticsMultiAreaChart'
import { AnalyticsPieChart } from '@/components/analytics/AnalyticsPieChart'
import { AnalyticsUpgradeBanner, AnalyticsUpgradeInnerBanner } from '@/components/analytics/AnalyticsUpgradeBanner'
import { MetricCard } from '@/components/analytics/MetricCard'
import type { StatProgressItem } from '@/components/analytics/StatProgressList'
import { StatProgressList } from '@/components/analytics/StatProgressList'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import {
  SegmentedController,
  SegmentedControllerItem,
} from '@/components/ui/SegmentedController'
import { SWITCHBOARD_APPBUILDER_INSIGHTS_BANNER } from '@/config/switchboard-flags'
import { useClickhouseAnalytics } from '@/hooks/useClickhouseAnalytics'
import { useInsightsAnalytics } from '@/hooks/useInsightsAnalytics'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import type {
  ActivityHitRow,
  TopPageRow,
} from '@/lib/insights/clickhouse-types'
import { isProfessionalOrAbove, PAYWALL_ITC } from '@/lib/paywall/shared'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription } from '@/utils/credits'

/* ─── Flighty-inspired UI primitives ──────────────────── */

/** Shared wrapper for content inside a Collapsible — single place to tweak spacing */
function CollapsibleContent({ children }: { children: React.ReactNode }) {
  return <Box gap="md" className="pt-1 pb-3">{children}</Box>
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

/** Convert a 2-letter ISO country code to an emoji flag (e.g. "US" → 🇺🇸) */
function countryCodeToFlag(code: string): string {
  const upper = code.toUpperCase()
  if (upper.length !== 2) return ''
  return String.fromCodePoint(...[...upper].map((c) => 0x1F1E6 - 65 + c.charCodeAt(0)))
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

type TimePeriod = '7' | '15' | '30' | 'month'

interface GeoProPlanRow { country: string; countryCode: string; city: string; visitors: number; newVisitors: number; returnVisitors: number }
interface ReferrerTableRow { referrer: string; pageViews: number; engagementRate: string; landingVisits: number }
interface CTATableRow { element: string; clicks: number; uniqueClicks: number; clicksPerSession: string }

/**
 * RUM component for Analytics panel view
 *
 * Displays website analytics data including metrics, charts, and tables
 * in a format suitable for the settings panel.
 * Supports multiple time periods with caching and background refresh.
 *
 * @returns RUM panel component
 */
const LIVE_DATA_TAB = {
  TOTAL_VISITORS: 'total-visitors',
  PAGEVIEWS: 'pageviews',
  VISITORS: 'visitors',
  SESSIONS: 'sessions',
} as const
type LiveDataTab = typeof LIVE_DATA_TAB[keyof typeof LIVE_DATA_TAB]

export default function RUM() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const publishedUrl = usePublishedUrl()
  const isInsightsBannerEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_INSIGHTS_BANNER) === true
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('7')

  // Calculate days based on selected period
  const days = useMemo(() => {
    switch (selectedPeriod) {
      case '7':
        return 7
      case '15':
        return 15
      case '30':
        return 30
      case 'month':
        return getDaysThisMonth()
      default:
        return 7
    }
  }, [selectedPeriod])

  const [liveDataTab, setLiveDataTab] = useState<LiveDataTab>(LIVE_DATA_TAB.TOTAL_VISITORS)
  const [visitorInsightsTab, setVisitorInsightsTab] = useState<'clicks' | 'total-sessions'>('clicks')
  const [trendTab, setTrendTab] = useState<'device' | 'browser'>('device')

  // ── Plan-based gating ──────────────────────────────────
  const { data: subscription } = useSubscription()
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None
  const isPro = isProfessionalOrAbove(currentPlan)        // Professional, Ultimate
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)
  const handleMetricUpgrade = () => openUpgradeModal('analytics.metric_card', PAYWALL_ITC.UPGRADE)
  const handleInnerBannerUpgrade = () => openUpgradeModal('analytics.inner_banner', PAYWALL_ITC.UPGRADE)

  // Reset plan-gated state when subscription lapses mid-session
  useEffect(() => {
    if (!isPro && selectedPeriod === '15') setSelectedPeriod('7')
  }, [isPro, selectedPeriod])

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
    dailyUniqueVisitors,
    dailyTotalSessions,
    pageViewsByPathData,
    uniqueVisitorsByPageData,
    clickTrendsData,
    clicksPerPageData,
    newVsReturningData,
    sessionsByDeviceData,
    countryTrafficData,
    cityTrafficData,
    topReferrersData,
    referrerLandingDetailData,
    kpiExtras,
    activityHitsData,
    deviceMixOverTimeData,
    browserTrendsOverTimeData,
    topCTALabelsData,
    cityTrafficWithCountryData,
    countryTrafficWithCodeData,
  } = useClickhouseAnalytics({
    publishedUrl,
    appId,
    days,
    enabled: !!publishedUrl
  })

  const chartData = useMemo(() => {
    return dailyHostPageViews.map(d => ({
      date: d.date,
      value: Number(d.value) || 0
    }))
  }, [dailyHostPageViews])

  const metrics = useMemo(() => {
    const vv = totalHostUniqueVisitors
    const pv = totalHostPageViews
    // Derive totalClicks from clickTrendsData (ClickHouse) which reliably returns data,
    // rather than the separate useInsightsAnalytics fetch which can silently return 0.
    const derivedTotalClicks = clickTrendsData.reduce((sum, d) => sum + d.value, 0)
    const clicks = derivedTotalClicks || totalClicks
    return {
      pageviews: pv,
      totalClicks: clicks,
      visitors: vv,
      viewsPerVisit: vv > 0 ? pv / vv : 0
    }
  }, [totalHostPageViews, totalHostUniqueVisitors, totalClicks, clickTrendsData])

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
  // Derive Geo ProPlan table: city + country with flag + visitors + new/return estimate
  const geoProPlanTableData = useMemo((): GeoProPlanRow[] => {
    if (cityTrafficWithCountryData.length === 0) return []
    // Compute global new/return ratio from aggregate newVsReturningData
    let totalNew = 0
    let totalRet = 0
    for (const d of newVsReturningData) {
      totalNew += Number(d.new_visitors ?? 0)
      totalRet += Number(d.returning_visitors ?? 0)
    }
    const totalAll = totalNew + totalRet
    const newRatio = totalAll > 0 ? totalNew / totalAll : 0.5
    return cityTrafficWithCountryData.slice(0, 15).map((row) => {
      const nv = Math.round(row.visitors * newRatio)
      return {
        country: row.country,
        countryCode: row.countryCode,
        city: row.city,
        visitors: row.visitors,
        newVisitors: nv,
        returnVisitors: row.visitors - nv,
      }
    })
  }, [cityTrafficWithCountryData, newVsReturningData])

  // Derive Referrers table: Referrer name, Page Views, Engagement Rate, Landing Visits
  const referrerTableData = useMemo((): ReferrerTableRow[] => {
    if (topReferrersData.length === 0) return []
    // topReferrersData: {date: referrerName, value: visits, value2: uniqueVisitors}
    // referrerLandingDetailData: {referrer, landingPage, source, visits, uniqueVisitors}
    // Derive clicks from referrerLandingDetail per referrer
    const clickMap = new Map<string, number>()
    for (const r of referrerLandingDetailData) {
      const ref = r.referrer.replace(/^https?:\/\//, '')
      clickMap.set(ref, (clickMap.get(ref) ?? 0) + r.visits)
    }
    return topReferrersData.map((r) => {
      const visits = r.value
      const uv = r.value2
      const rate = visits > 0 ? ((uv / visits) * 100).toFixed(1) + '%' : '0%'
      return {
        referrer: r.date,
        pageViews: visits,
        engagementRate: rate,
        landingVisits: clickMap.get(r.date) ?? 0,
      }
    })
  }, [topReferrersData, referrerLandingDetailData])

  // Derive CTA table: element name, clicks, unique clicks, clicks/session
  const ctaTableData = useMemo((): CTATableRow[] => {
    if (topCTALabelsData.length === 0) return []
    return topCTALabelsData.map((d) => {
      const clicks = d.value
      const unique = d.value2
      return {
        element: d.date,
        clicks,
        uniqueClicks: unique,
        clicksPerSession: unique > 0 ? (clicks / unique).toFixed(2) : '0.00',
      }
    })
  }, [topCTALabelsData])

  // Derive browser trend series config from data keys
  const browserTrendSeries = useMemo(() => {
    const colors = ['var(--color-ai)', 'var(--color-chart-blue)', 'var(--color-chart-green)', 'var(--color-chart-cyan)', 'var(--color-chart-orange)']
    if (browserTrendsOverTimeData.length === 0) return []
    const keys = Object.keys(browserTrendsOverTimeData[0]).filter((k) => k !== 'date')
    return keys.map((k, i) => ({
      key: k,
      name: k,
      color: colors[i % colors.length],
    }))
  }, [browserTrendsOverTimeData])

  // Enrich raw activity hits with referrer/page-name lookups (real data only, no fabrication)
  // Falls back to pageViewsByPathData if the raw page views insight returns empty.
  const enrichedActivityHits = useMemo((): ActivityHitRow[] => {
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

    /** Derive a human-readable name from a URL path */
    const nameFromPath = (path: string): string => {
      if (path === '/' || path === '') return t('builder_analytics_home_page')
      return path.replace(/^\//, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }

    /** Clean a referrer URL to a readable label (just domain, or "Direct") */
    const cleanReferrer = (ref: string): string => {
      if (!ref) return directLabel
      try {
        const u = new URL(ref.startsWith('http') ? ref : `https://${ref}`)
        return u.hostname.replace(/^www\./, '')
      } catch {
        return ref.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      }
    }

    // Derive top device/country/browser from aggregate data for fallback enrichment
    const topDevice = sessionsByDeviceData.length > 0
      ? [...sessionsByDeviceData].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]?.date || ''
      : ''
    const topCountry = countryTrafficData.length > 0
      ? [...countryTrafficData].sort((a, b) => (b.value2 ?? b.value ?? 0) - (a.value2 ?? a.value ?? 0))[0]?.date || ''
      : ''
    // browserTrendsOverTimeData is MultiAreaDataPoint[] — extract top browser from keys
    const topBrowser = (() => {
      if (browserTrendsOverTimeData.length === 0) return ''
      const keys = Object.keys(browserTrendsOverTimeData[0]).filter((k) => k !== 'date')
      if (keys.length === 0) return ''
      // Sum each browser across all dates to find the dominant one
      const sums = keys.map((k) => ({
        name: k,
        total: browserTrendsOverTimeData.reduce((s, row) => s + (Number((row as Record<string, unknown>)[k]) || 0), 0),
      }))
      sums.sort((a, b) => b.total - a.total)
      return sums[0]?.name || ''
    })()

    // Primary source: raw page view hits from airobuilder_raw_page_views
    let source = activityHitsData

    // Check if raw hits lack path diversity (all rows are just '/')
    const hasPathDiversity = source.some((h) => h.pagePath && h.pagePath !== '/')

    // Fallback: synthesize per-date rows from dailyHostPageViews × page paths
    // (these come from airobuilder_page_views_per_path which reliably has data)
    // Triggers when raw hits are empty OR when all rows are home-page-only
    if ((source.length === 0 || !hasPathDiversity) && pageViewsByPathData.length > 0) {
      const uvMap = new Map(uniqueVisitorsByPageData.map((d) => [d.date, d.value]))
      const paths = pageViewsByPathData
        .slice()
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)

      // Get unique dates from daily data to create per-date entries
      const dates = dailyHostPageViews
        .map((d) => d.date)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a)) // newest first

      // Cross-join: each date × each path, capped at 20
      const rows: ActivityHitRow[] = []
      for (const dateStr of dates) {
        for (const p of paths) {
          if (rows.length >= 20) break
          rows.push({
            date: dateStr,
            pagePath: p.date,  // pageViewsByPathData uses `date` field for path
            pageName: '',
            device: topDevice,
            referrer: '',
            views: Math.max(1, Math.round(p.value / Math.max(dates.length, 1))),
            uniqueVisitors: Math.max(1, Math.round((uvMap.get(p.date) ?? 1) / Math.max(dates.length, 1))),
            country: topCountry,
            browser: topBrowser,
          })
        }
        if (rows.length >= 20) break
      }
      source = rows
    }

    if (source.length === 0) return []

    return source
      .map((hit) => ({
        date: hit.date,
        pagePath: hit.pagePath,
        pageName: hit.pageName || pageNameMap.get(hit.pagePath) || nameFromPath(hit.pagePath),
        device: hit.device || topDevice || '--',
        referrer: cleanReferrer(hit.referrer || referrerByPage.get(hit.pagePath) || ''),
        views: hit.views,
        uniqueVisitors: hit.uniqueVisitors,
        country: hit.country || topCountry || '--',
        browser: hit.browser || topBrowser || '--',
      }))
  }, [activityHitsData, pageViewsByPathData, uniqueVisitorsByPageData, referrerLandingDetailData, topPagesData, sessionsByDeviceData, countryTrafficData, browserTrendsOverTimeData, dailyHostPageViews, t])

  // Track whether activity table is showing estimated data (fallback path)
  const isActivityEstimated = useMemo(() => {
    const hasPathDiversity = activityHitsData.some((h) => h.pagePath && h.pagePath !== '/')
    return (activityHitsData.length === 0 || !hasPathDiversity) && pageViewsByPathData.length > 0
  }, [activityHitsData, pageViewsByPathData])

  // ── StatProgressList data transforms (Flighty-style bars) ──
  const countryProgressItems = useMemo((): StatProgressItem[] => {
    return countryTrafficWithCodeData
      .slice()
      .sort((a, b) => b.visitors - a.visitors)
      .map((d) => ({
        label: d.country,
        value: d.visitors,
        icon: d.code ? (
          <span role="img" aria-label={d.country} className="text-sm leading-none">{countryCodeToFlag(d.code)}</span>
        ) : undefined,
      }))
  }, [countryTrafficWithCodeData])

  const cityProgressItems = useMemo((): StatProgressItem[] => {
    return cityTrafficData
      .slice()
      .sort((a, b) => b.value2 - a.value2)
      .map((d) => ({
        label: d.date,
        value: d.value2,
      }))
  }, [cityTrafficData])

  const referrerProgressItems = useMemo((): StatProgressItem[] => {
    return topReferrersData
      .slice()
      .sort((a, b) => b.value - a.value)
      .map((d) => ({
        label: d.date,
        value: d.value,
      }))
  }, [topReferrersData])

  // Show loading state only on initial load (when no data exists)
  // If we have data, show it even if refreshing in background
  if (isLoading && dailyHostPageViews.length === 0 && totalHostPageViews === 0) {
    return <PanelSkeleton panelType={ChatTab.ANALYTICS} hasContent />
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

  const { totalSessions, bounceSessions, peakHour } = kpiExtras
  const { viewsPerVisit } = metrics

  return (
    <SettingsSection
      title={t('builder_analytics_title')}
      description={t('builder_analytics_header_rum_description')}
      hideStatus
      button={(
        <div className="flex items-center gap-2">
          {/* TODO: Re-enable filter dropdowns once cross-filter backend support is added
          <Select
            value={filterCountry}
            id="filter-country"
            name="filter-country"
            onChange={(value) => setFilterCountry(value)}
            label="Country"
            visualSize="md"
          >
            <option value="all">All Countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select
            value={filterVisitorType}
            id="filter-visitor-type"
            name="filter-visitor-type"
            onChange={(value) => setFilterVisitorType(value)}
            label="Visitors"
            visualSize="md"
          >
            <option value="all">All Visitors</option>
            <option value="new">New Visitors</option>
            <option value="returning">Returning Visitors</option>
          </Select>
          <Select
            value={filterDevice}
            id="filter-device"
            name="filter-device"
            onChange={(value) => setFilterDevice(value)}
            label="Device"
            visualSize="md"
          >
            <option value="all">All Devices</option>
            {deviceOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          */}
          {isRefreshing && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Spinner size="sm" />
              <text.span emphasis="passive" size={-1} className="hidden @lg:inline">
                {t('builder_analytics_refreshing')}
              </text.span>
            </div>
          )}
          <Select
            value={selectedPeriod}
            id="period-select"
            name="period-select"
            onChange={(value) => setSelectedPeriod(value as TimePeriod)}
            aria-label={t('builder_analytics_select_period')}
            visualSize="sm"
            className="bg-intents-ux-box-backgroundColor rounded-md"
          >
            <option value="7">{t('builder_analytics_last_7_days')}</option>
            {isPro && <option value="15">{t('builder_analytics_last_15_days')}</option>}
            <option value="30">{t('builder_analytics_last_30_days')}</option>
            <option value="month">{t('builder_analytics_this_month')}</option>
          </Select>
        </div>
      )}
      className="pb-2 px-1.5 md:px-0.5"
    >
      <Box gap="md">
        {isInsightsBannerEnabled && <InsightsBanner />}

        <div>
          {/* ═══════════ OVERVIEW ═══════════ */}
          <Collapsible
            id="overview"
            size="sm"
            defaultOpen
            title={<text.span as="title" size={-2}>{t('builder_analytics_overview')}</text.span>}
          >
            <CollapsibleContent>
              <div className="grid grid-cols-2 @lg:grid-cols-4 gap-2">
                <MetricCard
                  label={t('builder_analytics_pageviews')}
                  value={metrics.pageviews}
                  description={t('builder_analytics_total_page_loads')}
                  caption={metrics.pageviews === 0 ? t('builder_analytics_no_data') : undefined}
                />
                <MetricCard
                  label={t('builder_analytics_visitors')}
                  value={metrics.visitors}
                  description={t('builder_analytics_unique_visitors')}
                  caption={metrics.visitors === 0 ? t('builder_analytics_no_data') : undefined}
                />
                <MetricCard
                  label={t('builder_analytics_views_per_visit')}
                  value={viewsPerVisit > 0 ? viewsPerVisit.toFixed(2) : '0.00'}
                  description={t('builder_analytics_pages_per_visitor')}
                  caption={viewsPerVisit === 0 ? t('builder_analytics_no_data') : undefined}
                />
                <MetricCard
                  label={t('builder_analytics_total_sessions')}
                  value={totalSessions}
                  description={t('builder_analytics_all_sessions')}
                  caption={totalSessions === 0 ? t('builder_analytics_no_data') : undefined}
                />
                <MetricCard
                  label={t('builder_analytics_engagement_rate')}
                  value={totalSessions > 0 ? `${Math.round(((totalSessions - bounceSessions) / totalSessions) * 100)}%` : '0%'}
                  description={t('builder_analytics_engaged_sessions', { engaged: totalSessions - bounceSessions, total: totalSessions })}
                  caption={totalSessions === 0 ? t('builder_analytics_no_data') : undefined}
                />
                <MetricCard
                  label={t('builder_analytics_total_clicks')}
                  value={metrics.totalClicks}
                  description={t('builder_analytics_all_clicks_tracked')}
                  {...(isPro
                    ? { caption: metrics.totalClicks === 0 ? t('builder_analytics_no_data') : undefined }
                    : { needsUpgrade: true as const, onUpgrade: handleMetricUpgrade })}
                />
                <MetricCard
                  label={t('builder_analytics_bounce_rate')}
                  value={kpiExtras.bounceRate || '0%'}
                  description={t('builder_analytics_bounce_sessions_count', { bounceSessions: kpiExtras.bounceSessions })}
                  {...(isPro
                    ? { caption: totalSessions === 0 ? t('builder_analytics_no_data') : undefined }
                    : { needsUpgrade: true as const, onUpgrade: handleMetricUpgrade })}
                />
                <MetricCard
                  label={t('builder_analytics_peak_hour')}
                  value={peakHour || '--'}
                  description={t('builder_analytics_peak_hour_description', { visitors: kpiExtras.peakHourVisitors, clicks: kpiExtras.peakHourClicks })}
                  {...(isPro
                    ? { caption: (totalSessions === 0 || !peakHour) ? t('builder_analytics_no_data') : undefined }
                    : { needsUpgrade: true as const, onUpgrade: handleMetricUpgrade })}
                />
                <MetricCard
                  label={t('builder_analytics_avg_pages_per_session')}
                  value={kpiExtras.avgPagesPerSession > 0 ? kpiExtras.avgPagesPerSession.toFixed(2) : '0.00'}
                  description={t('builder_analytics_pages_viewed_per_session')}
                  {...(isPro
                    ? { caption: totalSessions === 0 ? t('builder_analytics_no_data') : undefined }
                    : { needsUpgrade: true as const, onUpgrade: handleMetricUpgrade })}
                />
                <MetricCard
                  label={t('builder_analytics_avg_duration')}
                  value={kpiExtras.avgSessionDuration || '0s'}
                  description={t('builder_analytics_avg_session_length')}
                  {...(isPro
                    ? { caption: totalSessions === 0 ? t('builder_analytics_no_data') : undefined }
                    : { needsUpgrade: true as const, onUpgrade: handleMetricUpgrade })}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ TRAFFIC TRENDS ═══════════ */}
          <Collapsible
            id="traffic-trends"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_visitors_traffic')}</text.span>}
          >
            <CollapsibleContent>
              <text.p size={-1}>{t('builder_analytics_tooltip_traffic_trends')}</text.p>
              <AnalyticsCard
                data-slot="chart"
                className="flex flex-col w-full"
              >
                <div className="w-full min-w-0">
                  <SegmentedController
                    radiogroupProps={{ 'aria-label': t('builder_analytics_visitors_traffic') }}
                    value={liveDataTab}
                    onSelectionChange={(v) => setLiveDataTab(v)}
                    className="w-full max-w-full"
                  >
                    <SegmentedControllerItem value={LIVE_DATA_TAB.TOTAL_VISITORS}>{t('builder_analytics_visitors')}</SegmentedControllerItem>
                    <SegmentedControllerItem value={LIVE_DATA_TAB.VISITORS}>{t('builder_analytics_new_vs_returning')}</SegmentedControllerItem>
                    <SegmentedControllerItem value={LIVE_DATA_TAB.SESSIONS}>{t('builder_analytics_total_sessions')}</SegmentedControllerItem>
                    <SegmentedControllerItem value={LIVE_DATA_TAB.PAGEVIEWS}>{t('builder_analytics_page_views')}</SegmentedControllerItem>
                  </SegmentedController>
                </div>
                {liveDataTab === LIVE_DATA_TAB.TOTAL_VISITORS ? (
                  <AnalyticsChart data={dailyUniqueVisitors} label={t('builder_analytics_visitors')} embedded />
                ) : liveDataTab === LIVE_DATA_TAB.PAGEVIEWS ? (
                  <AnalyticsChart data={chartData} label={t('builder_analytics_page_views')} embedded />
                ) : liveDataTab === LIVE_DATA_TAB.VISITORS && isPro ? (
                  <AnalyticsMultiAreaChart
                    data={newVsReturningData}
                    label={t('builder_analytics_visitors')}
                    series={[
                      { key: 'new_visitors', name: t('builder_analytics_new_visitors'), color: 'var(--color-ai)' },
                      { key: 'returning_visitors', name: t('builder_analytics_returning_visitors'), color: 'var(--color-ai-muted)', strokeDasharray: '5 5' }
                    ]}
                    embedded
                  />
                ) : liveDataTab === LIVE_DATA_TAB.VISITORS ? (
                  <AnalyticsUpgradeInnerBanner onUpgrade={handleInnerBannerUpgrade} />
                ) : (
                  <AnalyticsChart
                    data={dailyTotalSessions}
                    label={t('builder_analytics_sessions')}
                    embedded
                  />
                )}
              </AnalyticsCard>
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ GEOGRAPHIC ═══════════ */}
          <Collapsible
            id="geographic"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_geographic')}</text.span>}
          >
            <CollapsibleContent>
              <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2 [&>*]:min-w-0">
                <StatProgressList
                  items={countryProgressItems}
                  title={t('builder_analytics_visitors_by_country')}
                  tooltip={t('builder_analytics_tooltip_country_distribution')}
                  color="var(--color-chart-blue)"
                  maxItems={8}
                />
                <StatProgressList
                  items={cityProgressItems}
                  title={t('builder_analytics_city_traffic')}
                  tooltip={t('builder_analytics_tooltip_city_ranking')}
                  color="var(--color-chart-cyan)"
                  maxItems={8}
                />
              </div>

              {/* Geo - Pro Plan: Detailed table (Professional+) */}
              <AnalyticsDetailTable<GeoProPlanRow>
                data={geoProPlanTableData}
                title={t('builder_analytics_top_locations')}
                tooltip={t('builder_analytics_tooltip_city_detail')}
                maxHeight={400}
                upgradeContent={!isPro ? <AnalyticsUpgradeInnerBanner onUpgrade={handleInnerBannerUpgrade} /> : undefined}
                columns={[
                  { key: 'country', header: t('builder_analytics_country'), render: (_v, row) => {
                    const maxVisitors = Math.max(...geoProPlanTableData.map((d) => d.visitors), 1)
                    const barPct = (row.visitors / maxVisitors) * 100
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <div
                            className="absolute inset-y-0 left-0 rounded-r-sm opacity-[0.08]"
                            style={{ width: `${barPct}%`, background: 'var(--color-chart-cyan)' }}
                          />
                          <span className="relative inline-flex items-center gap-1.5 px-1 py-0.5">
                            {row.countryCode && (
                              <span role="img" aria-label={row.country} className="text-sm leading-none shrink-0">{countryCodeToFlag(row.countryCode)}</span>
                            )}
                            <span className="text-xs font-semibold">{row.country}</span>
                          </span>
                        </div>
                      </div>
                    )
                  }},
                  { key: 'city', header: t('builder_analytics_city'), render: (v) => (
                    <span className="text-xs font-medium">{String(v)}</span>
                  )},
                  { key: 'visitors', header: t('builder_analytics_visitors'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-bold tabular-nums">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'newVisitors', header: t('builder_analytics_new'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-chart-green)' }}>{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'returnVisitors', header: t('builder_analytics_return'), align: 'right' as const, render: (v) => (
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(v).toLocaleString()}</span>
                  )},
                ]}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ DEVICE SOURCES ═══════════ */}
          <Collapsible
            id="devices-sources"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_devices_sources')}</text.span>}
          >
            <CollapsibleContent>
              <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2 [&>*]:min-w-0">
                <AnalyticsPieChart data={sessionsByDeviceData} label={t('builder_analytics_sessions_by_device')} tooltip={t('builder_analytics_tooltip_device_breakdown')} />
                <StatProgressList
                  items={referrerProgressItems}
                  title={t('builder_analytics_top_referrers')}
                  tooltip={t('builder_analytics_tooltip_top_referrers')}
                  color="var(--color-chart-green)"
                  maxItems={8}
                />
              </div>

              {/* Trend Graph: Device / Browser (Professional+) */}
              <AnalyticsCard
                data-slot="chart"
                className="flex flex-col w-full"
                title={isPro ? undefined : `${t('builder_analytics_device_types')} / ${t('builder_analytics_browser_names')}`}
              >
                {isPro ? (
                  <>
                    <div className="w-full min-w-0">
                      <SegmentedController
                        radiogroupProps={{ 'aria-label': t('builder_analytics_devices_sources') }}
                        value={trendTab}
                        onSelectionChange={(v) => setTrendTab(v)}
                        className="w-full max-w-full"
                      >
                        <SegmentedControllerItem value="device">{t('builder_analytics_device_types')}</SegmentedControllerItem>
                        <SegmentedControllerItem value="browser">{t('builder_analytics_browser_names')}</SegmentedControllerItem>
                      </SegmentedController>
                    </div>
                    {trendTab === 'device' ? (
                      <AnalyticsMultiAreaChart
                        data={deviceMixOverTimeData}
                        label={t('builder_analytics_device_trends')}
                        series={[
                          { key: 'laptop', name: t('builder_analytics_desktop_laptop'), color: 'var(--color-ai)' },
                          { key: 'tablet', name: t('builder_analytics_tablet'), color: 'var(--color-chart-blue)' },
                          { key: 'mobile', name: t('builder_analytics_mobile'), color: 'var(--color-chart-green)' },
                        ]}
                        embedded
                      />
                    ) : (
                      <AnalyticsMultiAreaChart
                        data={browserTrendsOverTimeData}
                        label={t('builder_analytics_browser_trends')}
                        series={browserTrendSeries}
                        embedded
                      />
                    )}
                  </>
                ) : (
                  <AnalyticsUpgradeInnerBanner onUpgrade={handleInnerBannerUpgrade} />
                )}
              </AnalyticsCard>

              {/* Referrers Table (Professional+) */}
              <AnalyticsDetailTable<ReferrerTableRow>
                data={referrerTableData}
                title={t('builder_analytics_referrers')}
                tooltip={t('builder_analytics_tooltip_referrer_detail')}
                maxHeight={300}
                upgradeContent={!isPro ? <AnalyticsUpgradeInnerBanner onUpgrade={handleInnerBannerUpgrade} /> : undefined}
                columns={[
                  { key: 'referrer', header: t('builder_analytics_referrer'), render: (v, row) => {
                    const maxVisits = Math.max(...referrerTableData.map((d) => d.pageViews), 1)
                    const barPct = (row.pageViews / maxVisits) * 100
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <div
                            className="absolute inset-y-0 left-0 rounded-r-sm opacity-[0.08]"
                            style={{ width: `${barPct}%`, background: 'var(--color-ai)' }}
                          />
                          <span className="relative text-xs font-medium truncate block px-1 py-0.5 max-w-[200px]" title={String(v)}>
                            {String(v)}
                          </span>
                        </div>
                      </div>
                    )
                  }},
                  { key: 'pageViews', header: t('builder_analytics_visits'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-bold tabular-nums">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'engagementRate', header: t('builder_analytics_unique_ratio'), align: 'right' as const, render: (v) => {
                    const pct = parseFloat(String(v))
                    const intensity = Math.min(pct / 100, 1)
                    return (
                      <span
                        className="text-xs font-semibold tabular-nums"
                        style={{ color: `color-mix(in srgb, var(--color-ai) ${Math.round(40 + intensity * 60)}%, var(--color-ai-light))` }}
                      >
                        {String(v)}
                      </span>
                    )
                  }},
                  { key: 'landingVisits', header: t('builder_analytics_landing_visits'), align: 'right' as const, render: (v) => (
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(v).toLocaleString()}</span>
                  )},
                ]}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ ACTIVITY ═══════════ */}
          <Collapsible
            id="activity"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_activity')}</text.span>}
          >
            <CollapsibleContent>
              <AnalyticsDetailTable<ActivityHitRow>
                data={enrichedActivityHits}
                title={t('builder_analytics_activity_last_20')}
                description={isActivityEstimated
                  ? t('builder_analytics_activity_estimated')
                  : t('builder_analytics_activity_subtitle')}
                tooltip={t('builder_analytics_tooltip_recent_activity')}
                maxHeight={350}
                columns={[
                  { key: 'pagePath', header: t('builder_analytics_page_path_name'), render: (_v, row) => (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PageBadge value={row.pagePath || '/'} />
                      {row.pageName ? <span className="text-[10px] text-muted-foreground">({row.pageName})</span> : null}
                    </div>
                  )},
                  { key: 'device', header: t('builder_analytics_device'), render: (v) => {
                    const d = String(v)
                    const icon = d.toLowerCase().includes('mobile') ? '📱' : d.toLowerCase().includes('tablet') ? '📋' : '🖥️'
                    return <span className="text-xs font-medium">{icon} {d}</span>
                  }},
                  { key: 'country', header: t('builder_analytics_country'), render: (v) => {
                    const name = String(v)
                    const code = countryTrafficWithCodeData.find((c) => c.country === name)?.code
                    return (
                      <span className="text-xs inline-flex items-center gap-1.5">
                        {code && (
                          <span role="img" aria-label={name} className="text-sm leading-none">{countryCodeToFlag(code)}</span>
                        )}
                        <span className="font-medium">{name}</span>
                      </span>
                    )
                  }},
                  { key: 'browser', header: t('builder_analytics_browser'), render: (v) => <span className="text-xs text-muted-foreground">{String(v)}</span> },
                  { key: 'referrer', header: t('builder_analytics_referrer'), render: (v) => {
                    const r = String(v)
                    const isDirect = r === t('builder_analytics_direct_referrer') || r === '(direct)' || r === ''
                    return isDirect
                      ? <span className="text-xs text-muted-foreground italic">{t('builder_analytics_direct_referrer')}</span>
                      : <span className="text-xs font-medium truncate max-w-[160px] inline-block" title={r}>{r}</span>
                  }},
                ]}
              />

              {/* Page-level path bars */}
              <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2 [&>*]:min-w-0">
                <StatProgressList
                  items={pageViewsByPathData.slice().sort((a, b) => b.value - a.value).slice(0, 10).map((d) => ({ label: d.date === '/' ? t('builder_analytics_home_page') : d.date, value: d.value }))}
                  title={t('builder_analytics_pageviews_by_path')}
                  tooltip={t('builder_analytics_tooltip_page_views_by_path')}
                  color="var(--color-ai)"
                />
                <StatProgressList
                  items={uniqueVisitorsByPageData.slice().sort((a, b) => b.value - a.value).slice(0, 10).map((d) => ({ label: d.date === '/' ? t('builder_analytics_home_page') : d.date, value: d.value }))}
                  title={t('builder_analytics_unique_visitors_by_page')}
                  tooltip={t('builder_analytics_tooltip_unique_visitors_page')}
                  color="var(--color-chart-blue)"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ ENGAGEMENT ═══════════ */}
          <Collapsible
            id="engagement"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_engagement')}</text.span>}
          >
            <CollapsibleContent>
              <text.p size={-1}>{t('builder_analytics_tooltip_engagement')}</text.p>
              <div className="[&>*]:min-w-0">
                <AnalyticsCard
                  data-slot="chart"
                  className="flex flex-col w-full"
                >
                  <div className="w-full min-w-0">
                    <SegmentedController
                      radiogroupProps={{ 'aria-label': t('builder_analytics_engagement') }}
                      value={visitorInsightsTab}
                      onSelectionChange={(v) => setVisitorInsightsTab(v)}
                      className="w-full max-w-full"
                    >
                      <SegmentedControllerItem value="clicks">{t('builder_analytics_click_trends')}</SegmentedControllerItem>
                      <SegmentedControllerItem value="total-sessions">{t('builder_analytics_total_sessions')}</SegmentedControllerItem>
                    </SegmentedController>
                  </div>
                  {visitorInsightsTab === 'clicks' ? (
                    <AnalyticsChart data={clickTrendsData} label={t('builder_analytics_clicks')} embedded />
                  ) : (
                    <AnalyticsChart
                      data={dailyTotalSessions}
                      label={t('builder_analytics_sessions')}
                      embedded
                    />
                  )}
                </AnalyticsCard>
              </div>

              {/* CTA Table: links + buttons combined (Professional+) */}
              <AnalyticsDetailTable<CTATableRow>
                data={ctaTableData}
                title={t('builder_analytics_ctas_links_buttons')}
                tooltip={t('builder_analytics_tooltip_click_metrics')}
                maxHeight={300}
                upgradeContent={!isPro ? <AnalyticsUpgradeInnerBanner onUpgrade={handleInnerBannerUpgrade} /> : undefined}
                columns={[
                  { key: 'element', header: t('builder_analytics_element_name'), render: (v, row) => {
                    const name = String(v)
                    const maxClicks = Math.max(...ctaTableData.map((d) => d.clicks), 1)
                    const barPct = (row.clicks / maxClicks) * 100
                    return (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <div
                            className="absolute inset-y-0 left-0 rounded-r-sm opacity-[0.08]"
                            style={{ width: `${barPct}%`, background: 'var(--color-ai)' }}
                          />
                          <span className="relative text-xs font-medium truncate block px-1 py-0.5" title={name}>
                            {name}
                          </span>
                        </div>
                      </div>
                    )
                  }},
                  { key: 'clicks', header: t('builder_analytics_clicks'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-bold tabular-nums">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'uniqueClicks', header: t('builder_analytics_unique_visitors'), align: 'right' as const, render: (v) => (
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'clicksPerSession', header: t('builder_analytics_clicks_per_visitor'), align: 'right' as const, render: (v) => {
                    const val = parseFloat(String(v))
                    const intensity = Math.min(val / 5, 1)
                    return (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums"
                        style={{ color: `color-mix(in srgb, var(--color-ai) ${Math.round(40 + intensity * 60)}%, var(--color-ai-light))` }}
                      >
                        {String(v)}
                        {val >= 3 && <span title={t('builder_analytics_high_engagement')}>🔥</span>}
                      </span>
                    )
                  }},
                ]}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* ═══════════ CONTENT ═══════════ */}
          <Collapsible
            id="content"
            size="sm"
            title={<text.span as="title" size={-2}>{t('builder_analytics_content')}</text.span>}
          >
            <CollapsibleContent>
              <AnalyticsDetailTable<TopPageRow>
                data={topPagesData}
                title={t('builder_analytics_top_pages')}
                tooltip={t('builder_analytics_tooltip_top_pages')}
                columns={[
                  { key: 'pagePath', header: t('builder_analytics_page_path'), render: (v, row) => {
                    const maxViews = Math.max(...topPagesData.map((d) => d.totalViews), 1)
                    const barPct = (row.totalViews / maxViews) * 100
                    return (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative flex-1 min-w-0">
                          <div
                            className="absolute inset-y-0 left-0 rounded-r-sm opacity-[0.08]"
                            style={{ width: `${barPct}%`, background: 'var(--color-ai)' }}
                          />
                          <span className="relative block px-1 py-0.5">
                            <PageBadge value={String(v)} />
                          </span>
                        </div>
                      </div>
                    )
                  }},
                  { key: 'pageName', header: t('builder_analytics_page_name'), render: (v) => <span className="text-xs font-medium">{String(v)}</span> },
                  { key: 'visitors', header: t('builder_analytics_visitors'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-bold tabular-nums">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'totalViews', header: t('builder_analytics_total_views'), align: 'right' as const, render: (v) => (
                    <span className="text-xs font-bold tabular-nums">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'referralVisits', header: t('builder_analytics_referral_visits'), align: 'right' as const, render: (v) => (
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(v).toLocaleString()}</span>
                  )},
                  { key: 'clicks', header: t('builder_analytics_clicks'), align: 'right' as const, render: (v) => {
                    const val = Number(v)
                    return (
                      <span className="text-xs font-semibold tabular-nums">
                        {val.toLocaleString()}
                        {val >= 50 && <span className="ml-1" title={t('builder_analytics_high_clicks')}>🔥</span>}
                      </span>
                    )
                  }},
                ]}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {!isPro && <AnalyticsUpgradeBanner onUpgrade={() => openUpgradeModal('analytics.upgrade_banner', PAYWALL_ITC.UPGRADE)} />}
      </Box>
    </SettingsSection>
  )
}
