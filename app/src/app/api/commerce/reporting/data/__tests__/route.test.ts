import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCustomer,
  mockAppExists,
} = vi.hoisted(() => ({
  mockAuthenticateCustomer: vi.fn(),
  mockAppExists: vi.fn(),
}))

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth')
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler: any) => {
      return async (request: NextRequest, ...rest: any[]) => {
        const authContext = await mockAuthenticateCustomer(request)
        if (!authContext.isAuthenticated) {
          return new Response(JSON.stringify({ error: authContext.error }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }
        return handler(request, authContext, ...rest)
      }
    }),
  }
})

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/analytics/commerce-reporting-config', () => ({
  getCommerceReportingApiUrl: () => 'https://reporting.commerce.dev-godaddy.com',
}))

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function adapter() {
    return { appExists: mockAppExists }
  }),
}))

async function getRouteHandler() {
  const { POST } = await import('../route')
  return POST as (req: NextRequest) => Promise<Response>
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/commerce/reporting/data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTHED = {
  isAuthenticated: true,
  user: { shopperId: 'shop-1', customerId: 'cust-1', accountId: 'acct-1' },
  jwt: 'customer-jwt',
}

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

describe('POST /api/commerce/reporting/data', function routeTests() {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    mockAppExists.mockResolvedValue(true)
    global.fetch = vi.fn()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    global.fetch = ORIGINAL_FETCH
  })

  it('rejects unauthenticated requests', async function unauthenticated() {
    mockAuthenticateCustomer.mockResolvedValue({
      isAuthenticated: false,
      error: 'Unauthorized',
    })
    const POST = await getRouteHandler()
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(401)
  })

  it('validates required request fields', async function validation() {
    const POST = await getRouteHandler()

    const missingDatasheet = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
    }))
    expect(missingDatasheet.status).toBe(400)
    expect(await missingDatasheet.json()).toEqual({ error: 'datasheet is required' })

    const missingFields = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
    }))
    expect(missingFields.status).toBe(400)
    expect(await missingFields.json()).toEqual({ error: 'fields is required' })

    const missingStartTime = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      endTime: '2026-06-10T00:00:00.000Z',
    }))
    expect(missingStartTime.status).toBe(400)
    expect(await missingStartTime.json()).toEqual({ error: 'startTime is required' })

    const emptyStartTime = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '',
      endTime: '2026-06-10T00:00:00.000Z',
    }))
    expect(emptyStartTime.status).toBe(400)
    expect(await emptyStartTime.json()).toEqual({ error: 'startTime is required' })

    const missingEndTime = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
    }))
    expect(missingEndTime.status).toBe(400)
    expect(await missingEndTime.json()).toEqual({ error: 'endTime is required' })

    const emptyEndTime = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '',
    }))
    expect(emptyEndTime.status).toBe(400)
    expect(await emptyEndTime.json()).toEqual({ error: 'endTime is required' })
  })

  it('requires appId and storeId', async function ids() {
    const POST = await getRouteHandler()

    const missingAppId = await POST(makeRequest({ storeId: 'store-1' }))
    expect(missingAppId.status).toBe(400)
    expect(await missingAppId.json()).toEqual({ error: 'appId is required' })

    const missingStoreId = await POST(makeRequest({ appId: 'app-1' }))
    expect(missingStoreId.status).toBe(400)
    expect(await missingStoreId.json()).toEqual({ error: 'storeId is required' })
  })

  it('requires authentication token when JWT is missing', async function missingJwt() {
    mockAuthenticateCustomer.mockResolvedValue({
      isAuthenticated: true,
      user: { shopperId: 'shop-1', customerId: 'cust-1', accountId: 'acct-1' },
      jwt: undefined,
    })

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication token required' })
  })

  it('rejects requests for apps the customer does not own', async function appOwnership() {
    mockAppExists.mockResolvedValue(false)

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-not-mine',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
    }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'App not found' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns 502 when ownership check throws', async function ownershipInfraFailure() {
    mockAppExists.mockRejectedValue(new Error('control plane unavailable'))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
    }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Ownership check failed' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('propagates upstream non-ok status', async function upstreamError() {
    vi.mocked(global.fetch).mockResolvedValue(new Response('upstream failure', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    }))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
    }))

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toMatchObject({ error: 'Commerce reporting request failed' })
    expect(body.upstream).toMatchObject({ status: 502 })
    expect(body.upstream.detail).toBeDefined()
  })

  it('returns 500 when upstream fetch times out', async function fetchTimeout() {
    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError')
    vi.mocked(global.fetch).mockRejectedValue(timeoutError)

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
    }))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: 'Internal server error',
      detail: 'The operation timed out.',
      errorType: 'timeout',
    })
  })

  it('returns 500 when upstream fetch rejects', async function fetchRejection() {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network failure'))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
    }))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: 'Internal server error',
      detail: 'network failure',
      errorType: 'network',
    })
  })

  it('proxies reporting requests with tenant filter and sso-jwt auth', async function proxy() {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'pay-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'payments',
      fields: ['id', 'totalAmount'],
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
      pagination: { first: 100, after: 'cursor-1' },
    }))

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://reporting.commerce.dev-godaddy.com/api/v1/reporting/data')
    expect(init.headers).toMatchObject({
      Authorization: 'sso-jwt customer-jwt',
      'x-store-id': 'store-1',
    })

    const body = JSON.parse(String(init.body))
    expect(body.filters).toEqual([
      { field: 'storeId', operation: 'eq', value: 'store-1' },
      { field: 'createdAt', operation: 'gte', value: '2026-01-01T00:00:00.000Z' },
      { field: 'createdAt', operation: 'lte', value: '2026-06-10T00:00:00.000Z' },
    ])
    expect(body.pagination).toEqual({ first: 100, after: 'cursor-1' })
    expect(body.datasheet).toBe('payments')
    expect(body.startTime).toBeUndefined()
    expect(body.endTime).toBeUndefined()
    expect(body.limit).toBeUndefined()
  })

  it('proxies ordersTimeSeries with processedAt filters, interval, and tz', async function ordersTimeSeries() {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      items: [{ timeIntervalStart: '2026-06-03T00:00:00.000Z', count: 1, sumTotal: 9900 }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      datasheet: 'ordersTimeSeries',
      fields: ['count', 'sumTotal'],
      startTime: '2026-06-01T00:00:00.000Z',
      endTime: '2026-06-10T00:00:00.000Z',
      interval: 'daily',
      tz: 'UTC',
      filters: [
        { field: 'processedAt', operation: 'gte', value: '2026-06-01T00:00:00.000Z' },
        { field: 'processedAt', operation: 'lte', value: '2026-06-10T00:00:00.000Z' },
      ],
    }))

    expect(response.status).toBe(200)
    const body = JSON.parse(String((vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.datasheet).toBe('ordersTimeSeries')
    expect(body.interval).toBe('daily')
    expect(body.tz).toBe('UTC')
    expect(body.filters).toEqual([
      { field: 'storeId', operation: 'eq', value: 'store-1' },
      { field: 'processedAt', operation: 'gte', value: '2026-06-01T00:00:00.000Z' },
      { field: 'processedAt', operation: 'lte', value: '2026-06-10T00:00:00.000Z' },
    ])
    expect(body.filters.some((filter: { field: string }) => filter.field === 'createdAt')).toBe(false)
  })

  it('proxies cube queries without datasheet fields', async function cube() {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      data: [{ 'pgOrders.createdAt.day': '2026-06-10T00:00:00.000', 'pgOrders.count': '4' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      query: {
        measures: ['pgOrders.count'],
        timeDimensions: [{
          dimension: 'pgOrders.createdAt',
          granularity: 'day',
        }],
      },
    }))

    expect(response.status).toBe(200)
    const body = JSON.parse(String((vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.query.measures).toEqual(['pgOrders.count'])
    expect(body.format).toBe('json')
    expect(body.datasheet).toBeUndefined()
    expect(body.pagination).toBeUndefined()
  })

  it('maps legacy limit to pagination for cube queries', async function cubeLimit() {
    vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({
      items: [{ 'pgOrders.count': '1' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const POST = await getRouteHandler()
    const response = await POST(makeRequest({
      appId: 'app-1',
      storeId: 'store-1',
      limit: 50,
      query: {
        measures: ['pgOrders.count'],
      },
    }))

    expect(response.status).toBe(200)
    const body = JSON.parse(String((vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.pagination).toEqual({ first: 50 })
  })
})
