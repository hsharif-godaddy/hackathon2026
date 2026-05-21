/**
 * Insights Data Fetchers
 *
 * Provides functions to fetch analytics data from the ClickHouse-backed
 * `analyticsQuery` GraphQL endpoint. Replaces the older ITEMIZE / wildcard
 * queries with the same ClickHouse insights used by the chart layer.
 */

import { logger } from '@/lib/request-context'
import { safeFetch } from './clickhouse-fetchers'
import type { DateFilter } from './clickhouse-queries'
import {
  buildClickAnalyticsHostTotalsQuery,
  buildClicksByElementQuery,
  buildPageViewsPerHostQuery,
  buildPageViewsPerPathQuery,
} from './clickhouse-queries'

/**
 * Extract bare hostname from a full URL.
 * "https://70mqshlu7h.c4.test-airoapp.ai/" → "70mqshlu7h.c4.test-airoapp.ai"
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

/**
 * Fetch route-specific page views using airobuilder_page_views_per_path.
 *
 * Sums `page_views` for all rows matching the given route path.
 */
export async function fetchRouteCount(
  publishedUrl: string,
  route: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<number> {
  const hostname = extractHostname(publishedUrl)
  interface Row { page_path: string; page_views: number }
  try {
    const rows = await safeFetch<Row>(buildPageViewsPerPathQuery(hostname, dateFilter), 'fetchRouteCount', appId)
    const normalizedRoute = route === '/' ? '/' : route.replace(/\/$/, '')
    let total = 0
    for (const r of rows) {
      const rp = r.page_path === '/' ? '/' : r.page_path.replace(/\/$/, '')
      if (rp === normalizedRoute) {
        total += Number(r.page_views ?? 0)
      }
    }
    return total
  } catch (error) {
    logger.debug('analytics.fetch.route.no-data', {
      route,
      error: error instanceof Error ? error.message : String(error)
    })
    return 0
  }
}

/**
 * Fetch page view count with daily breakdown using airobuilder_page_views_per_host.
 *
 * Aggregates `host_views` by `event_date` and returns the same shape as
 * the former ITEMIZE-based `insightCountByValueDaily` query.
 */
export async function fetchDailyPageViews(
  publishedUrl: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  const hostname = extractHostname(publishedUrl)
  interface Row { event_date: string; host_views: number }
  try {
    const rows = await safeFetch<Row>(buildPageViewsPerHostQuery(hostname, dateFilter), 'fetchDailyPageViews', appId)
    const byDate = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      const pv = Number(r.host_views ?? 0)
      byDate.set(r.event_date, (byDate.get(r.event_date) ?? 0) + pv)
      total += pv
    }
    const dailyBreakdown = [...byDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { count: total, dailyBreakdown }
  } catch (error) {
    logger.debug('analytics.fetch.daily-pageviews.no-data', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { count: 0, dailyBreakdown: [] }
  }
}

/**
 * Fetch total click count with daily breakdown using airobuilder_click_analytics_host_totals.
 *
 * Aggregates `clicks` by `event_date`.
 */
export async function fetchTotalClicks(
  publishedUrl: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  const hostname = extractHostname(publishedUrl)
  interface Row { event_date: string; clicks: number }
  try {
    const rows = await safeFetch<Row>(buildClickAnalyticsHostTotalsQuery(hostname, dateFilter), 'fetchTotalClicks', appId)
    const byDate = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      const c = Number(r.clicks ?? 0)
      byDate.set(r.event_date, (byDate.get(r.event_date) ?? 0) + c)
      total += c
    }
    const dailyBreakdown = [...byDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { count: total, dailyBreakdown }
  } catch (error) {
    logger.debug('analytics.fetch.total-clicks.no-data', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { count: 0, dailyBreakdown: [] }
  }
}

/**
 * Fetch button clicks count with daily breakdown using airobuilder_clicks_by_element.
 *
 * Filters rows where `element_type == "button"` and aggregates `total_clicks`.
 */
export async function fetchButtonClicks(
  publishedUrl: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  return fetchClicksByType(publishedUrl, dateFilter, 'button', appId)
}

/**
 * Fetch link clicks count with daily breakdown using airobuilder_clicks_by_element.
 *
 * Filters rows where `element_type == "link"` and aggregates `total_clicks`.
 */
export async function fetchLinkClicks(
  publishedUrl: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  return fetchClicksByType(publishedUrl, dateFilter, 'link', appId)
}

/**
 * Internal: fetch clicks for a specific element type from airobuilder_clicks_by_element.
 */
async function fetchClicksByType(
  publishedUrl: string,
  dateFilter: DateFilter,
  elementType: 'button' | 'link',
  appId?: string,
): Promise<{ count: number; dailyBreakdown: Array<{ date: string; count: number }> }> {
  const hostname = extractHostname(publishedUrl)
  interface Row { event_date: string; element_type: string; total_clicks: number; total_unique_visitors: number }
  try {
    const rows = await safeFetch<Row>(buildClicksByElementQuery(hostname, dateFilter), `fetch${elementType}Clicks`, appId)
    const filtered = rows.filter((r) => r.element_type === elementType)
    const byDate = new Map<string, number>()
    let total = 0
    for (const r of filtered) {
      const c = Number(r.total_clicks ?? 0)
      byDate.set(r.event_date, (byDate.get(r.event_date) ?? 0) + c)
      total += c
    }
    const dailyBreakdown = [...byDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { count: total, dailyBreakdown }
  } catch (error) {
    logger.debug(`analytics.fetch.${elementType}-clicks.no-data`, {
      error: error instanceof Error ? error.message : String(error)
    })
    return { count: 0, dailyBreakdown: [] }
  }
}

/**
 * Fetch unique visitor count using airobuilder_page_views_per_host.
 *
 * The `host_stats` recordType already includes `unique_visitors` per date.
 * We sum across all dates for the total.
 */
export async function fetchVisitors(
  publishedUrl: string,
  dateFilter: DateFilter,
  appId?: string,
): Promise<number> {
  const hostname = extractHostname(publishedUrl)
  interface Row { event_date: string; unique_visitors?: number }
  try {
    const rows = await safeFetch<Row>(buildPageViewsPerHostQuery(hostname, dateFilter), 'fetchVisitors', appId)
    let total = 0
    for (const r of rows) {
      total += Number(r.unique_visitors ?? 0)
    }
    return total
  } catch (error) {
    logger.debug('analytics.fetch.visitors.no-data', {
      publishedUrl,
      error: error instanceof Error ? error.message : String(error)
    })
    return 0
  }
}
