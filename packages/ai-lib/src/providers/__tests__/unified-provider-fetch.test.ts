import { describe, it, expect, vi, beforeEach } from 'vitest'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'

vi.mock('@airo/ai-grants', () => ({
  grantSessionManager: {
    hasGrants: vi.fn().mockReturnValue(false),
    getCurrentUserId: vi.fn(),
    advanceToNextGrant: vi.fn(),
    requestGrantRefreshAndWait: vi.fn(),
  },
}))

vi.mock('../../utils/s2s-auth.js', () => ({
  getS2SToken: vi.fn().mockResolvedValue('test-token'),
  refreshS2SToken: vi.fn().mockResolvedValue('refreshed-token'),
  isS2SAuthEnabled: vi.fn().mockReturnValue(false),
  getS2SProviderConfig: vi.fn().mockResolvedValue(null),
  getDefaultAnthropicProxyEndpoint: vi.fn().mockReturnValue('https://gocode.example.com'),
}))

const fetchSpy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
  .mockResolvedValue(new Response('{}', { status: 200 }))

vi.stubGlobal('fetch', fetchSpy)

function headersFromCall(callIndex = 0): Headers {
  const call = fetchSpy.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  const init = call[1] as RequestInit
  return new Headers(init?.headers)
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createS2SFetchWrapper header injection', () => {
  let wrapper: typeof fetch

  beforeEach(async () => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const { __test__ } = await import('../unified-provider.js')
    wrapper = __test__.createS2SFetchWrapper()
  })

  it('sets x-trace-id from metadata.traceId', async () => {
    const metadata: LitellmMetadata = { user: 'u', traceId: 'abc123def456abc123def456abc12345' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )
    expect(headersFromCall().get('x-trace-id')).toBe('abc123def456abc123def456abc12345')
  })

  it('omits x-trace-id when metadata has no traceId', async () => {
    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )
    expect(headersFromCall().get('x-trace-id')).toBeNull()
  })

  it('sets x-correlation-id as UUID v4 on every request', async () => {
    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )
    expect(headersFromCall().get('x-correlation-id')).toMatch(UUID_V4_RE)
  })

  it('generates unique x-correlation-id per call', async () => {
    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, async () => {
      await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
      await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    })
    const id1 = headersFromCall(0).get('x-correlation-id')
    const id2 = headersFromCall(1).get('x-correlation-id')
    expect(id1).not.toBe(id2)
  })

  it('sets x-correlation-id even without metadata', async () => {
    await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    expect(headersFromCall().get('x-correlation-id')).toMatch(UUID_V4_RE)
  })

  it('preserves x-correlation-id on 401 retry', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const id1 = headersFromCall(0).get('x-correlation-id')
    const id2 = headersFromCall(1).get('x-correlation-id')
    expect(id1).toBe(id2)
  })
})

describe('grant-fallback retry correlation-id', () => {
  let wrapper: typeof fetch

  beforeEach(async () => {
    fetchSpy.mockClear()
    const { __test__ } = await import('../unified-provider.js')
    wrapper = __test__.createS2SFetchWrapper()
  })

  it('generates new x-correlation-id on grant-fallback retry', async () => {
    const { grantSessionManager } = await import('@airo/ai-grants')

    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('grant-user-2')
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)

    fetchSpy
      .mockResolvedValueOnce(new Response('exceededbudget', { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const metadata: LitellmMetadata = {
      user: 'grant-user-1',
      tags: ['appId:app-1'],
      _internal: { socketId: 'sock-1', customerId: 'cust-1' },
    }

    const body = JSON.stringify({ litellm_metadata: { user: 'grant-user-1' } })

    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body })
    )

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const id1 = headersFromCall(0).get('x-correlation-id')
    const id2 = headersFromCall(1).get('x-correlation-id')
    expect(id1).toMatch(UUID_V4_RE)
    expect(id2).toMatch(UUID_V4_RE)
    expect(id1).not.toBe(id2)

    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(false)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(undefined)
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
  })
})

describe('createSelectiveBetaHeaderFetch header injection', () => {
  let wrapper: typeof fetch

  beforeEach(async () => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const { __test__ } = await import('../unified-provider.js')
    wrapper = __test__.createSelectiveBetaHeaderFetch()
  })

  it('sets x-trace-id from metadata.traceId', async () => {
    const metadata: LitellmMetadata = { user: 'u', traceId: 'trace-selective-123' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )
    expect(headersFromCall().get('x-trace-id')).toBe('trace-selective-123')
  })

  it('sets x-correlation-id as UUID v4', async () => {
    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )
    expect(headersFromCall().get('x-correlation-id')).toMatch(UUID_V4_RE)
  })

  it('generates unique x-correlation-id per call', async () => {
    const metadata: LitellmMetadata = { user: 'u' }
    await llmMetadataContext.run(metadata, async () => {
      await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
      await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    })
    const id1 = headersFromCall(0).get('x-correlation-id')
    const id2 = headersFromCall(1).get('x-correlation-id')
    expect(id1).not.toBe(id2)
  })
})
