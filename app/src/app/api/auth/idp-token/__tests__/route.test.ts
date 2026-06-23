import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '../route'

const { mockAuthenticateCustomer, mockControlPlaneAdapter, mockJWTService, mockLogger, mockFetch, mockCheckSwitchboardFlag } =
  vi.hoisted(function setup() {
    return {
      mockAuthenticateCustomer: vi.fn(),
      mockControlPlaneAdapter: { getSite: vi.fn() },
      mockJWTService: { getToken: vi.fn() },
      mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mockFetch: vi.fn(),
      mockCheckSwitchboardFlag: vi.fn(),
    }
  })

vi.mock('@/lib/customer-auth', async function mockCustomerAuthModule() {
  const actual = await vi.importActual('@/lib/customer-auth')
  return {
    ...actual,
    withCustomerAuth: vi.fn(function withCustomerAuth(handler) {
      return async function wrappedHandler(request: NextRequest, ...args: unknown[]) {
        const authContext = await mockAuthenticateCustomer(request)
        if (!authContext.isAuthenticated) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized', requiresAuth: true }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return handler(request, authContext, ...args)
      }
    }),
  }
})

vi.mock('@/lib/control-plane', function mockControlPlaneModule() {
  return {
    getControlPlaneAdapter: vi.fn().mockReturnValue(mockControlPlaneAdapter),
  }
})

vi.mock('@/lib/jwt-service', function mockJWTServiceModule() {
  return {
    getJWTService: vi.fn().mockReturnValue(mockJWTService),
  }
})

vi.mock('@/lib/request-context', function mockRequestContextModule() {
  return {
    logger: mockLogger,
  }
})

vi.mock('@/lib/switchboard/server', function mockSwitchboardModule() {
  return {
    checkSwitchboardFlag: mockCheckSwitchboardFlag,
  }
})

const MOCK_APP_ID = 'testapp001'
const MOCK_CONV_ID = 'conv-abc123'
const MOCK_AGENT_URL = 'https://agent-001.example.internal'
const MOCK_IDP_TOKEN = 'gd-sso-jwt-idp-token'
const MOCK_AGENT_TOKEN = 'agents-service-jwt'
const MOCK_USER = { customerId: 'cust-123', authType: 'basic' as const, isE2S: false }

function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/idp-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockAgentsResponse(ok: boolean, status: number, bodyText = ''): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(bodyText),
  } as unknown as Response
}

describe('idp-token BFF route', function idpTokenRouteTests() {
  describe('#POST', function postTests() {
    beforeEach(function setup() {
      vi.clearAllMocks()
      vi.stubGlobal('fetch', mockFetch)

      mockCheckSwitchboardFlag.mockResolvedValue(true)
      mockAuthenticateCustomer.mockResolvedValue({
        isAuthenticated: true,
        user: MOCK_USER,
        jwt: MOCK_IDP_TOKEN,
      })
      mockControlPlaneAdapter.getSite.mockResolvedValue({ agent_url: MOCK_AGENT_URL })
      mockJWTService.getToken.mockResolvedValue({ token: MOCK_AGENT_TOKEN })
      mockFetch.mockResolvedValue(mockAgentsResponse(true, 200))
    })

    afterEach(function teardown() {
      vi.unstubAllGlobals()
    })

    it('returns 403 when airo-builder-care-agent-enabled flag is disabled', async function flagDisabled() {
      mockCheckSwitchboardFlag.mockResolvedValue(false)
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(403)
      expect(data.error).toBe('Feature not enabled')
      expect(mockControlPlaneAdapter.getSite).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns 403 when checkSwitchboardFlag throws', async function flagThrows() {
      mockCheckSwitchboardFlag.mockRejectedValue(new Error('Switchboard unavailable'))
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(403)
      expect(data.error).toBe('Feature not enabled')
      expect(mockControlPlaneAdapter.getSite).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns 403 when Origin header is malformed (URL constructor throws)', async function malformedOrigin() {
      const request = new NextRequest('http://localhost:3000/api/auth/idp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'not-a-url' },
        body: JSON.stringify({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }),
      })
      const res = await POST(request)
      expect(res.status).toBe(403)
    })

    it('returns 403 when Origin header does not match host', async function crossOriginForbidden() {
      const request = new NextRequest('http://localhost:3000/api/auth/idp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://evil.example.com' },
        body: JSON.stringify({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }),
      })
      const res = await POST(request)
      expect(res.status).toBe(403)
    })

    it('allows request when Origin matches host', async function sameOriginAllowed() {
      const request = new NextRequest('http://localhost:3000/api/auth/idp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' },
        body: JSON.stringify({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }),
      })
      const res = await POST(request)
      expect(res.status).toBe(200)
    })

    it('allows request when Origin header is absent (server-to-server)', async function noOriginAllowed() {
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      expect(res.status).toBe(200)
    })

    it('returns 400 for invalid JSON body', async function invalidJson() {
      const request = new NextRequest('http://localhost:3000/api/auth/idp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{',
      })
      const res = await POST(request)
      const data = await res.json()
      expect(res.status).toBe(400)
      expect(data.error).toBe('Invalid JSON body')
    })

    it('returns 400 when appId is missing', async function missingAppId() {
      const res = await POST(createMockRequest({ conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(400)
      expect(data.error).toMatch(/appId/)
    })

    it('returns 400 when conversationId is missing', async function missingConversationId() {
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID }))
      const data = await res.json()
      expect(res.status).toBe(400)
      expect(data.error).toMatch(/conversationId/)
    })

    it('returns 401 when unauthenticated', async function unauthenticated() {
      mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: false, error: 'No token' })
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      expect(res.status).toBe(401)
    })

    it('returns 401 when JWT is absent from auth context', async function noJwt() {
      mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: true, user: MOCK_USER, jwt: undefined })
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(401)
      expect(data.error).toMatch(/SSO token/)
    })

    it('returns 404 and logs when getSite returns null', async function siteNotFound() {
      mockControlPlaneAdapter.getSite.mockResolvedValue(null)
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(404)
      expect(data.error).toMatch(/not found/i)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'care.prefetch_idp_token.site_not_found',
        expect.objectContaining({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }),
      )
    })

    it('returns 502 when site has no agent_url', async function noAgentUrl() {
      mockControlPlaneAdapter.getSite.mockResolvedValue({ agent_url: undefined })
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(502)
      expect(data.error).toMatch(/agent URL/i)
    })

    it('returns 502 and logs when getSite throws', async function siteThrows() {
      mockControlPlaneAdapter.getSite.mockRejectedValue(new Error('Control plane down'))
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(502)
      expect(data.error).toMatch(/resolve agent URL/i)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'care.prefetch_idp_token.site_lookup_failed',
        expect.objectContaining({ error: 'Control plane down' }),
      )
    })

    it('returns 500 when getToken throws', async function mintFails() {
      mockJWTService.getToken.mockRejectedValue(new Error('JWT service unavailable'))
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(500)
      expect(data.error).toMatch(/mint agent token/i)
    })

    it('returns 502 when agents service responds non-ok', async function agentsRejected() {
      mockFetch.mockResolvedValue(mockAgentsResponse(false, 403, 'Forbidden'))
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(502)
      expect(data.error).toMatch(/rejected/i)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'care.prefetch_idp_token.agents_rejected',
        expect.objectContaining({ status: 403 }),
      )
    })

    it('returns 502 when fetch to agents service throws', async function agentsUnreachable() {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(502)
      expect(data.error).toMatch(/reach agents/i)
    })

    it('returns { accepted: true } on success', async function success() {
      const res = await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      const data = await res.json()
      expect(res.status).toBe(200)
      expect(data).toEqual({ accepted: true })
    })

    it('POSTs the IDP token to the correct agents URL with Bearer auth', async function agentsCallShape() {
      await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_AGENT_URL}/api/conversations/${MOCK_APP_ID}/${MOCK_CONV_ID}/idp-token`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_AGENT_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ token: MOCK_IDP_TOKEN }),
        }),
      )
    })

    it('calls getToken with siteId=appId and user fields from auth context', async function tokenMintShape() {
      await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      expect(mockJWTService.getToken).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: MOCK_APP_ID,
          customerId: MOCK_USER.customerId,
          authType: 'basic',
          isE2S: false,
          canDownload: false,
          canPublish: false,
        }),
      )
    })

    it('calls getSite with appId and the user SSO JWT', async function siteResolutionShape() {
      await POST(createMockRequest({ appId: MOCK_APP_ID, conversationId: MOCK_CONV_ID }))
      expect(mockControlPlaneAdapter.getSite).toHaveBeenCalledWith(MOCK_APP_ID, MOCK_IDP_TOKEN)
    })
  })

})
