/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import AppGenerationFeedbackBanner from './AppGenerationFeedbackBanner'

const mockLogImpression = vi.fn(function () { return vi.fn(); })
const mockLogClick = vi.fn(function () { return vi.fn(); })
const mockShipAnalyticsLog = vi.fn()

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (id: string) => mockLogImpression(id),
  logClickEvent: (id: string) => mockLogClick(id),
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

vi.mock('@/hooks/websocket/useWebSocketHelpers', () => ({
  getConversationIdFromCookie: () => 'conv-1',
}))

const mockMarkSubmitted = vi.fn()
const mockSetShowBanner = vi.fn()

let mockTraceIds: { traceId: string; observationId: string } | null = {
  traceId: 'trace-1',
  observationId: 'obs-1',
}

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({
    appGenerationFeedbackTraceIds: mockTraceIds,
    currentAppId: 'app-1',
    markAppGenerationFeedbackSubmitted: mockMarkSubmitted,
    setShowAppGenerationFeedbackBanner: mockSetShowBanner,
  }),
}))

const mockAgentFetch = vi.fn()
vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (url: string, options: RequestInit & { siteId: string }) => mockAgentFetch(url, options),
}))

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'http://agents.test' }),
  },
}))

describe('AppGenerationFeedbackBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentFetch.mockResolvedValue({ ok: true, status: 200 })
    mockTraceIds = { traceId: 'trace-1', observationId: 'obs-1' }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('logs an impression on mount and renders both thumb buttons', () => {
    renderWithProviders(<AppGenerationFeedbackBanner />)
    expect(mockLogImpression).toHaveBeenCalledWith('appGeneration.feedback.view')
    expect(screen.getByTestId('app-generation-feedback-thumbs-up')).toBeInTheDocument()
    expect(screen.getByTestId('app-generation-feedback-thumbs-down')).toBeInTheDocument()
  })

  it('submits positive feedback with artifact-level targeting and transitions to thanks', async () => {
    renderWithProviders(<AppGenerationFeedbackBanner />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-generation-feedback-thumbs-up'))
    })

    expect(mockAgentFetch).toHaveBeenCalledWith(
      'http://agents.test/feedback',
      expect.objectContaining({ method: 'POST', siteId: 'app-1' }),
    )
    const [, options] = mockAgentFetch.mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body).toEqual({
      feedback: 'positive',
      targetLevel: 'artifact',
      targetId: 'app-1',
      traceId: 'trace-1',
      observationId: 'obs-1',
      appId: 'app-1',
      conversationId: 'conv-1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('app-generation-feedback-thanks')).toBeInTheDocument()
    })

    expect(mockLogClick).toHaveBeenCalledWith('appGeneration.feedback.positive')
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'appGeneration.feedback.submit',
      expect.objectContaining({ feedback: 'positive', outcome: 'success' }),
    )
  })

  it('submits negative feedback as feedback: "negative"', async () => {
    renderWithProviders(<AppGenerationFeedbackBanner />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-generation-feedback-thumbs-down'))
    })

    const [, options] = mockAgentFetch.mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body.feedback).toBe('negative')
    expect(mockLogClick).toHaveBeenCalledWith('appGeneration.feedback.negative')
  })

  it('hides the banner on close click', async () => {
    renderWithProviders(<AppGenerationFeedbackBanner />)
    const closeButton = screen.getByRole('button', { name: /close/i })
    await act(async () => {
      fireEvent.click(closeButton)
    })
    expect(mockLogClick).toHaveBeenCalledWith('appGeneration.feedback.close')
    expect(mockSetShowBanner).toHaveBeenCalledWith(false, null)
  })

  it('still shows thanks and logs failure outcome when the API returns 5xx', async () => {
    mockAgentFetch.mockResolvedValue({ ok: false, status: 503 })

    renderWithProviders(<AppGenerationFeedbackBanner />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-generation-feedback-thumbs-up'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('app-generation-feedback-thanks')).toBeInTheDocument()
    })

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'appGeneration.feedback.submit',
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('submits without traceIds when the complete event did not carry them', async () => {
    mockTraceIds = null

    renderWithProviders(<AppGenerationFeedbackBanner />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-generation-feedback-thumbs-up'))
    })

    const [, options] = mockAgentFetch.mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body).toEqual({
      feedback: 'positive',
      targetLevel: 'artifact',
      targetId: 'app-1',
      appId: 'app-1',
      conversationId: 'conv-1',
    })
    expect(body).not.toHaveProperty('traceId')
    expect(body).not.toHaveProperty('observationId')
  })
})
