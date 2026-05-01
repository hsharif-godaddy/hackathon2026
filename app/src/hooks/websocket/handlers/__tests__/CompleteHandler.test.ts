/**
 * CompleteHandler Tests
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockMessageContext } from './testUtils'
import { CompleteHandler } from '../CompleteHandler'
import type { WebSocketMessage } from '../types'

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined)
vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(),
  },
}))

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: {
    getState: vi.fn(),
  },
}))

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: {
    getState: vi.fn(),
  },
}))

const mockTrackCompletion = vi.fn()
const mockIncrementSessionPromptCount = vi.fn()
const mockMaybeShowFeedbackBanner = vi.fn()
const mockMaybeFireEvalSnapshot = vi.fn()
const mockScheduleUsageRefresh = vi.fn()
vi.mock('@/hooks/shared/completionSideEffects', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    trackCompletion: (...args: unknown[]) => mockTrackCompletion(...args),
    incrementSessionPromptCount: (...args: unknown[]) => mockIncrementSessionPromptCount(...args),
    maybeShowFeedbackBanner: (...args: unknown[]) => mockMaybeShowFeedbackBanner(...args),
    maybeFireEvalSnapshot: (...args: unknown[]) => mockMaybeFireEvalSnapshot(...args),
    scheduleUsageRefresh: (...args: unknown[]) => mockScheduleUsageRefresh(...args),
  }
})

import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

const mockStore = useStreamingConversationStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

const mockSiteStore = useSiteStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

const mockSitesStore = useSitesStore as unknown as {
  getState: ReturnType<typeof vi.fn>
}

describe('CompleteHandler', () => {
  const handler = new CompleteHandler()

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.removeItem('airo_eval_snapshot_app_build_count_app-123')
    sessionStorage.removeItem('airo_session_prompt_count')

    // Mock site stores to return a published site by default
    mockSiteStore.getState.mockReturnValue({
      getSite: vi.fn().mockReturnValue({
        id: 'app-123',
        published_url: 'https://published.example.com',
      }),
      updateSite: vi.fn(),
    })

    mockSitesStore.getState.mockReturnValue({
      getSite: vi.fn().mockReturnValue({
        id: 'app-123',
        published_url: 'https://published.example.com',
      }),
      updateSite: vi.fn(),
    })
  })

  it('finalizes stream and clears recovery state on completion', async () => {
    const clearConnectionRetry = vi.fn()
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: true },
      clearConnectionRetry,
      messages: [],
    })

    const context = createMockMessageContext()
    const data: WebSocketMessage = {
      type: 'complete',
      content: '',
      data: {
        agentId: 'develop',
        usage: { totalTokens: 100 },
        step: 3,
        commitHash: 'abcdef1',
      },
    }

    await handler.handle(data, context)

    expect(context.actions.flushToolDeltaBufferImmediate).toHaveBeenCalled()
    expect(clearConnectionRetry).toHaveBeenCalled()
    expect(context.helpers.clearRetryState).toHaveBeenCalled()
    expect(context.actions.finalizeStream).toHaveBeenCalledWith({
      agentId: 'develop',
      usage: { totalTokens: 100 },
      totalSteps: 3,
    })
    expect(mockTrackCompletion).toHaveBeenCalledWith(true)
    expect(context.helpers.handleCommitComplete).toHaveBeenCalledWith('abcdef1')
  })

  it('does not log usage impression when usage data is absent', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockTrackCompletion).toHaveBeenCalledWith(false)
  })

  it('calls maybeFireEvalSnapshot with commitHash', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { commitHash: 'abc1111' } },
      createMockMessageContext()
    )

    expect(mockMaybeFireEvalSnapshot).toHaveBeenCalledWith('abc1111', 'app-123')
  })

  it('calls incrementSessionPromptCount on completion', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockIncrementSessionPromptCount).toHaveBeenCalledWith('app-123')
  })

  it('calls incrementSessionPromptCount for unpublished sites (filtering is internal)', async () => {
    mockSitesStore.getState.mockReturnValue({
      getSite: vi.fn().mockReturnValue({
        id: 'app-123',
        published_url: '',
      }),
      updateSite: vi.fn(),
    })

    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    sessionStorage.removeItem('airo_session_prompt_count')

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockIncrementSessionPromptCount).toHaveBeenCalledWith('app-123')
  })

  it('invalidates media manifest when stream had media tool calls', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mediaManifest', 'app-123'],
    })
  })

  it('invalidates media manifest for media-logo__ prefixed tool calls', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media-logo__generate_logo' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mediaManifest', 'app-123'],
    })
  })

  it('invalidates media manifest for media__ prefixed tool calls', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media__upload' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mediaManifest', 'app-123'],
    })
  })

  it('does not invalidate media manifest for media-image__ tool calls (no manifest writes)', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media-image__generate_image' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('does not invalidate media manifest for media-video__ tool calls (no manifest writes)', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media-video__generate_video' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('does not invalidate media manifest when stream had no media tool calls', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'fileEdit' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('does not invalidate media manifest when appId is null', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [
        { role: 'assistant', toolCalls: [{ id: '1', name: 'media' }] },
      ],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext({ currentAppId: null })
    )

    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('schedules usage refresh after completion', async () => {
    mockStore.getState.mockReturnValue({
      connectionRetry: { isRetrying: false },
      clearConnectionRetry: vi.fn(),
      messages: [],
    })

    await handler.handle(
      { type: 'complete', content: '', data: { agentId: 'develop' } },
      createMockMessageContext()
    )

    expect(mockScheduleUsageRefresh).toHaveBeenCalledTimes(1)
  })
})
