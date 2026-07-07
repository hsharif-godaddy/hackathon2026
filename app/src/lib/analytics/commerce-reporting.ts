import { appFetch } from '@/lib/gasket-config'
import {
  type AnalyticsDateSelection,
  resolveAnalyticsDateRange,
} from '@/lib/insights/clickhouse-queries'

export interface ReportingFilter {
  field: string
  operation: string
  value: unknown
}

export interface ReportingDataRequest {
  appId: string
  storeId: string
  datasheet: string
  fields: string[]
  startTime: string
  endTime: string
  filters?: ReportingFilter[]
  interval?: string
  tz?: string
  limit?: number
}

export interface ReportingCubeRequest {
  appId: string
  storeId: string
  query: Record<string, unknown>
}

export interface ReportingPagination {
  first: number
  after?: string
}

export interface ReportingPageInfo {
  hasNextPage: boolean
  hasPreviousPage?: boolean
  startCursor?: string | null
  endCursor?: string | null
}

const ORDERS_TIME_SERIES_DATASHEET = 'ordersTimeSeries'
const ORDERS_TIME_SERIES_COUNT_FIELD = 'count'
const ORDERS_TIME_SERIES_SUM_TOTAL_FIELD = 'sumTotal'
const ORDERS_TIME_SERIES_INTERVAL = 'daily'
const ORDERS_TIME_SERIES_TIMEZONE = 'UTC'

export interface ChartPoint {
  date: string
  value: number
}

export interface BusinessAnalyticsMetrics {
  totalRevenue: number
  orderCountOverTime: ChartPoint[]
  revenueOverTime: ChartPoint[]
}

const REPORTING_ROW_LIMIT = 10_000
const REPORTING_MAX_PAGES = 100

export function toMajorAmount(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : 0
  if (!Number.isFinite(value)) return 0
  return value / 100
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function emptyDailySeries(start: Date, end: Date): Map<string, number> {
  const buckets = new Map<string, number>()
  let cursor = startOfUtcDay(start)
  const endDay = startOfUtcDay(end)
  while (cursor.getTime() <= endDay.getTime()) {
    buckets.set(formatDayKey(cursor), 0)
    cursor = addUtcDays(cursor, 1)
  }
  return buckets
}

function ordersTimeSeriesDayKey(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  return raw.slice(0, 10)
}

function datasheetNumericValue(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : 0
  return Number.isFinite(value) ? value : 0
}

function mapToChartSeries(byDate: Map<string, number>): ChartPoint[] {
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }))
}

function parseOrdersTimeSeriesRows(
  rows: unknown[],
  start: Date,
  end: Date,
): {
  orderCountOverTime: ChartPoint[]
  revenueOverTime: ChartPoint[]
} {
  const orderCountByDate = emptyDailySeries(start, end)
  const revenueByDate = emptyDailySeries(start, end)

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const dateKey = ordersTimeSeriesDayKey(record.timeIntervalStart)
    if (!dateKey) continue
    if (orderCountByDate.has(dateKey)) {
      orderCountByDate.set(dateKey, datasheetNumericValue(record[ORDERS_TIME_SERIES_COUNT_FIELD]))
    }
    if (revenueByDate.has(dateKey)) {
      revenueByDate.set(dateKey, toMajorAmount(record[ORDERS_TIME_SERIES_SUM_TOTAL_FIELD]))
    }
  }

  return {
    orderCountOverTime: mapToChartSeries(orderCountByDate),
    revenueOverTime: mapToChartSeries(revenueByDate),
  }
}

export function aggregateBusinessAnalyticsMetrics(input: {
  orderCountOverTime: ChartPoint[]
  revenueOverTime: ChartPoint[]
}): BusinessAnalyticsMetrics {
  return {
    totalRevenue: input.revenueOverTime.reduce((sum, point) => sum + point.value, 0),
    orderCountOverTime: input.orderCountOverTime,
    revenueOverTime: input.revenueOverTime,
  }
}

// Commerce binding and reporting APIs do not expose store currency; USD is the only supported display currency today.
export function formatCommerceCurrency(amount: number, locale = 'en-US', currency = 'USD'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function extractReportingRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.items)) return record.items
  const data = record.data
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)) {
    return (data as { rows: unknown[] }).rows
  }
  return []
}

export function parseReportingPageInfo(payload: unknown): ReportingPageInfo | null {
  if (!payload || typeof payload !== 'object') return null
  const pageInfo = (payload as Record<string, unknown>).pageInfo
  if (!pageInfo || typeof pageInfo !== 'object') return null
  const record = pageInfo as Record<string, unknown>
  if (typeof record.hasNextPage !== 'boolean') return null
  return {
    hasNextPage: record.hasNextPage,
    hasPreviousPage: typeof record.hasPreviousPage === 'boolean' ? record.hasPreviousPage : undefined,
    startCursor: typeof record.startCursor === 'string' ? record.startCursor : null,
    endCursor: typeof record.endCursor === 'string' ? record.endCursor : null,
  }
}

function buildReportingPagination(pageSize: number, after?: string): ReportingPagination {
  return after ? { first: pageSize, after } : { first: pageSize }
}

async function postReportingData(body: Record<string, unknown>): Promise<unknown> {
  const response = await appFetch('/api/commerce/reporting/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      (errorData as { error?: string }).error
      || (errorData as { message?: string }).message
      || 'Failed to fetch commerce reporting data',
    )
  }

  return response.json()
}

async function fetchAllReportingRows(
  buildBody: (after?: string) => Record<string, unknown>,
): Promise<unknown[]> {
  const rows: unknown[] = []
  let after: string | undefined

  for (let page = 0; page < REPORTING_MAX_PAGES; page += 1) {
    const payload = await postReportingData(buildBody(after))
    rows.push(...extractReportingRows(payload))
    const pageInfo = parseReportingPageInfo(payload)
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
    after = pageInfo.endCursor
  }

  return rows
}

export async function fetchReportingDatasheet(request: ReportingDataRequest): Promise<unknown[]> {
  const pageSize = request.limit ?? REPORTING_ROW_LIMIT
  return fetchAllReportingRows(function build(after) {
    const { limit: _limit, ...rest } = request
    return {
      ...rest,
      pagination: buildReportingPagination(pageSize, after),
    }
  })
}

export async function fetchReportingCube(request: ReportingCubeRequest): Promise<unknown[]> {
  return fetchAllReportingRows(function build(after) {
    return {
      appId: request.appId,
      storeId: request.storeId,
      query: request.query,
      pagination: buildReportingPagination(REPORTING_ROW_LIMIT, after),
    }
  })
}

export async function fetchBusinessAnalyticsSourceData(
  appId: string,
  storeId: string,
  dateSelection: AnalyticsDateSelection,
): Promise<{
  orderCountOverTime: ChartPoint[]
  revenueOverTime: ChartPoint[]
}> {
  const now = new Date()
  const { start, end } = resolveAnalyticsDateRange(dateSelection, now)
  const startTime = start.toISOString()
  const endTime = end.toISOString()
  const ordersTimeSeriesRows = await fetchReportingDatasheet({
    appId,
    storeId,
    datasheet: ORDERS_TIME_SERIES_DATASHEET,
    fields: [ORDERS_TIME_SERIES_COUNT_FIELD, ORDERS_TIME_SERIES_SUM_TOTAL_FIELD],
    startTime,
    endTime,
    interval: ORDERS_TIME_SERIES_INTERVAL,
    tz: ORDERS_TIME_SERIES_TIMEZONE,
    filters: [
      { field: 'processedAt', operation: 'gte', value: startTime },
      { field: 'processedAt', operation: 'lte', value: endTime },
    ],
  })

  return parseOrdersTimeSeriesRows(ordersTimeSeriesRows, start, end)
}
