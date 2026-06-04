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

const fetchSpy = vi.fn<typeof fetch>()
  .mockResolvedValue(new Response('{}', { status: 200 }))

vi.stubGlobal('fetch', fetchSpy)

function headersFromCall(callIndex = 0): Headers {
  const call = fetchSpy.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  const init = call[1] as RequestInit
  return new Headers(init?.headers)
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function transformAll(modelName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { __test__ } = await import('../unified-provider.js')
  let transformed = params
  for (const middleware of __test__.getModelMiddleware(modelName)) {
    if (middleware.transformParams) {
      transformed = await middleware.transformParams({
        params: transformed as any,
        type: 'stream',
        model: { modelId: modelName } as any,
      }) as Record<string, unknown>
    }
  }
  return transformed
}

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

  // GoCode (authz-gdjwt-all) requires `Authorization: sso-jwt <jwt>`; Bearer is
  // rejected by the API gateway.
  it('sends Authorization with sso-jwt scheme (not Bearer) on initial request', async () => {
    await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    const auth = headersFromCall(0).get('Authorization')
    expect(auth).toBe('sso-jwt test-token')
    expect(auth).not.toMatch(/^Bearer /)
  })

  it.each([
    { status: 401, label: '401 unauthorized' },
    { status: 403, label: '403 forbidden' },
  ])('sends Authorization with sso-jwt scheme on $label refresh retry', async ({ status }) => {
    fetchSpy
      .mockResolvedValueOnce(new Response('auth failure', { status }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(headersFromCall(1).get('Authorization')).toBe('sso-jwt refreshed-token')
  })
})

describe('model provider defaults middleware', () => {
  it('applies provider options from model definitions', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [middleware] = __test__.getModelMiddleware('sonnet')
    for (const type of ['generate', 'stream'] as const) {
      const transformed = await middleware.transformParams?.({
        params: { providerOptions: {} } as any,
        type,
        model: { modelId: 'claude-sonnet-4-6' } as any,
      })

      expect(transformed?.providerOptions).toEqual({
        anthropic: { effort: 'low' },
      })
    }
  })

  it('lets request provider options override model defaults', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [middleware] = __test__.getModelMiddleware('sonnet')
    const transformed = await middleware.transformParams?.({
      params: {
        providerOptions: {
          anthropic: { effort: 'medium' },
        },
      } as any,
      type: 'generate',
      model: { modelId: 'claude-sonnet-4-6' } as any,
    })

    expect(transformed?.providerOptions).toEqual({
      anthropic: { effort: 'medium' },
    })
  })

  it('applies provider options for azure claude-sonnet-4-6', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [middleware] = __test__.getModelMiddleware('azure/claude-sonnet-4-6')
    const transformed = await middleware.transformParams?.({
      params: { providerOptions: {} } as any,
      type: 'stream',
      model: { modelId: 'azure/claude-sonnet-4-6' } as any,
    })

    expect(transformed?.providerOptions).toEqual({
      anthropic: { effort: 'low' },
    })
  })

  it('applies model defaults for azure Kimi', async () => {
    const transformed = await transformAll('azure/Kimi-K2.6', {
      providerOptions: {},
    })

    expect(transformed.temperature).toBe(0.6)
    expect(transformed.providerOptions).toEqual({
      litellm: {
        extra_body: {
          reasoning_effort: 'none',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    })
  })

  it('replaces request temperature with model default for azure Kimi', async () => {
    const transformed = await transformAll('azure/Kimi-K2.6', {
      temperature: 0.9,
      providerOptions: {},
    })

    expect(transformed.temperature).toBe(0.6)
    expect(transformed.providerOptions).toEqual({
      litellm: {
        extra_body: {
          reasoning_effort: 'none',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    })
  })

  it('applies model defaults for azure Kimi thinking variant', async () => {
    const transformed = await transformAll('azure/Kimi-K2.6-thinking', {
      providerOptions: {},
    })

    expect(transformed.temperature).toBe(1.0)
    expect(transformed.providerOptions).toEqual({
      litellm: {
        extra_body: {
          reasoning_effort: 'low',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    })
  })

  it('replaces request temperature with model default for azure Kimi thinking variant', async () => {
    const transformed = await transformAll('azure/Kimi-K2.6-thinking', {
      temperature: 0.3,
      providerOptions: {},
    })

    expect(transformed.temperature).toBe(1.0)
    expect(transformed.providerOptions).toEqual({
      litellm: {
        extra_body: {
          reasoning_effort: 'low',
        },
        metadata: {
          guardrails: {
            'unicode-security': {
              extra_body: {
                mode: 'disabled',
              },
            },
          },
        },
      },
    })
  })

  it('keeps temperature for Claude models', async () => {
    const transformed = await transformAll('sonnet', {
      temperature: 0.3,
      providerOptions: {},
    })

    expect(transformed.temperature).toBe(0.3)
    expect(transformed.providerOptions).toEqual({
      anthropic: { effort: 'low' },
    })
  })

  it('omits default provider options for models without defaults', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [middleware] = __test__.getModelMiddleware('haiku')

    expect(middleware).not.toHaveProperty('transformParams')
  })

  it('strips temperature from requests for claude-opus-4-7', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [stripTemp] = __test__.getModelMiddleware('claude-opus-4-7')
    const transformed = await stripTemp.transformParams?.({
      params: { temperature: 0.7, providerOptions: {} } as any,
      type: 'generate',
      model: { modelId: 'claude-opus-4-7' } as any,
    })

    expect(transformed).not.toHaveProperty('temperature')
  })

  it('keeps temperature for claude-opus-4-6 (no strip)', async () => {
    const { __test__ } = await import('../unified-provider.js')
    const [first] = __test__.getModelMiddleware('claude-opus-4-6')
    const transformed = await first.transformParams?.({
      params: { temperature: 0.7, providerOptions: {} } as any,
      type: 'generate',
      model: { modelId: 'claude-opus-4-6' } as any,
    })

    expect(transformed?.temperature).toBe(0.7)
  })
})

describe('BMS mode budget-exceeded handling', () => {
  let wrapper: typeof fetch

  beforeEach(async () => {
    fetchSpy.mockClear()
    const { __test__ } = await import('../unified-provider.js')
    wrapper = __test__.createS2SFetchWrapper()
  })

  it('does not retry on budget-exceeded when budgetServiceEnabled is true (BMS mode)', async () => {
    const { grantSessionManager } = await import('@airo/ai-grants')

    // Set up grants that would normally trigger fallback
    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('grant-user-2')
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)

    // Return budget-exceeded error
    fetchSpy.mockResolvedValueOnce(new Response('exceededbudget', { status: 400 }))

    // BMS mode: budgetServiceEnabled is true
    const metadata: LitellmMetadata = {
      user: 'grant-user-1',
      tags: ['appId:app-1'],
      budgetServiceEnabled: true,
      budgetSessionId: 'bms-session-uuid',
      _internal: { socketId: 'sock-1', customerId: 'cust-1' },
    }

    const body = JSON.stringify({ litellm_metadata: { user: 'grant-user-1' } })

    const response = await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body })
    )

    // Should NOT retry - BMS mode skips grant fallback
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(400)

    // Clean up mocks
    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(false)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(undefined)
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
  })

  it('does not retry on budget-exceeded when BMS enabled but session creation failed', async () => {
    const { grantSessionManager } = await import('@airo/ai-grants')

    // Set up grants that would normally trigger fallback
    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(true)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('grant-user-2')
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(true)

    // Return budget-exceeded error
    fetchSpy.mockResolvedValueOnce(new Response('exceededbudget', { status: 400 }))

    // BMS mode but session creation failed: budgetServiceEnabled=true but no budgetSessionId
    const metadata: LitellmMetadata = {
      user: 'grant-user-1',
      tags: ['appId:app-1'],
      budgetServiceEnabled: true,
      // budgetSessionId is NOT set - session creation failed
      _internal: { socketId: 'sock-1', customerId: 'cust-1' },
    }

    const body = JSON.stringify({ litellm_metadata: { user: 'grant-user-1' } })

    const response = await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body })
    )

    // Should NOT retry - BMS mode skips grant fallback even without session
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(400)

    // Clean up mocks
    vi.mocked(grantSessionManager.hasGrants).mockReturnValue(false)
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(undefined)
    vi.mocked(grantSessionManager.advanceToNextGrant).mockReturnValue(false)
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

describe('resolveCurrentUser fallback behavior', () => {
  let wrapper: typeof fetch

  beforeEach(async () => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }))
    const { grantSessionManager } = await import('@airo/ai-grants')
    vi.mocked(grantSessionManager.getCurrentUserId).mockReset()
    const { __test__ } = await import('../unified-provider.js')
    wrapper = __test__.createS2SFetchWrapper()
  })

  it('uses metadata.user when socket mapping is gone (not customerId)', async () => {
    // Simulates: socket disconnected, getCurrentUserId returns undefined (no mapping)
    const { grantSessionManager } = await import('@airo/ai-grants')
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue(undefined)

    const metadata: LitellmMetadata = {
      user: 'airo-builder:grant:original-grant-id',
      tags: ['appId:test'],
      _internal: { socketId: 'dead-socket', customerId: 'cust-uuid-should-not-appear' },
    }

    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.litellm_metadata.user).toBe('airo-builder:grant:original-grant-id')
  })

  it('uses grant userId when getCurrentUserId returns it', async () => {
    const { grantSessionManager } = await import('@airo/ai-grants')
    vi.mocked(grantSessionManager.getCurrentUserId).mockReturnValue('airo-builder:grant:active-grant')

    const metadata: LitellmMetadata = {
      user: 'airo-builder:grant:original-grant-id',
      tags: ['appId:test'],
      _internal: { socketId: 'live-socket', customerId: 'cust-uuid' },
    }

    await llmMetadataContext.run(metadata, () =>
      wrapper('https://api.example.com/v1/chat', { method: 'POST', body: '{}' })
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.litellm_metadata.user).toBe('airo-builder:grant:active-grant')
  })
})
