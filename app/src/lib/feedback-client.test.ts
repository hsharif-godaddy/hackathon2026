/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { submitFeedback } from './feedback-client'

const mockAgentFetch = vi.fn()
vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (url: string, options: RequestInit & { siteId: string }) => mockAgentFetch(url, options),
}))

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'http://agents.test' }),
  },
}))

const mockGetConversationIdFromCookie = vi.fn()
vi.mock('@/hooks/websocket/useWebSocketHelpers', () => ({
  getConversationIdFromCookie: (appId: string | null) => mockGetConversationIdFromCookie(appId),
}))

const baseInput = {
  feedback: 'positive' as const,
  targetLevel: 'artifact' as const,
  targetId: 'app-1',
  traceId: 'trace-1',
  observationId: 'obs-1',
  appId: 'app-1',
}

describe('submitFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConversationIdFromCookie.mockReturnValue('conv-1')
    mockAgentFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('posts required fields to /feedback with the resolved base URL', async () => {
    const result = await submitFeedback(baseInput)

    expect(result).toEqual({ ok: true })
    expect(mockAgentFetch).toHaveBeenCalledWith(
      'http://agents.test/feedback',
      expect.objectContaining({ method: 'POST', siteId: 'app-1' }),
    )
    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string)
    expect(body).toEqual({
      feedback: 'positive',
      targetLevel: 'artifact',
      targetId: 'app-1',
      traceId: 'trace-1',
      observationId: 'obs-1',
      appId: 'app-1',
      conversationId: 'conv-1',
    })
  })

  it('forwards feedback: "negative" unchanged', async () => {
    await submitFeedback({ ...baseInput, feedback: 'negative' })

    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string)
    expect(body.feedback).toBe('negative')
  })

  it('forwards agentName when the caller supplies it', async () => {
    await submitFeedback({ ...baseInput, agentName: 'InitialAgent' })

    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string)
    expect(body.agentName).toBe('InitialAgent')
  })

  it('omits agentName from the body when not provided', async () => {
    await submitFeedback(baseInput)

    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('agentName')
  })

  it('omits traceId and observationId when the caller does not supply them', async () => {
    const { traceId: _t, observationId: _o, ...inputWithoutTraceIds } = baseInput
    await submitFeedback(inputWithoutTraceIds)

    const body = JSON.parse(mockAgentFetch.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('traceId')
    expect(body).not.toHaveProperty('observationId')
    expect(body).toEqual({
      feedback: 'positive',
      targetLevel: 'artifact',
      targetId: 'app-1',
      appId: 'app-1',
      conversationId: 'conv-1',
    })
  })

  it('returns missing_conversation_id and does not fetch when the cookie is absent', async () => {
    mockGetConversationIdFromCookie.mockReturnValue(null)

    const result = await submitFeedback(baseInput)

    expect(result).toEqual({ ok: false, reason: 'missing_conversation_id' })
    expect(mockAgentFetch).not.toHaveBeenCalled()
  })

  it('returns network_error when the fetch throws', async () => {
    mockAgentFetch.mockRejectedValue(new Error('boom'))

    const result = await submitFeedback(baseInput)

    expect(result).toEqual({ ok: false, reason: 'network_error' })
  })

  it('returns ok:false without a reason when the route returns non-2xx', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 503 })

    const result = await submitFeedback(baseInput)

    expect(result).toEqual({ ok: false })
  })
})
