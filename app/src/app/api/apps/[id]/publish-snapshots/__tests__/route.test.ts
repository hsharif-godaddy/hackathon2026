import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '../route'

const { mockAuthenticateCustomer, mockGetSite, mockS3Send, mockLogger, mockEnforce } = vi.hoisted(function setup() {
  return {
    mockAuthenticateCustomer: vi.fn(),
    mockGetSite: vi.fn(),
    mockS3Send: vi.fn(),
    mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    mockEnforce: vi.fn(),
  }
})

vi.mock('@/lib/authz-fga/enforce-venture-relation', () => ({
  enforceAabMultiUserVentureRelation: mockEnforce,
}))

vi.mock('@/lib/customer-auth', async function mockCustomerAuth() {
  const actual = await vi.importActual('@/lib/customer-auth')
  return {
    ...actual,
    withCustomerAuth: vi.fn(function withCustomerAuth(handler) {
      return async function wrapped(request: NextRequest, ...args: unknown[]) {
        const authContext = await mockAuthenticateCustomer(request)
        if (!authContext.isAuthenticated) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return handler(request, authContext, ...args)
      }
    }),
  }
})

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function s3() {
    return { send: mockS3Send }
  }),
  PutObjectCommand: vi.fn().mockImplementation(function put(input: unknown) {
    return input
  }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}))

// The route calls enforceAabMultiUserVentureRelation → checkSwitchboardFlag.
// Without this mock, checkSwitchboardFlag hits real gasket → the Atlas/Visitor
// plugin → an AtlasFetchError unhandled rejection in the test env. Mock it to
// "off" so enforce no-ops (allow) without touching gasket.
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn().mockResolvedValue(false),
  checkSwitchboardValue: vi.fn().mockResolvedValue(null),
}))

const AUTHED = { isAuthenticated: true, user: { customerId: 'c-1' }, jwt: 'jwt-token' }
const UNAUTHED = { isAuthenticated: false, error: 'Invalid token' }
const MOCK_SITE = { id: 'app-123', account_id: 'acc-1' }

function makeRequest(appId: string, fields: Record<string, string | Blob>): NextRequest {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new NextRequest(`http://localhost:3000/api/apps/${appId}/publish-snapshots`, {
    method: 'POST',
    body: fd,
  })
}

function validFields(overrides: Partial<Record<string, string | Blob>> = {}) {
  return {
    key: 'deploy-abc',
    screenshot: new File(['img'], 'screenshot.png', { type: 'image/png' }),
    manifest: JSON.stringify({ appId: 'app-123', commitHash: 'abc123' }),
    ...overrides,
  }
}

const APP_ID = 'app-123'
const PARAMS = { params: Promise.resolve({ id: APP_ID }) }

describe('apps/[id]/publish-snapshots POST', function publishSnapshotsTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', 'test-bucket')
    mockS3Send.mockResolvedValue({})
    mockGetSite.mockResolvedValue(MOCK_SITE)
    mockEnforce.mockResolvedValue(null)
  })

  afterEach(function restoreEnv() {
    vi.unstubAllEnvs()
  })

  it('returns 401 when not authenticated', async function unauthenticated() {
    mockAuthenticateCustomer.mockResolvedValue(UNAUTHED)
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(401)
  })

  it('returns 404 when app does not belong to authenticated customer', async function notOwner() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    mockGetSite.mockResolvedValue(null)
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'App not found' })
  })

  it('returns the deny response and does NOT upload when the FGA publish gate denies', async function fgaDenies() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    mockEnforce.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(403)
    expect(mockEnforce).toHaveBeenCalledTimes(1)
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('calls getSite with appId and customer JWT for ownership check', async function ownershipCheck() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(mockGetSite).toHaveBeenCalledWith(APP_ID, 'jwt-token', undefined, { multiUserEnabled: false })
  })

  it('returns 503 when bucket env var is missing', async function noBucket() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    vi.stubEnv('EVAL_SNAPSHOTS_BUCKET', undefined as unknown as string)
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(503)
  })

  it('returns 400 for invalid key format', async function invalidKey() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    const response = await POST(makeRequest(APP_ID, validFields({ key: '../evil' })), PARAMS)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Invalid key format' })
  })

  it('returns 413 when screenshot exceeds 10 MB', async function tooLarge() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    const large = new File([new ArrayBuffer(11 * 1024 * 1024)], 'screenshot.png', { type: 'image/png' })
    const response = await POST(makeRequest(APP_ID, validFields({ screenshot: large })), PARAMS)
    expect(response.status).toBe(413)
  })

  it('uploads to correct S3 paths and returns 200', async function uploads() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, appId: APP_ID, key: 'deploy-abc' })
    expect(mockS3Send).toHaveBeenCalledTimes(2)
    const [screenshotCall, manifestCall] = mockS3Send.mock.calls
    expect(screenshotCall[0]).toMatchObject({
      Key: `snapshots/${APP_ID}/publishes/deploy-abc/screenshot.png`,
      Bucket: 'test-bucket',
    })
    expect(manifestCall[0]).toMatchObject({
      Key: `snapshots/${APP_ID}/publishes/deploy-abc/manifest.json`,
    })
  })

  it('returns 500 when S3 upload fails', async function s3Failure() {
    mockAuthenticateCustomer.mockResolvedValue(AUTHED)
    mockS3Send.mockRejectedValue(new Error('S3 unavailable'))
    const response = await POST(makeRequest(APP_ID, validFields()), PARAMS)
    expect(response.status).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'publish-snapshots.upload.failure',
      expect.objectContaining({ error: 'S3 unavailable' })
    )
  })
})
