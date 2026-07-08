import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExchangeCustomerJwtForOAuthToken, mockWithCustomerAuth } = vi.hoisted(() => ({
  mockExchangeCustomerJwtForOAuthToken: vi.fn(),
  mockWithCustomerAuth: vi.fn((handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest)
  }),
}))

const mockAuthContext = {
  jwt: 'customer-jwt',
  user: {
    customerId: 'customer-123',
    shopperId: 'shopper-123',
  },
}

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: mockWithCustomerAuth,
}))

vi.mock('@/lib/mcp/token-exchange', () => ({
  exchangeCustomerJwtForOAuthToken: mockExchangeCustomerJwtForOAuthToken,
  TokenExchangeError: class TokenExchangeError extends Error {
    status: number

    constructor(message: string, status = 502) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const ORIGINAL_ENV = { ...process.env }
const storeId = '339b8961-1860-48de-aa55-947634965c7a'

function routeContext(settingPath = ['surface']) {
  return {
    params: Promise.resolve({
      storeId,
      settingPath,
    }),
  }
}

async function proxyGetForApiBase(apiBaseUrl: string) {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV }
  process.env.GODADDY_API_BASE_URL = apiBaseUrl
  delete process.env.GATEWAY_BASE_URL
  delete process.env.COMMERCE_SETTINGS_API_BASE_URL
  delete process.env.SETTINGS_API_BASE_URL
  delete process.env.COMMERCE_SETTINGS_API_LOCAL_TEST_AUTH

  mockExchangeCustomerJwtForOAuthToken.mockResolvedValue({
    accessToken: 'oauth-token',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )

  const { GET } = await import('../route')
  const request = new NextRequest(`https://local.gasket.dev-godaddy.com/api/commerce/settings/${storeId}/surface`)
  const response = await GET(request, routeContext())

  return {
    response,
    fetchUrl: String(vi.mocked(fetch).mock.calls[0]?.[0]),
  }
}

describe('/api/commerce/settings/[storeId] proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...ORIGINAL_ENV }
  })

  it('requires level-3 auth for write handlers while leaving reads on the default auth path', async () => {
    vi.resetModules()

    await import('../route')

    expect(mockWithCustomerAuth).toHaveBeenCalledTimes(3)
    expect(mockWithCustomerAuth.mock.calls.map(([, options]) => options)).toEqual([
      undefined,
      { level: 3 },
      { level: 3 },
    ])
  })

  it('routes local dev settings requests to the dev Settings API', async () => {
    const { response, fetchUrl } = await proxyGetForApiBase('https://api.dev-godaddy.com')

    expect(response.status).toBe(200)
    expect(fetchUrl).toBe(
      `https://settings.commerce.api.dev-godaddy.com/v2/commerce/stores/${storeId}/settings/surface`,
    )
  })

  it('routes test settings requests to the test Settings API', async () => {
    const { response, fetchUrl } = await proxyGetForApiBase('https://api.test-godaddy.com')

    expect(response.status).toBe(200)
    expect(fetchUrl).toBe(
      `https://settings.commerce.api.test-godaddy.com/v2/commerce/stores/${storeId}/settings/surface`,
    )
  })

  it('routes prod settings requests to the godaddy.com Settings API', async () => {
    const { response, fetchUrl } = await proxyGetForApiBase('https://api.godaddy.com')

    expect(response.status).toBe(200)
    expect(fetchUrl).toBe(
      `https://settings.commerce.api.godaddy.com/v2/commerce/stores/${storeId}/settings/surface`,
    )
  })
})
