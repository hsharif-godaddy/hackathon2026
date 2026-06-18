/**
 * ClickHouse Analytics Data Fetchers
 *
 * Fetches data from the ClickHouse-backed `analyticsQuery` GraphQL endpoint
 * and transforms raw rows into chart-ready data structures consumed by Recharts.
 *
 * All functions accept the bare hostname (no protocol) and the day range.
 * They reuse the existing `executeGraphQLQuery` client through a thin wrapper
 * that handles the different response shape (`analyticsQuery.rows[].data`).
 */

import { logger } from '@/lib/request-context'
import { sleep } from '@/utils/common'
import type { AnalyticsDateSelection, DateFilter } from './clickhouse-queries'
import {
  aggregateDateFilter,
  buildAvgPagesPerSessionQuery,
  buildAvgSessionDurationQuery,
  buildBounceSessionsQuery,
  buildBrowsersForVisitorsQuery,
  buildCityTrafficQuery,
  buildClickActivityShareQuery,
  buildClickAnalyticsHostTotalsQuery,
  buildClicksByElementPerDeviceQuery,
  buildClicksByElementQuery,
  buildClicksByElementTextQuery,
  buildClicksByHourAllDevicesQuery,
  buildClicksPerPageQuery,
  buildClicksPerSessionQuery,
  buildCountryTrafficQuery,
  buildExitRateQuery,
  buildHostHourlyPageviewsQuery,
  buildHostHourlyVisitorsQuery,
  buildPageActivityShareQuery,
  buildPageTransitionsQuery,
  buildPageViewsPerHostQuery,
  buildPageViewsPerPathQuery,
  buildRawPageViewsQuery,
  buildReferrerLandingPageQuery,
  buildReturningVisitorsQuery,
  buildSessionsByDeviceTypeQuery,
  buildTopReferrersQuery,
  buildTotalSessionsQuery,
  buildUniqueVisitorsPerHostQuery,
  buildUniqueVisitorsPerPageQuery,
  isBucketFilter,
  trafficDateFilter,
} from './clickhouse-queries'
import type {
  ActivityHitRow,
  ChartDataPoint,
  ClickhouseGraphQLResponse,
  ComposedDataPoint,
  DualSeriesDataPoint,
  KpiExtras,
  MultiAreaDataPoint,
  ReferrerLandingRow,
  SessionClickRow,
  StackedBarDataPoint,
  TableDataPoint,
} from './clickhouse-types'
import { INITIAL_RETRY_DELAY_MS, MAX_RETRIES, MAX_RETRY_DELAY_MS, REQUEST_TIMEOUT_MS } from './constants'
import { calculateBackoffDelay, classifyError } from './error-handler'

// ─── Request deduplication ──────────────────────────────

/**
 * In-flight request deduplication cache.
 *
 * Many fetchers call the SAME ClickHouse insight (e.g. clicks_by_element_per_device
 * is used by 5 different fetcher functions). Without dedup, the same query
 * string hits the proxy 5 times. This cache ensures each unique query is
 * executed only once per fetch cycle and the result is shared.
 *
 * The cache is keyed by the full query string and holds a Promise so that
 * concurrent callers await the same in-flight request.
 */

const inflight = new Map<string, Promise<any[]>>()

// ─── Generic executor ───────────────────────────────────

/**
 * Execute a ClickHouse analyticsQuery via the existing proxy and return parsed row objects.
 * Uses the in-flight dedup cache so identical query strings only make one HTTP request.
 */
async function execClickhouse<T = Record<string, unknown>>(
  query: string,
  opName: string,
  appId?: string,
): Promise<T[]> {
  // Return cached/in-flight result if this exact query is already running
  const existing = inflight.get(query)
  if (existing) {
    logger.debug('analytics.clickhouse.dedup-hit', { opName })
    return existing as Promise<T[]>
  }

  const promise = execClickhouseImpl<T>(query, opName, appId)
  inflight.set(query, promise)

  // Clean up the cache entry once the request completes (success or failure)
  promise.finally(() => { inflight.delete(query) })

  return promise
}

/** Actual HTTP execution (called once per unique query string) */
async function execClickhouseImpl<T = Record<string, unknown>>(
  query: string,
  opName: string,
  appId?: string,
): Promise<T[]> {
  const proxyUrl = '/api/analytics/graphql'
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, appId }),
        signal: ac.signal,
      })
      clearTimeout(tid)
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }
      const json: ClickhouseGraphQLResponse = await res.json()
      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join('; ')
        // GraphQL-level errors (e.g. "internal server error") are not retryable — return empty
        logger.warn('analytics.clickhouse.graphql-error', { opName, error: msg })
        return []
      }
      const rows = json.data?.analyticsQuery?.rows ?? []
      return rows.map((r) => JSON.parse(r.data) as T)
    } catch (err) {
      clearTimeout(tid)
      lastError = err instanceof Error ? err : new Error(String(err))
      const cls = classifyError(err)
      if (!cls.retryable || attempt === MAX_RETRIES) {
        if (attempt === MAX_RETRIES) {
          logger.error('analytics.clickhouse.retry-exhausted', { opName, attempt, error: cls.message })
        }
        throw new Error(cls.message)
      }
      const delay = calculateBackoffDelay(attempt, INITIAL_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS)
      logger.warn('analytics.clickhouse.retry', { opName, attempt, delayMs: delay })
      await sleep(delay)
    }
  }
  throw lastError || new Error('Request failed')
}

/** Convenience: execute and swallow errors, returning [] */
export async function safeFetch<T = Record<string, unknown>>(query: string, opName: string, appId?: string): Promise<T[]> {
  try {
    const rows = await execClickhouse<T>(query, opName, appId)
    if (rows.length === 0) {
      logger.debug('analytics.clickhouse.empty-result', { opName })
    }
    return rows
  } catch (err) {
    // Log at warn level so failures are visible in browser DevTools console
    logger.warn('analytics.clickhouse.fetch-fail', {
      opName,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

// ─── Helpers ────────────────────────────────────────────


function sumByKey(rows: any[], groupKey: string, sumKey: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[groupKey] ?? '')
    map.set(k, (map.get(k) ?? 0) + Number(r[sumKey] ?? 0))
  }
  return map
}

/**
 * Generate an array of YYYY-MM-DD date strings for the last `days` days
 * (inclusive of today).
 *
 * Uses UTC throughout so that date boundaries are consistent regardless of the
 * server or browser timezone—matching the UTC dates returned by ClickHouse.
 */
function generateDateRange(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  // Anchor to today's date in UTC
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUTC)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

function generateDateRangeFromTo(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  const start = Date.parse(`${fromDate}T00:00:00Z`)
  const end = Date.parse(`${toDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return dates
  for (let t = start; t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10))
  }
  return dates
}

export function formatBucketLabel(bucketFrom: string, bucketTo: string): string {
  const formatPart = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`)
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
  }
  return `${formatPart(bucketFrom)} – ${formatPart(bucketTo)}`
}

function generateBucketRange(
  fromDate: string,
  toDate: string,
  bucketDays: number,
): Array<{ bucketFrom: string; bucketTo: string; label: string }> {
  const start = Date.parse(`${fromDate}T00:00:00Z`)
  const end = Date.parse(`${toDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || bucketDays < 1) return []

  const buckets: Array<{ bucketFrom: string; bucketTo: string; label: string }> = []
  for (let t = start; t <= end; t += bucketDays * 86_400_000) {
    const bucketFrom = new Date(t).toISOString().slice(0, 10)
    const bucketEnd = Math.min(t + (bucketDays - 1) * 86_400_000, end)
    const bucketTo = new Date(bucketEnd).toISOString().slice(0, 10)
    buckets.push({ bucketFrom, bucketTo, label: formatBucketLabel(bucketFrom, bucketTo) })
  }
  return buckets
}

function rowBucketFrom(point: { date: string; bucket_from?: string }): string | undefined {
  return point.bucket_from
}

function numericField(row: object, keys: string[]): number {
  const record = row as Record<string, unknown>
  for (const key of keys) {
    const v = record[key]
    if (v !== undefined && v !== null && v !== '') {
      return Number(v) || 0
    }
  }
  return 0
}

function seriesHasPositiveValues(points: Array<{ value?: number }>): boolean {
  return points.some((d) => Number(d.value) > 0)
}

function lookupBucketPoint<T extends { date: string; bucket_from?: string }>(
  data: T[],
  bucketFrom: string,
  bucketTo: string,
  label: string,
): T | undefined {
  const byFrom = data.find((d) => rowBucketFrom(d) === bucketFrom)
  if (byFrom) return byFrom
  const byLabel = data.find((d) => d.date === label)
  if (byLabel) return byLabel
  // API bucket alignment can differ by a day from our generated grid
  return data.find((d) => {
    const from = rowBucketFrom(d)
    return Boolean(from && from >= bucketFrom && from <= bucketTo)
  })
}

function seriesSortKey(
  row: { event_date?: string; bucket_from?: string },
  dateFilter: DateFilter,
): string {
  if (isBucketFilter(dateFilter) && row.bucket_from) return row.bucket_from
  return row.event_date ?? ''
}

function seriesDisplayDate(
  row: { event_date?: string; bucket_from?: string; bucket_to?: string },
  dateFilter: DateFilter,
): string {
  if (isBucketFilter(dateFilter) && row.bucket_from && row.bucket_to) {
    return formatBucketLabel(row.bucket_from, row.bucket_to)
  }
  return row.event_date ?? ''
}

type SeriesRow = {
  event_date?: string
  bucket_from?: string
  bucket_to?: string
}

function aggregateChartPoints<TRow extends SeriesRow>(
  rows: TRow[],
  dateFilter: DateFilter,
  valueForRow: (row: TRow) => number,
): ChartDataPoint[] {
  const byKey = new Map<string, { label: string; bucket_from?: string; value: number }>()
  for (const row of rows) {
    const key = seriesSortKey(row, dateFilter)
    const label = seriesDisplayDate(row, dateFilter)
    const prev = byKey.get(key)
    const value = valueForRow(row)
    byKey.set(key, {
      label: prev?.label ?? label,
      bucket_from: prev?.bucket_from ?? (isBucketFilter(dateFilter) ? row.bucket_from : undefined),
      value: (prev?.value ?? 0) + value,
    })
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { label, value, bucket_from }]) => ({
      date: label,
      value,
      ...(bucket_from ? { bucket_from } : {}),
    }))
}

/**
 * Pad a time-series dataset so that every date in the requested range is
 * present.  Missing dates are filled with zero-valued entries whose shape
 * is inferred from the first existing data point.
 *
 * This ensures all charts share the same x-axis span regardless of how
 * much data the ClickHouse materialized view actually contains.
 */
function padDateRange<T extends { date: string }>(
  data: T[],
  days: number,
  zeroFn?: () => Omit<T, 'date'>,
): T[] {
  if (days <= 0) return data

  const range = generateDateRange(days)
  const map = new Map(data.map((d) => [d.date, d]))

  const makeZero: () => Omit<T, 'date'> = zeroFn ?? (() => {
    if (data.length === 0) return {} as Omit<T, 'date'>
    // Clone the first data point and zero-out all numeric values
    const template = { ...data[0] } as Record<string, unknown>
    delete template.date
    for (const key of Object.keys(template)) {
      if (typeof template[key] === 'number') template[key] = 0
      else if (typeof template[key] === 'string') template[key] = ''
    }
    return template as Omit<T, 'date'>
  })

  return range.map((date) => map.get(date) ?? ({ date, ...makeZero() } as T))
}

function padDateRangeForFilter<T extends { date: string }>(
  data: T[],
  dateFilter: DateFilter,
  zeroFn?: () => Omit<T, 'date'>,
): T[] {
  if (isBucketFilter(dateFilter)) {
    const makeZero: () => Omit<T, 'date'> = zeroFn ?? (() => {
      if (data.length === 0) return {} as Omit<T, 'date'>
      const template = { ...data[0] } as Record<string, unknown>
      delete template.date
      delete template.bucket_from
      for (const key of Object.keys(template)) {
        if (typeof template[key] === 'number') template[key] = 0
        else if (typeof template[key] === 'string') template[key] = ''
      }
      return template as Omit<T, 'date'>
    })
    return generateBucketRange(dateFilter.fromDate, dateFilter.toDate, dateFilter.bucketDays)
      .map(({ bucketFrom, bucketTo, label }) => {
        const hit = lookupBucketPoint(data, bucketFrom, bucketTo, label)
        if (hit) {
          return { ...hit, date: label, bucket_from: bucketFrom } as unknown as T
        }
        return { date: label, bucket_from: bucketFrom, ...makeZero() } as unknown as T
      })
  }
  if (typeof dateFilter === 'number') {
    return padDateRange(data, dateFilter, zeroFn)
  }
  const range = generateDateRangeFromTo(dateFilter.fromDate, dateFilter.toDate)
  if (range.length === 0) return data
  const map = new Map(data.map((d) => [d.date, d]))
  const makeZero: () => Omit<T, 'date'> = zeroFn ?? (() => {
    if (data.length === 0) return {} as Omit<T, 'date'>
    const template = { ...data[0] } as Record<string, unknown>
    delete template.date
    for (const key of Object.keys(template)) {
      if (typeof template[key] === 'number') template[key] = 0
      else if (typeof template[key] === 'string') template[key] = ''
    }
    return template as Omit<T, 'date'>
  })
  return range.map((date) => map.get(date) ?? ({ date, ...makeZero() } as T))
}

function formatHour(h: number): string {
  return `${h}:00`
}

// ─── Host-level Pageviews (KPI + Live Data chart) ───────

/**
 * Fetch daily pageviews per host from ClickHouse.
 * Uses `airobuilder_page_views_per_host` which returns `{event_date, page_host, host_views}`.
 * NOTE: This insight does NOT return unique_visitors — use `fetchUniqueVisitorsPerHost` for that.
 */
export async function fetchPageViewsPerHost(
  url: string,
  dateFilter: DateFilter, appId?: string
): Promise<{ totalPageViews: number; dailyPageViews: ChartDataPoint[] }> {
  interface Row { event_date?: string; bucket_from?: string; bucket_to?: string; host_views?: number; page_views?: number; views?: number }
  const rows = await safeFetch<Row>(buildPageViewsPerHostQuery(url, dateFilter), 'pageViewsPerHost', appId)
  let total = 0
  for (const r of rows) {
    total += numericField(r, ['host_views', 'page_views', 'views'])
  }
  const sorted = aggregateChartPoints(rows, dateFilter, (r) => numericField(r, ['host_views', 'page_views', 'views']))
  return {
    totalPageViews: total,
    dailyPageViews: padDateRangeForFilter(sorted, dateFilter, () => ({ value: 0 })),
  }
}

/**
 * Fetch daily unique visitors per host from ClickHouse.
 * Uses `airobuilder_unique_visitors_per_host` which returns `{event_date, page_host, unique_visitors}`.
 */
export async function fetchUniqueVisitorsPerHost(
  url: string,
  dateFilter: DateFilter, appId?: string
): Promise<{ totalUniqueVisitors: number; dailyUniqueVisitors: ChartDataPoint[] }> {
  interface Row { event_date?: string; bucket_from?: string; bucket_to?: string; unique_visitors?: number; visitors?: number }
  const rows = await safeFetch<Row>(buildUniqueVisitorsPerHostQuery(url, dateFilter), 'uniqueVisitorsPerHost', appId)
  let total = 0
  for (const r of rows) {
    total += numericField(r, ['unique_visitors', 'visitors'])
  }
  const sorted = aggregateChartPoints(rows, dateFilter, (r) => numericField(r, ['unique_visitors', 'visitors']))
  return {
    totalUniqueVisitors: total,
    dailyUniqueVisitors: padDateRangeForFilter(sorted, dateFilter, () => ({ value: 0 })),
  }
}

/**
 * Fetch daily total sessions from ClickHouse.
 * Uses `airobuilder_total_sessions` (recordType: session_depth) which returns
 * `{page_host, event_date, total_sessions}` — the TRUE session count per day.
 */
export async function fetchTotalSessionsDaily(
  url: string,
  dateFilter: DateFilter, appId?: string
): Promise<ChartDataPoint[]> {
  interface Row { event_date?: string; bucket_from?: string; bucket_to?: string; total_sessions?: number; sessions?: number }
  const rows = await safeFetch<Row>(buildTotalSessionsQuery(url, dateFilter), 'totalSessionsDaily', appId)
  const sorted = aggregateChartPoints(rows, dateFilter, (r) => numericField(r, ['total_sessions', 'sessions']))
  return padDateRangeForFilter(sorted, dateFilter, () => ({ value: 0 }))
}

// ─── Traffic Overview ───────────────────────────────────

export async function fetchPageViewsByPath(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { page_path: string; page_views: number }
  const rows = await safeFetch<Row>(buildPageViewsPerPathQuery(url, dateFilter), 'pageViewsByPath', appId)
  const agg = sumByKey(rows, 'page_path', 'page_views')
  return [...agg.entries()].map(([path, v]) => ({ date: path, value: v })).sort((a, b) => b.value - a.value).slice(0, 5)
}

export async function fetchUniqueVisitorsByPage(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { page_path: string; unique_visitors: number }
  const rows = await safeFetch<Row>(buildUniqueVisitorsPerPageQuery(url, dateFilter), 'uniqueVisitorsByPage', appId)
  const agg = sumByKey(rows, 'page_path', 'unique_visitors')
  return [...agg.entries()].map(([path, v]) => ({ date: path, value: v })).sort((a, b) => b.value - a.value).slice(0, 5)
}

export async function fetchPageActivityShare(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { page_path: string; share_of_total_activity: number }
  const rows = await safeFetch<Row>(buildPageActivityShareQuery(url, dateFilter), 'pageActivityShare', appId)
  // Already aggregated across days by the insight
  return rows.map((r) => ({ date: r.page_path, value: Math.round(r.share_of_total_activity) })).sort((a, b) => b.value - a.value).slice(0, 5)
}

// ─── Click Analytics ────────────────────────────────────

export async function fetchClickTrends(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { event_date?: string; bucket_from?: string; bucket_to?: string; clicks: number }
  const rows = await safeFetch<Row>(buildClickAnalyticsHostTotalsQuery(url, dateFilter), 'clickTrends', appId)
  const sorted = aggregateChartPoints(rows, dateFilter, (r) => Number(r.clicks ?? 0))
  return padDateRangeForFilter(sorted, dateFilter, () => ({ value: 0 }))
}

export async function fetchClicksByElement(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { element_type: string; total_clicks: number }
  const rows = await safeFetch<Row>(buildClicksByElementQuery(url, dateFilter), 'clicksByElement', appId)
  const agg = sumByKey(rows, 'element_type', 'total_clicks')
  return [...agg.entries()].map(([el, v]) => ({
    date: el.charAt(0).toUpperCase() + el.slice(1),
    value: v,
  }))
}

export async function fetchClicksPerPage(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { page_path: string; clicks: number }
  const rows = await safeFetch<Row>(buildClicksPerPageQuery(url, dateFilter), 'clicksPerPage', appId)
  const agg = sumByKey(rows, 'page_path', 'clicks')
  return [...agg.entries()].map(([p, v]) => ({ date: p, value: v })).sort((a, b) => b.value - a.value).slice(0, 5)
}

export async function fetchClickActivityShare(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { page_path: string; share_of_total_clicks: number }
  const rows = await safeFetch<Row>(buildClickActivityShareQuery(url, dateFilter), 'clickActivityShare', appId)
  return rows.map((r) => ({ date: r.page_path, value: Math.round(r.share_of_total_clicks) })).slice(0, 5)
}

export async function fetchExitRate(url: string, dateFilter: DateFilter, appId?: string): Promise<ComposedDataPoint[]> {
  interface Row { page_path: string; page_views: number; exits: number; exit_rate_x10000: number }
  const rows = await safeFetch<Row>(buildExitRateQuery(url, dateFilter), 'exitRate', appId)
  // Aggregate across dates per page_path
  const map = new Map<string, { views: number; exits: number }>()
  for (const r of rows) {
    const prev = map.get(r.page_path) ?? { views: 0, exits: 0 }
    prev.views += Number(r.page_views ?? 0)
    prev.exits += Number(r.exits ?? 0)
    map.set(r.page_path, prev)
  }
  return [...map.entries()].map(([path, { views, exits }]) => ({
    date: path,
    value: views,
    value2: exits,
    rate: views > 0 ? Math.round((exits / views) * 1000) / 10 : 0,
  })).sort((a, b) => b.rate - a.rate).slice(0, 5)
}

// ─── Visitor Insights ───────────────────────────────────

export async function fetchNewVsReturning(url: string, dateFilter: DateFilter, appId?: string): Promise<StackedBarDataPoint[]> {
  interface Row {
    event_date?: string
    bucket_from?: string
    bucket_to?: string
    new_visitors: number
    returning_visitors: number
  }
  const rows = await safeFetch<Row>(buildReturningVisitorsQuery(url, dateFilter), 'newVsReturning', appId)
  const byKey = new Map<string, StackedBarDataPoint & { bucket_from?: string }>()
  for (const r of rows) {
    const key = seriesSortKey(r, dateFilter)
    const prev = byKey.get(key)
    byKey.set(key, {
      date: prev?.date ?? seriesDisplayDate(r, dateFilter),
      ...(isBucketFilter(dateFilter) && r.bucket_from ? { bucket_from: r.bucket_from } : {}),
      new_visitors: Number(prev?.new_visitors ?? 0) + Number(r.new_visitors ?? 0),
      returning_visitors: Number(prev?.returning_visitors ?? 0) + Number(r.returning_visitors ?? 0),
    })
  }
  const sorted = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
  return padDateRangeForFilter(sorted, dateFilter, () => ({ new_visitors: 0, returning_visitors: 0 }))
}

export async function fetchBrowserSessions(url: string, dateFilter: DateFilter, appId?: string): Promise<MultiAreaDataPoint[]> {
  interface Row {
    event_date?: string
    bucket_from?: string
    bucket_to?: string
    sessions: number
    unique_visitors: number
  }
  const rows = await safeFetch<Row>(buildBrowsersForVisitorsQuery(url, dateFilter), 'browserSessions', appId)
  const byKey = new Map<string, MultiAreaDataPoint & { bucket_from?: string }>()
  for (const r of rows) {
    const key = seriesSortKey(r, dateFilter)
    const prev = byKey.get(key)
    byKey.set(key, {
      date: prev?.date ?? seriesDisplayDate(r, dateFilter),
      ...(isBucketFilter(dateFilter) && r.bucket_from ? { bucket_from: r.bucket_from } : {}),
      sessions: Number(prev?.sessions ?? 0) + Number(r.sessions ?? 0),
      unique_visitors: Number(prev?.unique_visitors ?? 0) + Number(r.unique_visitors ?? 0),
    })
  }
  const sorted = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
  return padDateRangeForFilter(sorted, dateFilter, () => ({ sessions: 0, unique_visitors: 0 }))
}

export async function fetchSessionsByDevice(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { device_type: string; sessions: number }
  const rows = await safeFetch<Row>(buildSessionsByDeviceTypeQuery(url, dateFilter), 'sessionsByDevice', appId)
  const agg = sumByKey(rows, 'device_type', 'sessions')
  return [...agg.entries()].map(([d, v]) => ({
    date: d.charAt(0).toUpperCase() + d.slice(1),
    value: v,
  }))
}

/**
 * Per-browser unique visitors over time (top 5 browsers as separate series).
 * Uses `airobuilder_browsers_for_visitors` but reads `unique_visitors` (not `sessions`
 * which is actually page-views-per-browser, not real sessions).
 */
export async function fetchBrowserTrendsOverTime(url: string, dateFilter: DateFilter, appId?: string): Promise<MultiAreaDataPoint[]> {
  interface Row {
    event_date?: string
    bucket_from?: string
    bucket_to?: string
    browser?: string
    sessions: number
    unique_visitors: number
  }
  const rows = await safeFetch<Row>(buildBrowsersForVisitorsQuery(url, dateFilter), 'browserTrends', appId)

  // Bucketed host_stats_browser returns host-level sessions per bucket (no browser breakdown)
  if (isBucketFilter(dateFilter) && rows.length > 0 && rows.every((r) => !r.browser)) {
    const points = aggregateChartPoints(rows, dateFilter, (r) => Number(r.unique_visitors ?? r.sessions ?? 0))
    return padDateRangeForFilter(
      points.map((p) => ({
        date: p.date,
        ...(p.bucket_from ? { bucket_from: p.bucket_from } : {}),
        Visitors: p.value,
      })),
      dateFilter,
      () => ({ Visitors: 0 }),
    )
  }

  // Aggregate total unique_visitors per browser to find top 5
  const browserTotals = new Map<string, number>()
  for (const r of rows) {
    const b = r.browser || 'Other'
    browserTotals.set(b, (browserTotals.get(b) ?? 0) + Number(r.unique_visitors ?? 0))
  }
  const topBrowsers = [...browserTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name)
  const topSet = new Set(topBrowsers)

  const dateMap = new Map<string, { label: string; bucket_from?: string; browsers: Record<string, number> }>()
  for (const r of rows) {
    const b = topSet.has(r.browser || 'Other') ? (r.browser || 'Other') : 'Other'
    const key = seriesSortKey(r, dateFilter)
    const prev = dateMap.get(key)
    const browsers = prev?.browsers ?? {}
    browsers[b] = (browsers[b] ?? 0) + Number(r.unique_visitors ?? 0)
    dateMap.set(key, {
      label: prev?.label ?? seriesDisplayDate(r, dateFilter),
      bucket_from: prev?.bucket_from ?? (isBucketFilter(dateFilter) ? r.bucket_from : undefined),
      browsers,
    })
  }

  const sorted = [...dateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { label, bucket_from, browsers }]) => {
      const point: MultiAreaDataPoint = {
        date: label,
        ...(bucket_from ? { bucket_from } : {}),
      }
      for (const browser of topBrowsers) point[browser] = browsers[browser] ?? 0
      return point
    })

  return padDateRangeForFilter(sorted, dateFilter, () => {
    const empty: Record<string, number> = {}
    for (const b of topBrowsers) empty[b] = 0
    return empty
  })
}

// ─── Geographic Insights ────────────────────────────────

/** Resolve ISO-3166 country code to full display name (e.g. "US" → "United States") */
const countryDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })
function resolveCountryName(code: string): string {
  if (!code || code.length !== 2) return code
  try {
    return countryDisplayNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export interface CountryTrafficWithCodeRow {
  country: string
  code: string
  sessions: number
  visitors: number
}

export async function fetchCountryTrafficWithCode(url: string, dateFilter: DateFilter, appId?: string): Promise<CountryTrafficWithCodeRow[]> {
  interface Row { country: string; sessions: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildCountryTrafficQuery(url, dateFilter), 'countryTrafficWithCode', appId)
  const map = new Map<string, { code: string; s: number; uv: number }>()
  for (const r of rows) {
    const prev = map.get(r.country) ?? { code: r.country, s: 0, uv: 0 }
    prev.s += Number(r.sessions ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.country, prev)
  }
  return [...map.entries()]
    .map(([, v]) => ({ country: resolveCountryName(v.code), code: v.code, sessions: v.s, visitors: v.uv }))
    .sort((a, b) => b.visitors - a.visitors)
}

export async function fetchCountryTraffic(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { country: string; sessions: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildCountryTrafficQuery(url, dateFilter), 'countryTraffic', appId)
  const map = new Map<string, { s: number; uv: number }>()
  for (const r of rows) {
    const prev = map.get(r.country) ?? { s: 0, uv: 0 }
    prev.s += Number(r.sessions ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.country, prev)
  }
  return [...map.entries()]
    .map(([c, v]) => ({ date: resolveCountryName(c), value: v.s, value2: v.uv }))
    .sort((a, b) => b.value - a.value)
}

export async function fetchCityTraffic(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { city: string; sessions: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildCityTrafficQuery(url, dateFilter), 'cityTraffic', appId)
  const map = new Map<string, { s: number; uv: number }>()
  for (const r of rows) {
    const prev = map.get(r.city) ?? { s: 0, uv: 0 }
    prev.s += Number(r.sessions ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.city, prev)
  }
  return [...map.entries()]
    .map(([c, v]) => ({ date: c, value: v.s, value2: v.uv }))
    .sort((a, b) => b.value - a.value)
}

export interface CityTrafficWithCountryRow {
  city: string
  country: string
  countryCode: string
  visitors: number
}

export async function fetchCityTrafficWithCountry(url: string, dateFilter: DateFilter, appId?: string): Promise<CityTrafficWithCountryRow[]> {
  interface Row { city: string; country?: string; sessions: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildCityTrafficQuery(url, dateFilter), 'cityTrafficWithCountry', appId)
  const map = new Map<string, { country: string; uv: number }>()
  for (const r of rows) {
    const key = `${r.city}|${r.country ?? ''}`
    const prev = map.get(key) ?? { country: r.country ?? '', uv: 0 }
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(key, prev)
  }
  return [...map.entries()]
    .map(([key, v]) => {
      const city = key.split('|')[0]
      return { city, country: resolveCountryName(v.country), countryCode: v.country, visitors: v.uv }
    })
    .sort((a, b) => b.visitors - a.visitors)
}

// ─── Navigation Patterns ────────────────────────────────

export async function fetchPageTransitions(url: string, dateFilter: DateFilter, appId?: string): Promise<TableDataPoint[]> {
  interface Row { from_page: string; to_page: string; device_type: string; transitions: number }
  const rows = await safeFetch<Row>(buildPageTransitionsQuery(url, dateFilter), 'pageTransitions', appId)
  // Filter out self-transitions, aggregate
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.from_page === r.to_page) continue
    const k = `${r.from_page} → ${r.to_page} (${r.device_type})`
    map.set(k, (map.get(k) ?? 0) + Number(r.transitions ?? 0))
  }
  return [...map.entries()]
    .map(([p, v]) => ({ page: p, visitors: v }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 5)
}

// ─── Traffic Sources ────────────────────────────────────

export async function fetchTopReferrers(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { referrer: string; visits: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildTopReferrersQuery(url, dateFilter), 'topReferrers', appId)
  const map = new Map<string, { visits: number; uv: number }>()
  for (const r of rows) {
    const label = r.referrer ? r.referrer.replace(/^https?:\/\//, '') : '(direct)'
    const prev = map.get(label) ?? { visits: 0, uv: 0 }
    prev.visits += Number(r.visits ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(label, prev)
  }
  return [...map.entries()]
    .map(([d, v]) => ({ date: d, value: v.visits, value2: v.uv }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
}

export async function fetchReferrerLandingDetail(url: string, dateFilter: DateFilter, appId?: string): Promise<ReferrerLandingRow[]> {
  interface Row { referrer: string; landing_page: string; source: string; visits: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildReferrerLandingPageQuery(url, dateFilter), 'referrerLanding', appId)
  // Aggregate across dates
  const map = new Map<string, ReferrerLandingRow>()
  for (const r of rows) {
    const ref = r.referrer || '(direct)'
    const k = `${ref}|${r.landing_page}`
    const prev = map.get(k) ?? {
      referrer: ref,
      landingPage: r.landing_page,
      source: r.source || 'unknown',
      visits: 0,
      uniqueVisitors: 0,
    }
    prev.visits += Number(r.visits ?? 0)
    prev.uniqueVisitors += Number(r.unique_visitors ?? 0)
    map.set(k, prev)
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits).slice(0, 5)
}

// ─── Click Deep Dive ────────────────────────────────────

export async function fetchTopCTALabels(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { element_text: string; clicks: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildClicksByElementTextQuery(url, dateFilter), 'topCTALabels', appId)
  const map = new Map<string, { clicks: number; uv: number }>()
  for (const r of rows) {
    if (!r.element_text) continue
    const prev = map.get(r.element_text) ?? { clicks: 0, uv: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.element_text, prev)
  }
  return [...map.entries()]
    .map(([label, v]) => ({ date: label, value: v.clicks, value2: v.uv }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
}

export async function fetchElementSectionData(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { element_type: string; section: string; clicks: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildClicksByElementPerDeviceQuery(url, dateFilter), 'elementSection', appId)
  const map = new Map<string, { clicks: number; uv: number }>()
  for (const r of rows) {
    const k = `${r.element_type} · ${r.section}`
    const prev = map.get(k) ?? { clicks: 0, uv: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(k, prev)
  }
  return [...map.entries()]
    .map(([k, v]) => ({ date: k, value: v.clicks, value2: v.uv }))
    .sort((a, b) => b.value - a.value)
}

export async function fetchAvgClicksPerSession(url: string, dateFilter: DateFilter, appId?: string): Promise<ComposedDataPoint[]> {
  interface Row { event_date: string; clicks: number; sessions_that_clicked: number; clicks_per_session: number }
  const rows = await safeFetch<Row>(buildClicksPerSessionQuery(url, dateFilter), 'avgClicksPerSession', appId)
  // Aggregate per date
  const map = new Map<string, { clicks: number; sessions: number }>()
  for (const r of rows) {
    const prev = map.get(r.event_date) ?? { clicks: 0, sessions: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.sessions += Number(r.sessions_that_clicked ?? 0)
    map.set(r.event_date, prev)
  }
  const sorted = [...map.entries()]
    .map(([d, v]) => ({
      date: d,
      value: v.clicks,
      value2: v.sessions,
      rate: v.sessions > 0 ? Math.round((v.clicks / v.sessions) * 100) / 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return padDateRangeForFilter(sorted, dateFilter, () => ({ value: 0, value2: 0, rate: 0 }))
}

// ─── Hourly Activity ────────────────────────────────────

export async function fetchClicksByHour(url: string, dateFilter: DateFilter, appId?: string): Promise<DualSeriesDataPoint[]> {
  interface Row { hour: number; clicks: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildClicksByHourAllDevicesQuery(url, dateFilter), 'clicksByHour', appId)
  // Aggregate across dates by hour
  const map = new Map<number, { clicks: number; uv: number }>()
  for (const r of rows) {
    const prev = map.get(r.hour) ?? { clicks: 0, uv: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.hour, prev)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([h, v]) => ({ date: formatHour(h), value: v.clicks, value2: v.uv }))
}

export async function fetchHourlyPageviewVisitor(url: string, dateFilter: DateFilter, appId?: string): Promise<MultiAreaDataPoint[]> {
  interface PvRow { hour: number; pageviews: number }
  interface UvRow { hour: number; unique_visitors: number }
  const [pvRows, uvRows] = await Promise.all([
    safeFetch<PvRow>(buildHostHourlyPageviewsQuery(url, dateFilter), 'hourlyPageviews', appId),
    safeFetch<UvRow>(buildHostHourlyVisitorsQuery(url, dateFilter), 'hourlyVisitors', appId),
  ])
  const map = new Map<number, { pv: number; uv: number }>()
  for (const r of pvRows) {
    const prev = map.get(r.hour) ?? { pv: 0, uv: 0 }
    prev.pv += Number(r.pageviews ?? 0)
    map.set(r.hour, prev)
  }
  for (const r of uvRows) {
    const prev = map.get(r.hour) ?? { pv: 0, uv: 0 }
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.hour, prev)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([h, v]) => ({ date: formatHour(h), pageviews: v.pv, visitors: v.uv }))
}

export async function fetchDailyTrendByPage(url: string, dateFilter: DateFilter, appId?: string): Promise<MultiAreaDataPoint[]> {
  interface Row { event_date: string; page_path: string; clicks: number }
  const rows = await safeFetch<Row>(buildClicksPerPageQuery(url, dateFilter), 'dailyTrendByPage', appId)
  // Find top pages
  const totals = new Map<string, number>()
  for (const r of rows) {
    totals.set(r.page_path, (totals.get(r.page_path) ?? 0) + Number(r.clicks ?? 0))
  }
  const topPages = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p)

  const dates = new Map<string, Record<string, number>>()
  for (const r of rows) {
    if (!topPages.includes(r.page_path)) continue
    const entry = dates.get(r.event_date) ?? {}
    entry[r.page_path] = (entry[r.page_path] ?? 0) + Number(r.clicks ?? 0)
    dates.set(r.event_date, entry)
  }
  const zeroPages = () => {
    const z: Record<string, number> = {}
    for (const page of topPages) z[page] = 0
    return z as Omit<MultiAreaDataPoint, 'date'>
  }
  const sorted = [...dates.entries()]
    .map(([d, vals]) => {
      const pt: MultiAreaDataPoint = { date: d }
      for (const page of topPages) {
        pt[page] = vals[page] ?? 0
      }
      return pt
    })
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))
  return padDateRangeForFilter(sorted, dateFilter, zeroPages)
}

export async function fetchHourlyClicksByDevice(url: string, dateFilter: DateFilter, appId?: string): Promise<StackedBarDataPoint[]> {
  interface Row { hour: number; clicks: number; unique_visitors: number }
  const rows = await safeFetch<Row>(buildClicksByHourAllDevicesQuery(url, dateFilter), 'hourlyClicksByDevice', appId)
  // Aggregate across dates by hour
  const map = new Map<number, { clicks: number; uv: number }>()
  for (const r of rows) {
    const prev = map.get(r.hour) ?? { clicks: 0, uv: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    map.set(r.hour, prev)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([h, v]) => ({ date: formatHour(h), clicks: v.clicks, uniqueVisitors: v.uv }))
}

// ─── Device Analytics ───────────────────────────────────

export async function fetchDeviceDistribution(url: string, dateFilter: DateFilter, appId?: string): Promise<ChartDataPoint[]> {
  interface Row { device_type: string; clicks: number }
  const rows = await safeFetch<Row>(buildClicksByElementPerDeviceQuery(url, dateFilter), 'deviceDistribution', appId)
  const agg = sumByKey(rows, 'device_type', 'clicks')
  return [...agg.entries()].map(([d, v]) => ({
    date: d.charAt(0).toUpperCase() + d.slice(1),
    value: v,
  }))
}

export async function fetchDeviceMixOverTime(url: string, dateFilter: DateFilter, appId?: string): Promise<StackedBarDataPoint[]> {
  interface Row {
    event_date?: string
    bucket_from?: string
    bucket_to?: string
    device_type?: string
    clicks?: number
    unique_visitors?: number
  }
  const rows = await safeFetch<Row>(buildClicksByElementPerDeviceQuery(url, dateFilter), 'deviceMixOverTime', appId)

  // Bucketed by_element can return host-level unique_visitors per bucket (no device_type)
  if (isBucketFilter(dateFilter) && rows.length > 0 && rows.every((r) => !r.device_type)) {
    const points = aggregateChartPoints(rows, dateFilter, (r) => Number(r.clicks ?? r.unique_visitors ?? 0))
    return padDateRangeForFilter(
      points.map((p) => ({
        date: p.date,
        ...(p.bucket_from ? { bucket_from: p.bucket_from } : {}),
        laptop: p.value,
        tablet: 0,
        mobile: 0,
      })),
      dateFilter,
      () => ({ laptop: 0, tablet: 0, mobile: 0 }),
    )
  }

  const map = new Map<string, { label: string; bucket_from?: string; devs: Record<string, number> }>()
  for (const r of rows) {
    const key = seriesSortKey(r, dateFilter)
    const prev = map.get(key)
    const devs = prev?.devs ?? {}
    const dev = (r.device_type ?? 'other').toLowerCase()
    devs[dev] = (devs[dev] ?? 0) + Number(r.clicks ?? 0)
    map.set(key, {
      label: prev?.label ?? seriesDisplayDate(r, dateFilter),
      bucket_from: prev?.bucket_from ?? (isBucketFilter(dateFilter) ? r.bucket_from : undefined),
      devs,
    })
  }
  const sorted = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { label, bucket_from, devs }]) => ({
      date: label,
      ...(bucket_from ? { bucket_from } : {}),
      laptop: devs['laptop'] ?? 0,
      tablet: devs['tablet'] ?? 0,
      mobile: devs['mobile'] ?? 0,
    }))
  return padDateRangeForFilter(sorted, dateFilter, () => ({ laptop: 0, tablet: 0, mobile: 0 }))
}

// ─── Detail Tables ──────────────────────────────────────

export async function fetchSessionClickData(url: string, dateFilter: DateFilter, appId?: string): Promise<SessionClickRow[]> {
  interface Row { element_type: string; section: string; clicks: number; sessions_that_clicked: number; clicks_per_session: number }
  const rows = await safeFetch<Row>(buildClicksPerSessionQuery(url, dateFilter), 'sessionClick', appId)
  return rows.map((r) => ({
    element: r.element_type,
    section: r.section,
    clicks: r.clicks,
    sessions: r.sessions_that_clicked,
    cps: r.clicks_per_session,
  })).slice(0, 5)
}

export async function fetchElementClicksBySection(url: string, dateFilter: DateFilter, appId?: string): Promise<StackedBarDataPoint[]> {
  interface Row { element_type: string; section: string; device_type: string; clicks: number }
  const rows = await safeFetch<Row>(buildClicksByElementPerDeviceQuery(url, dateFilter), 'elementClicksBySection', appId)
  // Group by section, split by device
  const map = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const sectionLabel = r.section.charAt(0).toUpperCase() + r.section.slice(1)
    const entry = map.get(sectionLabel) ?? {}
    const dev = r.device_type.toLowerCase()
    entry[dev] = (entry[dev] ?? 0) + Number(r.clicks ?? 0)
    map.set(sectionLabel, entry)
  }
  return [...map.entries()]
    .map(([section, devs]) => ({
      date: section,
      laptop: devs['laptop'] ?? 0,
      tablet: devs['tablet'] ?? 0,
      mobile: devs['mobile'] ?? 0,
    }))
    .sort((a, b) => {
      const totalA = (a.laptop as number) + (a.tablet as number) + (a.mobile as number)
      const totalB = (b.laptop as number) + (b.tablet as number) + (b.mobile as number)
      return totalB - totalA
    })
}

// ─── KPI Extras ─────────────────────────────────────────

export async function fetchKpiExtras(url: string, dateFilter: DateFilter, appId?: string): Promise<KpiExtras> {
  interface SessionRow { total_sessions: number }
  interface BounceRow { bounces: number; bounce_unique_visitors: number }
  interface HourRow { hour: number; clicks: number; unique_visitors: number }
  interface PpsRow { sessions: number; avg_pages_per_session: number }
  interface DurRow { sessions: number; avg_session_duration_sec: number }

  const [sessionRows, bounceRows, hourRows, ppsRows, durRows] = await Promise.all([
    safeFetch<SessionRow>(buildTotalSessionsQuery(url, dateFilter), 'kpi.totalSessions', appId),
    safeFetch<BounceRow>(buildBounceSessionsQuery(url, dateFilter), 'kpi.bounceSessions', appId),
    safeFetch<HourRow>(buildClicksByHourAllDevicesQuery(url, dateFilter), 'kpi.peakHour', appId),
    safeFetch<PpsRow>(buildAvgPagesPerSessionQuery(url, dateFilter), 'kpi.avgPages', appId),
    safeFetch<DurRow>(buildAvgSessionDurationQuery(url, dateFilter), 'kpi.avgDuration', appId),
  ])

  // Total sessions
  const totalSessions = sessionRows.reduce((s, r) => s + Number(r.total_sessions ?? 0), 0)

  // Bounce sessions
  const bounceSessions = bounceRows.reduce((s, r) => s + Number(r.bounces ?? 0), 0)
  const bounceRate = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0

  // Peak hour
  const hourAgg = new Map<number, { clicks: number; uv: number }>()
  for (const r of hourRows) {
    const prev = hourAgg.get(r.hour) ?? { clicks: 0, uv: 0 }
    prev.clicks += Number(r.clicks ?? 0)
    prev.uv += Number(r.unique_visitors ?? 0)
    hourAgg.set(r.hour, prev)
  }
  let peakHour = 0
  let peakClicks = 0
  let peakVisitors = 0
  for (const [h, v] of hourAgg) {
    if (v.clicks > peakClicks) {
      peakHour = h
      peakClicks = v.clicks
      peakVisitors = v.uv
    }
  }

  // Avg pages per session (weighted avg)
  let totalPpsSessions = 0
  let weightedPages = 0
  for (const r of ppsRows) {
    totalPpsSessions += r.sessions
    weightedPages += r.sessions * r.avg_pages_per_session
  }
  const avgPps = totalPpsSessions > 0 ? Math.round((weightedPages / totalPpsSessions) * 10) / 10 : 0

  // Avg session duration (weighted avg, format as "Xm Ys")
  let totalDurSessions = 0
  let weightedDuration = 0
  for (const r of durRows) {
    totalDurSessions += r.sessions
    weightedDuration += r.sessions * r.avg_session_duration_sec
  }
  const avgDurSec = totalDurSessions > 0 ? Math.round(weightedDuration / totalDurSessions) : 0
  const durMin = Math.floor(avgDurSec / 60)
  const durSec = avgDurSec % 60
  const avgSessionDuration = `${durMin}m ${durSec}s`

  return {
    totalSessions,
    bounceSessions,
    bounceRate: `${bounceRate}%`,
    peakHour: formatHour(peakHour),
    peakHourClicks: peakClicks,
    peakHourVisitors: peakVisitors,
    avgPagesPerSession: avgPps,
    avgSessionDuration,
  }
}

// ─── Activity (Raw Page Views) ──────────────────────────

/**
 * For each event_date, return the country with the highest session count.
 * Used to enrich raw page-view activity rows with geographic context.
 */
export async function fetchTopCountryByDate(url: string, dateFilter: DateFilter, appId?: string): Promise<Map<string, string>> {
  interface Row { event_date: string; country: string; sessions: number }
  const rows = await safeFetch<Row>(buildCountryTrafficQuery(url, dateFilter), 'topCountryByDate', appId)
  const dateMap = new Map<string, { country: string; sessions: number }>()
  for (const r of rows) {
    const current = dateMap.get(r.event_date)
    if (!current || r.sessions > current.sessions) {
      dateMap.set(r.event_date, { country: r.country, sessions: r.sessions })
    }
  }
  const result = new Map<string, string>()
  for (const [date, { country }] of dateMap) {
    result.set(date, resolveCountryName(country))
  }
  return result
}

/**
 * For each event_date, return the browser with the highest session count.
 * Used to enrich raw page-view activity rows with browser context.
 */
export async function fetchTopBrowserByDate(url: string, dateFilter: DateFilter, appId?: string): Promise<Map<string, string>> {
  interface Row { event_date: string; browser: string; sessions: number }
  const rows = await safeFetch<Row>(buildBrowsersForVisitorsQuery(url, dateFilter), 'topBrowserByDate', appId)
  const dateMap = new Map<string, { browser: string; sessions: number }>()
  for (const r of rows) {
    const current = dateMap.get(r.event_date)
    if (!current || r.sessions > current.sessions) {
      dateMap.set(r.event_date, { browser: r.browser, sessions: r.sessions })
    }
  }
  const result = new Map<string, string>()
  for (const [date, { browser }] of dateMap) {
    result.set(date, browser)
  }
  return result
}

export async function fetchRawPageViews(url: string, dateFilter: DateFilter, appId?: string): Promise<ActivityHitRow[]> {
  // Use airobuilder_raw_page_views which returns mixed record types.
  // We prefer rows with record_type === 'page_stats' (per-path + device_type + unique_visitors),
  // but fall back to any row with a non-empty page_path if page_stats rows are absent.
  interface Row {
    record_type?: string
    event_date?: string
    page_path?: string
    views?: number
    page_views?: number
    unique_visitors?: number
    device_type?: string
    referrer?: string
    source?: string
  }
  const rows = await safeFetch<Row>(buildRawPageViewsQuery(url, dateFilter), 'activityHitsByPath', appId)

  // Log record types for debugging
  const typeCounts = new Map<string, number>()
  for (const r of rows) {
    const rt = r.record_type ?? '(none)'
    typeCounts.set(rt, (typeCounts.get(rt) ?? 0) + 1)
  }
  logger.debug('analytics.clickhouse.rawPageViews.recordTypes', {
    total: rows.length,
    types: Object.fromEntries(typeCounts),
  })

  // Try page_stats rows first (richest data: device_type + unique_visitors)
  let filtered = rows.filter((r) => r.record_type === 'page_stats' && r.page_path)

  // Fall back: any row with a page_path (could be host_stats, page_views, etc.)
  if (filtered.length === 0) {
    filtered = rows.filter((r) => r.page_path)
  }

  // Last resort: use all rows
  if (filtered.length === 0) {
    filtered = rows
  }

  return filtered
    .map((r) => ({
      date: r.event_date || '',
      pagePath: r.page_path || '/',
      device: r.device_type || '',
      referrer: r.referrer || r.source || '',
      views: r.views ?? r.page_views ?? 0,
      uniqueVisitors: Number(r.unique_visitors ?? 0),
      country: '',
      browser: '',
    }))
    // Expand aggregated rows: if a row has views > 1, repeat it so the table
    // shows more granular "hit" entries (capped at 3 repeats per source row)
    .flatMap((r) => {
      const repeats = Math.min(Math.max(1, Math.ceil(r.views / 2)), 3)
      return Array.from({ length: repeats }, () => r)
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.views - a.views)
    .slice(0, 20)
}

// ─── Top-level orchestrator ─────────────────────────────

/**
 * Fetch ALL ClickHouse analytics data in parallel.
 *
 * Results are returned as a plain object keyed by the same names used in
 * mock-analytics-data.ts so RUM.tsx can swap them with no chart changes.
 */
/**
 * Run an array of async thunks in batches to stay within the browser's
 * per-origin connection limit (typically 6). Batching prevents later
 * requests from queueing behind earlier ones and timing out.
 */
async function runBatched<T>(thunks: Array<() => Promise<T>>, batchSize = 8): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < thunks.length; i += batchSize) {
    const batch = thunks.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map((fn) => fn()))
    results.push(...batchResults)
  }
  return results
}

export async function fetchAllClickhouseAnalytics(
  url: string,
  selection: AnalyticsDateSelection,
  appId?: string,
) {
  const trafficFilter = trafficDateFilter(selection)
  const aggregateFilter = aggregateDateFilter(selection)

  // Build list of named fetch thunks. Order matters — indices map to variable names.
  const thunks: Array<() => Promise<unknown>> = [
    /* 0  */ () => fetchPageViewsPerHost(url, trafficFilter, appId),
    /* 1  */ () => fetchPageViewsByPath(url, aggregateFilter, appId),
    /* 2  */ () => fetchUniqueVisitorsByPage(url, aggregateFilter, appId),
    /* 3  */ () => fetchPageActivityShare(url, aggregateFilter, appId),
    /* 4  */ () => fetchClickTrends(url, aggregateFilter, appId),
    /* 5  */ () => fetchClicksByElement(url, aggregateFilter, appId),
    /* 6  */ () => fetchClicksPerPage(url, aggregateFilter, appId),
    /* 7  */ () => fetchClickActivityShare(url, aggregateFilter, appId),
    /* 8  */ () => fetchExitRate(url, aggregateFilter, appId),
    /* 9  */ () => fetchNewVsReturning(url, trafficFilter, appId),
    /* 10 */ () => fetchBrowserSessions(url, aggregateFilter, appId),
    /* 11 */ () => fetchSessionsByDevice(url, aggregateFilter, appId),
    /* 12 */ () => fetchCountryTraffic(url, aggregateFilter, appId),
    /* 13 */ () => fetchCityTraffic(url, aggregateFilter, appId),
    /* 14 */ () => fetchPageTransitions(url, aggregateFilter, appId),
    /* 15 */ () => fetchTopReferrers(url, aggregateFilter, appId),
    /* 16 */ () => fetchReferrerLandingDetail(url, aggregateFilter, appId),
    /* 17 */ () => fetchTopCTALabels(url, aggregateFilter, appId),
    /* 18 */ () => fetchElementSectionData(url, aggregateFilter, appId),
    /* 19 */ () => fetchAvgClicksPerSession(url, aggregateFilter, appId),
    /* 20 */ () => fetchClicksByHour(url, aggregateFilter, appId),
    /* 21 */ () => fetchHourlyPageviewVisitor(url, aggregateFilter, appId),
    /* 22 */ () => fetchDailyTrendByPage(url, aggregateFilter, appId),
    /* 23 */ () => fetchHourlyClicksByDevice(url, aggregateFilter, appId),
    /* 24 */ () => fetchDeviceDistribution(url, aggregateFilter, appId),
    /* 25 */ () => fetchDeviceMixOverTime(url, trafficFilter, appId),
    /* 26 */ () => fetchSessionClickData(url, aggregateFilter, appId),
    /* 27 */ () => fetchElementClicksBySection(url, aggregateFilter, appId),
    /* 28 */ () => fetchKpiExtras(url, aggregateFilter, appId),
    /* 29 */ () => fetchRawPageViews(url, aggregateFilter, appId),
    /* 30 */ () => fetchTopCountryByDate(url, aggregateFilter, appId),
    /* 31 */ () => fetchTopBrowserByDate(url, aggregateFilter, appId),
    /* 32 */ () => fetchCountryTrafficWithCode(url, aggregateFilter, appId),
    /* 33 */ () => fetchBrowserTrendsOverTime(url, trafficFilter, appId),
    /* 34 */ () => fetchUniqueVisitorsPerHost(url, trafficFilter, appId),
    /* 35 */ () => fetchTotalSessionsDaily(url, trafficFilter, appId),
    /* 36 */ () => fetchCityTrafficWithCountry(url, aggregateFilter, appId),
  ]

  // Run in batches of 8 to avoid saturating the browser connection pool
  const results = await runBatched(thunks, 8)

  let hostPageViews = results[0] as { totalPageViews: number; dailyPageViews: ChartDataPoint[] }
  const pageViewsByPathData = results[1] as ChartDataPoint[]
  const uniqueVisitorsByPageData = results[2] as ChartDataPoint[]
  const pageActivityShareData = results[3] as ChartDataPoint[]
  const clickTrendsData = results[4] as ChartDataPoint[]
  const clicksByElementData = results[5] as ChartDataPoint[]
  const clicksPerPageData = results[6] as ChartDataPoint[]
  const clickActivityShareData = results[7] as ChartDataPoint[]
  const exitRateData = results[8] as ComposedDataPoint[]
  const newVsReturningData = results[9] as StackedBarDataPoint[]
  const browserSessionsData = results[10] as MultiAreaDataPoint[]
  const sessionsByDeviceData = results[11] as ChartDataPoint[]
  const countryTrafficData = results[12] as DualSeriesDataPoint[]
  const cityTrafficData = results[13] as DualSeriesDataPoint[]
  const pageTransitionsTableData = results[14] as TableDataPoint[]
  const topReferrersData = results[15] as DualSeriesDataPoint[]
  const referrerLandingDetailData = results[16] as ReferrerLandingRow[]
  const topCTALabelsData = results[17] as DualSeriesDataPoint[]
  const elementSectionData = results[18] as DualSeriesDataPoint[]
  const avgClicksPerSessionData = results[19] as ComposedDataPoint[]
  const clicksByHourData = results[20] as DualSeriesDataPoint[]
  const hourlyPageviewVisitorData = results[21] as MultiAreaDataPoint[]
  const dailyTrendByPageData = results[22] as MultiAreaDataPoint[]
  const hourlyClicksByDeviceData = results[23] as StackedBarDataPoint[]
  const deviceDistributionData = results[24] as ChartDataPoint[]
  const deviceMixOverTimeData = results[25] as StackedBarDataPoint[]
  const sessionClickData = results[26] as SessionClickRow[]
  const elementClicksBySectionData = results[27] as StackedBarDataPoint[]
  const kpiExtras = results[28] as KpiExtras
  const rawActivityHits = results[29] as ActivityHitRow[]
  const topCountryByDate = results[30] as Map<string, string>
  const topBrowserByDate = results[31] as Map<string, string>
  const countryTrafficWithCodeData = results[32] as CountryTrafficWithCodeRow[]
  const browserTrendsOverTimeData = results[33] as MultiAreaDataPoint[]
  let hostUniqueVisitors = results[34] as { totalUniqueVisitors: number; dailyUniqueVisitors: ChartDataPoint[] }
  let dailyTotalSessions = results[35] as ChartDataPoint[]
  const cityTrafficWithCountryData = results[36] as CityTrafficWithCountryRow[]

  // Custom ranges >30 days use weekly buckets for charts. Overview KPIs always use the
  // daily aggregate queries — bucket rows often omit host_views or pad to zero on the UI.
  if (isBucketFilter(trafficFilter)) {
    const [pvDaily, uvDaily, sessionsDaily] = await Promise.all([
      fetchPageViewsPerHost(url, aggregateFilter, appId),
      fetchUniqueVisitorsPerHost(url, aggregateFilter, appId),
      fetchTotalSessionsDaily(url, aggregateFilter, appId),
    ])
    hostPageViews = {
      totalPageViews: pvDaily.totalPageViews,
      dailyPageViews: seriesHasPositiveValues(hostPageViews.dailyPageViews)
        ? hostPageViews.dailyPageViews
        : pvDaily.dailyPageViews,
    }
    hostUniqueVisitors = {
      totalUniqueVisitors: uvDaily.totalUniqueVisitors,
      dailyUniqueVisitors: seriesHasPositiveValues(hostUniqueVisitors.dailyUniqueVisitors)
        ? hostUniqueVisitors.dailyUniqueVisitors
        : uvDaily.dailyUniqueVisitors,
    }
    if (!seriesHasPositiveValues(dailyTotalSessions)) {
      dailyTotalSessions = sessionsDaily
    }
    logger.info('analytics.clickhouse.bucket-kpi-fallback', {
      bucketPageViews: (results[0] as { totalPageViews: number }).totalPageViews,
      dailyPageViews: pvDaily.totalPageViews,
      dailyVisitors: uvDaily.totalUniqueVisitors,
      dailySessions: sessionsDaily.reduce((s, d) => s + Number(d.value ?? 0), 0),
    })
  }

  // Enrich activity hits with per-date top country and browser
  const activityHitsData = rawActivityHits.map((hit) => ({
    ...hit,
    country: topCountryByDate instanceof Map ? (topCountryByDate.get(hit.date) || '') : '',
    browser: topBrowserByDate instanceof Map ? (topBrowserByDate.get(hit.date) || '') : '',
  }))

  // CTA performance reuses the same data as topCTALabels — kept only for logging

  // Log summary of which datasets have data vs empty for debugging
  const dataNames: Array<[string, unknown[]]> = [
    ['pageViewsByPath', pageViewsByPathData],
    ['uniqueVisitorsByPage', uniqueVisitorsByPageData],
    ['pageActivityShare', pageActivityShareData],
    ['clickTrends', clickTrendsData],
    ['clicksByElement', clicksByElementData],
    ['clicksPerPage', clicksPerPageData],
    ['clickActivityShare', clickActivityShareData],
    ['exitRate', exitRateData],
    ['newVsReturning', newVsReturningData],
    ['browserSessions', browserSessionsData],
    ['sessionsByDevice', sessionsByDeviceData],
    ['countryTraffic', countryTrafficData],
    ['cityTraffic', cityTrafficData],
    ['pageTransitions', pageTransitionsTableData],
    ['topReferrers', topReferrersData],
    ['referrerLandingDetail', referrerLandingDetailData],
    ['topCTALabels', topCTALabelsData],
    ['elementSection', elementSectionData],
    ['avgClicksPerSession', avgClicksPerSessionData],
    ['clicksByHour', clicksByHourData],
    ['hourlyPageviewVisitor', hourlyPageviewVisitorData],
    ['dailyTrendByPage', dailyTrendByPageData],
    ['hourlyClicksByDevice', hourlyClicksByDeviceData],
    ['deviceDistribution', deviceDistributionData],
    ['deviceMixOverTime', deviceMixOverTimeData],
    ['sessionClick', sessionClickData],
    ['elementClicksBySection', elementClicksBySectionData],
    ['activityHits', activityHitsData],
    ['browserTrendsOverTime', browserTrendsOverTimeData],
    ['dailyTotalSessions', dailyTotalSessions],
    ['dailyUniqueVisitors', hostUniqueVisitors.dailyUniqueVisitors],
  ]
  const emptyNames = dataNames.filter(([, arr]) => Array.isArray(arr) && arr.length === 0).map(([n]) => n)
  if (emptyNames.length > 0) {
    logger.warn('analytics.clickhouse.empty-datasets', {
      emptyCount: emptyNames.length,
      totalCount: dataNames.length,
      emptyDatasets: emptyNames,
    })
  }

  return {
    totalHostPageViews: hostPageViews.totalPageViews,
    // Use airobuilder_unique_visitors_per_host for accurate visitor count
    totalHostUniqueVisitors: hostUniqueVisitors.totalUniqueVisitors,
    dailyHostPageViews: hostPageViews.dailyPageViews,
    // Daily unique visitors from airobuilder_unique_visitors_per_host
    dailyUniqueVisitors: hostUniqueVisitors.dailyUniqueVisitors,
    // Daily total sessions from airobuilder_total_sessions (true session count)
    dailyTotalSessions,
    pageViewsByPathData,
    uniqueVisitorsByPageData,
    pageActivityShareData,
    clickTrendsData,
    clicksByElementData,
    clicksPerPageData,
    clickActivityShareData,
    exitRateData,
    newVsReturningData,
    browserSessionsData,
    sessionsByDeviceData,
    countryTrafficData,
    cityTrafficData,
    pageTransitionsTableData,
    topReferrersData,
    referrerLandingDetailData,
    topCTALabelsData,
    elementSectionData,
    avgClicksPerSessionData,
    clicksByHourData,
    hourlyPageviewVisitorData,
    dailyTrendByPageData,
    hourlyClicksByDeviceData,
    deviceDistributionData,
    deviceMixOverTimeData,
    sessionClickData,
    elementClicksBySectionData,
    kpiExtras,
    activityHitsData,
    countryTrafficWithCodeData,
    browserTrendsOverTimeData,
    cityTrafficWithCountryData,
  }
}
