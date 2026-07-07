import { NextRequest, NextResponse } from 'next/server'

import { getCommerceReportingApiUrl } from '@/lib/analytics/commerce-reporting-config'
import { getControlPlaneAdapter } from '@/lib/control-plane'
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth'
import { logger } from '@/lib/request-context'

export const dynamic = 'force-dynamic'

const UPSTREAM_TIMEOUT_MS = 30_000

interface ReportingFilter {
  field: string
  operation: string
  value: unknown
}

interface ReportingDataBody {
  appId?: unknown
  storeId?: unknown
  datasheet?: unknown
  fields?: unknown
  filters?: unknown
  startTime?: unknown
  endTime?: unknown
  interval?: unknown
  tz?: unknown
  limit?: unknown
  pagination?: unknown
  query?: unknown
}

function isPagination(value: unknown): value is {
  first?: number
  after?: string
  before?: string
  last?: number
} {
  if (!value || typeof value !== 'object') return false
  const pagination = value as Record<string, unknown>
  if (pagination.first !== undefined && typeof pagination.first !== 'number') return false
  if (pagination.after !== undefined && typeof pagination.after !== 'string') return false
  if (pagination.before !== undefined && typeof pagination.before !== 'string') return false
  if (pagination.last !== undefined && typeof pagination.last !== 'number') return false
  return true
}

function resolvePagination(pagination: unknown, limit: unknown): Record<string, unknown> | undefined {
  if (isPagination(pagination)) {
    return {
      ...(typeof pagination.first === 'number' ? { first: pagination.first } : {}),
      ...(typeof pagination.after === 'string' ? { after: pagination.after } : {}),
      ...(typeof pagination.before === 'string' ? { before: pagination.before } : {}),
      ...(typeof pagination.last === 'number' ? { last: pagination.last } : {}),
    }
  }
  if (typeof limit === 'number') {
    return { first: limit }
  }
  return undefined
}

function isFilter(value: unknown): value is ReportingFilter {
  if (!value || typeof value !== 'object') return false
  const filter = value as ReportingFilter
  return typeof filter.field === 'string'
    && typeof filter.operation === 'string'
    && 'value' in filter
}

function summarizeReportingResponse(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  if (Array.isArray(record.data)) summary.dataRowCount = record.data.length
  if (Array.isArray(record.items)) summary.itemCount = record.items.length
  if (typeof record.totalCount === 'number') summary.totalCount = record.totalCount
  return Object.keys(summary).length > 0 ? summary : undefined
}

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  const requestStart = Date.now()
  const bffEndpoint = new URL(request.url).pathname
  let appId: string | undefined
  let storeId: string | undefined

  try {
    const body = (await request.json()) as ReportingDataBody
    const {
      datasheet,
      fields,
      filters,
      startTime,
      endTime,
      interval,
      tz,
      limit,
      pagination,
      query,
    } = body
    appId = typeof body.appId === 'string' ? body.appId : undefined
    storeId = typeof body.storeId === 'string' ? body.storeId : undefined
    const isCubeMode = !!query && typeof query === 'object' && !Array.isArray(query)

    logger.info('commerce.reporting.data.start', {
      bffEndpoint,
      appId,
      storeId,
      mode: isCubeMode ? 'cube' : 'datasheet',
      datasheet: isCubeMode ? undefined : datasheet,
      customerId: authContext.user.customerId,
      hasJwt: !!authContext.jwt,
      jwtLength: authContext.jwt?.length,
      reportingBaseUrl: getCommerceReportingApiUrl(),
    })

    if (!appId) {
      return NextResponse.json({ error: 'appId is required' }, { status: 400 })
    }

    if (!storeId) {
      return NextResponse.json({ error: 'storeId is required' }, { status: 400 })
    }

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 })
    }

    const ownershipStart = Date.now()
    let appOwned = false
    try {
      appOwned = await getControlPlaneAdapter().appExists(appId, authContext.jwt)
    } catch (err) {
      logger.error('commerce.reporting.data.ownershipCheckFailed', {
        appId,
        customerId: authContext.user.customerId,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - ownershipStart,
      })
      return NextResponse.json({ error: 'Ownership check failed' }, { status: 502 })
    }
    logger.debug('commerce.reporting.data.ownershipChecked', {
      appId,
      appOwned,
      durationMs: Date.now() - ownershipStart,
    })
    if (!appOwned) {
      logger.warn('commerce.reporting.appNotFound', {
        appId,
        customerId: authContext.user.customerId,
        skippingForLocalDev: process.env.NODE_ENV === 'development',
      })
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'App not found' }, { status: 404 })
      }
      logger.warn('commerce.reporting.data.bypassingOwnership', {
        appId,
        reason: 'NODE_ENV=development — allowing request to proceed for local testing',
      })
    }

    let payload: Record<string, unknown>

    const paginationPayload = resolvePagination(pagination, limit)

    if (isCubeMode) {
      payload = {
        query,
        format: 'json',
        ...(paginationPayload ? { pagination: paginationPayload } : {}),
      }
    } else {
      if (!datasheet || typeof datasheet !== 'string') {
        return NextResponse.json({ error: 'datasheet is required' }, { status: 400 })
      }

      if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) {
        return NextResponse.json({ error: 'fields is required' }, { status: 400 })
      }

      if (!startTime || typeof startTime !== 'string') {
        return NextResponse.json({ error: 'startTime is required' }, { status: 400 })
      }

      if (!endTime || typeof endTime !== 'string') {
        return NextResponse.json({ error: 'endTime is required' }, { status: 400 })
      }

      const tenantFilter = { field: 'storeId', operation: 'eq', value: storeId }
      const mergedFilters = Array.isArray(filters) && filters.every(isFilter)
        ? [tenantFilter, ...filters.filter((filter) => filter.field !== 'storeId')]
        : [tenantFilter]

      const hasProcessedAtFilter = mergedFilters.some((filter) => filter.field === 'processedAt')
      if (!hasProcessedAtFilter) {
        const hasCreatedAtGte = mergedFilters.some(
          (filter) => filter.field === 'createdAt' && filter.operation === 'gte',
        )
        const hasCreatedAtLte = mergedFilters.some(
          (filter) => filter.field === 'createdAt' && filter.operation === 'lte',
        )
        if (!hasCreatedAtGte) {
          mergedFilters.push({ field: 'createdAt', operation: 'gte', value: startTime })
        }
        if (!hasCreatedAtLte) {
          mergedFilters.push({ field: 'createdAt', operation: 'lte', value: endTime })
        }
      }

      payload = {
        datasheet,
        fields,
        filters: mergedFilters,
        ...(typeof interval === 'string' ? { interval } : {}),
        ...(typeof tz === 'string' ? { tz } : {}),
        ...(paginationPayload ? { pagination: paginationPayload } : {}),
      }
    }

    const upstreamUrl = `${getCommerceReportingApiUrl()}/api/v1/reporting/data`
    logger.debug('commerce.reporting.data.upstreamRequest', {
      bffEndpoint,
      appId,
      storeId,
      upstreamUrl,
      upstreamMethod: 'POST',
      datasheet: isCubeMode ? undefined : datasheet,
      durationMs: Date.now() - requestStart,
    })

    const upstreamStart = Date.now()
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `sso-jwt ${authContext.jwt}`,
        'x-store-id': storeId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    logger.debug('commerce.reporting.data.upstreamResponse', {
      bffEndpoint,
      appId,
      storeId,
      upstreamUrl,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - upstreamStart,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => { responseHeaders[k] = v })
      logger.error('commerce.reporting.data.upstreamError', {
        bffEndpoint,
        appId,
        storeId,
        datasheet: isCubeMode ? undefined : datasheet,
        upstreamUrl,
        upstreamMethod: 'POST',
        status: response.status,
        statusText: response.statusText,
        errorText: errorText.slice(0, 2000),
        responseHeaders,
        durationMs: Date.now() - requestStart,
      })
      return NextResponse.json(
        { error: 'Commerce reporting request failed', upstream: { status: response.status, detail: errorText.slice(0, 500) } },
        { status: response.status },
      )
    }

    const data = await response.json()

    logger.info('commerce.reporting.data.success', {
      bffEndpoint,
      appId,
      storeId,
      upstreamUrl,
      responseSummary: summarizeReportingResponse(data),
      durationMs: Date.now() - requestStart,
    })

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    const isTimeout = error instanceof Error
      && (error.name === 'TimeoutError' || error.name === 'AbortError')
    logger.error(isTimeout ? 'commerce.reporting.data.timeout' : 'commerce.reporting.data.error', {
      bffEndpoint,
      appId,
      storeId,
      errorName: error instanceof Error ? error.name : undefined,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      causeCode: error instanceof Error && error.cause && typeof (error.cause as NodeJS.ErrnoException).code === 'string'
        ? (error.cause as NodeJS.ErrnoException).code
        : undefined,
      durationMs: Date.now() - requestStart,
      timeoutMs: isTimeout ? UPSTREAM_TIMEOUT_MS : undefined,
      reportingBaseUrl: getCommerceReportingApiUrl(),
    })
    return NextResponse.json({
      error: 'Internal server error',
      detail: error instanceof Error ? error.message : String(error),
      errorType: isTimeout ? 'timeout' : 'network',
    }, { status: 500 })
  }
}, { level: 3 })
