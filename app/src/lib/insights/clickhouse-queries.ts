/**
 * ClickHouse Analytics GraphQL Query Builders
 *
 * Builds `analyticsQuery` GraphQL queries for each ClickHouse insight.
 * All queries target: brand "godaddy", namespace "experimental".
 *
 * The `url` parameter should be the bare hostname (no protocol) of the published app,
 * e.g. "70mqshlu7h.c4.test-airoapp.ai".
 *
 * Date window: pass `days` (rolling), `DateRangeFilter` (fromDate / toDate), or
 * `BucketFilter` (fromDate / toDate / bucketDays).
 */

import { logger } from '@/lib/request-context'

export interface DateRangeFilter {
  fromDate: string
  toDate: string
}

export interface BucketFilter extends DateRangeFilter {
  bucketDays: number
}

/** Rolling lookback in days, calendar range, or bucketed calendar range */
export type DateFilter = number | DateRangeFilter | BucketFilter

export type AnalyticsDateSelection =
  | { mode: 'rolling'; days: number }
  | { mode: 'custom'; fromDate: string; toDate: string }

const TRAFFIC_BUCKET_DAYS = 7

/** Custom traffic ranges at most this many days use daily fromDate/toDate without bucketDays */
const MAX_DAYS_WITHOUT_BUCKET = 30

export function isBucketFilter(dateFilter: DateFilter): dateFilter is BucketFilter {
  return typeof dateFilter !== 'number' && 'bucketDays' in dateFilter
}

function customSelectionSpanDays(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`)
  const to = Date.parse(`${toDate}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    logger.warn('analytics.dateSelection.invalid', { fromDate, toDate })
    return 1
  }
  return Math.floor((to - from) / 86_400_000) + 1
}

export function selectionSpanDays(selection: AnalyticsDateSelection): number {
  if (selection.mode === 'rolling') return selection.days
  return customSelectionSpanDays(selection.fromDate, selection.toDate)
}

/** Visitors traffic: rolling uses days; custom ≤30 days daily; custom >30 days uses bucketDays */
export function trafficDateFilter(selection: AnalyticsDateSelection): DateFilter {
  if (selection.mode === 'rolling') return selection.days
  if (selectionSpanDays(selection) <= MAX_DAYS_WITHOUT_BUCKET) {
    return { fromDate: selection.fromDate, toDate: selection.toDate }
  }
  return { fromDate: selection.fromDate, toDate: selection.toDate, bucketDays: TRAFFIC_BUCKET_DAYS }
}

/** All other insights: rolling days or calendar range without bucketing */
export function aggregateDateFilter(selection: AnalyticsDateSelection): DateFilter {
  if (selection.mode === 'rolling') return selection.days
  return { fromDate: selection.fromDate, toDate: selection.toDate }
}

/** Stable React Query key segment for an analytics date selection */
export function analyticsDateKey(selection: AnalyticsDateSelection): string {
  if (selection.mode === 'rolling') return `rolling:${selection.days}`
  return `custom:${selection.fromDate}:${selection.toDate}`
}

/**
 * Escape a string for safe inclusion inside a GraphQL double-quoted string literal.
 * Handles backslashes, double quotes, and control characters.
 */
function escapeGraphQL(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function q(
  insightName: string,
  url: string,
  dateFilter: DateFilter,
  extras: Record<string, string | number> = {},
): string {
  const safeUrl = escapeGraphQL(url)
  const safeInsight = escapeGraphQL(insightName)
  const filterParts = [`url: "${safeUrl}"`]

  if (typeof dateFilter === 'number') {
    filterParts.push(`days: ${dateFilter}`)
  } else {
    filterParts.push(`fromDate: "${escapeGraphQL(dateFilter.fromDate)}"`)
    filterParts.push(`toDate: "${escapeGraphQL(dateFilter.toDate)}"`)
    if (isBucketFilter(dateFilter)) {
      filterParts.push(`bucketDays: ${dateFilter.bucketDays}`)
    }
  }

  for (const [k, v] of Object.entries(extras)) {
    filterParts.push(typeof v === 'string' ? `${k}: "${escapeGraphQL(v)}"` : `${k}: ${v}`)
  }
  return `query { analyticsQuery(brand: "godaddy", namespace: "experimental", insightName: "${safeInsight}", filter: { ${filterParts.join(', ')} }) { rows { data } } }`
}

// ─── Traffic Overview ───────────────────────────────────

export const buildPageViewsPerPathQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_page_views_per_path', url, dateFilter, { recordType: 'page_stats' })

export const buildUniqueVisitorsPerPageQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_unique_visitors_per_page', url, dateFilter, { recordType: 'page_stats' })

export const buildPageActivityShareQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_page_activity_share', url, dateFilter, { recordType: 'page_stats' })

// ─── Click Analytics ────────────────────────────────────

export const buildClickAnalyticsHostTotalsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_click_analytics_host_totals', url, dateFilter, { recordType: 'host_totals', limit: 50 })

export const buildClicksByElementQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_by_element', url, dateFilter, { recordType: 'by_element_all_devices', limit: 50 })

export const buildClicksPerPageQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_per_page', url, dateFilter, { recordType: 'by_page_all_devices', limit: 50 })

export const buildClickActivityShareQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_click_activity_share', url, dateFilter, { recordType: 'by_page_all_devices' })

export const buildExitRateQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_exit_rate', url, dateFilter, { recordType: 'exit_rate' })

// ─── Visitor Insights ───────────────────────────────────

export const buildReturningVisitorsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_returning_visitors', url, dateFilter, { recordType: 'new_returning' })

export const buildBrowsersForVisitorsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_browsers_for_visitors', url, dateFilter, { recordType: 'host_stats_browser' })

export const buildSessionsByDeviceTypeQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_sessions_by_device_type', url, dateFilter, { recordType: 'session_depth' })

// ─── Geographic Insights ────────────────────────────────

export const buildCountryTrafficQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_country_traffic', url, dateFilter, { recordType: 'geo_country' })

export const buildCityTrafficQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_city_traffic', url, dateFilter, { recordType: 'geo_city' })

export const buildBounceSessionsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_bounce_sessions_landing_page', url, dateFilter, { recordType: 'bounce_stats' })

// ─── Navigation Patterns ────────────────────────────────

export const buildPageTransitionsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_page_transitions', url, dateFilter, { recordType: 'page_transitions' })

// ─── Traffic Sources ────────────────────────────────────

export const buildTopReferrersQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_top_referrers', url, dateFilter, { recordType: 'top_referrers' })

export const buildReferrerLandingPageQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_referrer_landing_page', url, dateFilter, { recordType: 'referrer_to_landing' })

// ─── Click Deep Dive ────────────────────────────────────

export const buildClicksByElementTextQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_by_element_text', url, dateFilter, { recordType: 'by_element_text' })

export const buildClicksByElementPerDeviceQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_by_element_per_device', url, dateFilter, { recordType: 'by_element' })

// ─── CTA / Sessions ────────────────────────────────────

export const buildClicksPerSessionQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_per_session', url, dateFilter, { recordType: 'sessions' })

// ─── Hourly Activity ────────────────────────────────────

export const buildClicksByHourAllDevicesQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_clicks_by_hour_all_devices', url, dateFilter, { recordType: 'by_hour_all_devices' })

export const buildHostHourlyPageviewsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_host_hourly_pageviews', url, dateFilter, { recordType: 'host_hourly' })

export const buildHostHourlyVisitorsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_host_hourly_visitors', url, dateFilter, { recordType: 'host_hourly' })

// ─── KPI Metrics ────────────────────────────────────────

export const buildTotalSessionsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_total_sessions', url, dateFilter, { recordType: 'session_depth' })

export const buildAvgPagesPerSessionQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_avg_pages_per_session', url, dateFilter, { recordType: 'referrer_quality' })

export const buildAvgSessionDurationQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_avg_session_duration', url, dateFilter, { recordType: 'referrer_quality' })

// ─── Raw / Multi-report ─────────────────────────────────

export const buildPageViewsPerHostQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_page_views_per_host', url, dateFilter, { recordType: 'host_stats' })

export const buildUniqueVisitorsPerHostQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_unique_visitors_per_host', url, dateFilter, { recordType: 'host_stats' })

export const buildRawPageViewsQuery = (url: string, dateFilter: DateFilter) =>
  q('airobuilder_raw_page_views', url, dateFilter, { limit: 100 })
