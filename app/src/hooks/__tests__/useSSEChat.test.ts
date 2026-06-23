/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { logger } from '@/lib/request-context'

let mockTokenAuthType: string | undefined = 'basic'

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    tokenAuthType: mockTokenAuthType,
    isAuthenticated: true,
    isLoading: false,
  }),
}))

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const mockAppendTextSegment = vi.fn()
const mockAddToolStartSegment = vi.fn()
const mockAddToolCallSegment = vi.fn()
const mockAddToolResultSegment = vi.fn()
const mockFinalizeStream = vi.fn()
const mockMarkUpstreamError = vi.fn()
const mockSetIsLoading = vi.fn()
const mockStartNewStream = vi.fn()
const mockSetConversationId = vi.fn()
const mockUpdateToolDelta = vi.fn()
const mockSetConnectionState = vi.fn()
const mockLoadAndPersistHistory = vi.fn()
const mockClearActiveStream = vi.fn()
const mockClearStreamForRetry = vi.fn()
const mockSetHistoryLoadRequested = vi.fn()
const mockSetHistoryLoadingComplete = vi.fn()
const mockSetHistoryPagination = vi.fn()
const mockSetHistoryLoadingMore = vi.fn()
const mockClearMessages = vi.fn()

let currentAppId: string | null = 'test-app-123'
let storeState: Record<string, unknown> = {}

function getStoreState() {
  return {
    currentAppId,
    messages: [],
    activeStream: null,
    historyLoadingComplete: false,
    historyLoadRequested: false,
    historyNextCursor: null as string | null,
    appendTextSegment: mockAppendTextSegment,
    addToolStartSegment: mockAddToolStartSegment,
    addToolCallSegment: mockAddToolCallSegment,
    addToolResultSegment: mockAddToolResultSegment,
    finalizeStream: mockFinalizeStream,
    markUpstreamError: mockMarkUpstreamError,
    setIsLoading: mockSetIsLoading,
    startNewStream: mockStartNewStream,
    setConversationId: mockSetConversationId,
    updateToolDelta: mockUpdateToolDelta,
    setConnectionState: mockSetConnectionState,
    loadAndPersistHistory: mockLoadAndPersistHistory,
    clearActiveStream: mockClearActiveStream,
    clearStreamForRetry: mockClearStreamForRetry,
    setHistoryLoadRequested: mockSetHistoryLoadRequested,
    setHistoryLoadingComplete: mockSetHistoryLoadingComplete,
    setHistoryPagination: mockSetHistoryPagination,
    setHistoryLoadingMore: mockSetHistoryLoadingMore,
    clearMessages: mockClearMessages,
    ...storeState,
  }
}

let mockIsActivelyStreaming = false

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useCurrentAppId: () => currentAppId,
  useIsActivelyStreaming: () => mockIsActivelyStreaming,
  useStreamingConversationStore: {
    getState: () => getStoreState(),
    setState: (update: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>)) => {
      const patch = typeof update === 'function' ? update(getStoreState()) : update
      storeState = { ...storeState, ...patch }
    },
  },
}))

// ---------------------------------------------------------------------------
// Cookie mock
// ---------------------------------------------------------------------------

let mockConversationIdFromCookie: string | null = null

vi.mock('@/hooks/chat/useChatHelpers', () => ({
  getConversationIdFromCookie: () => mockConversationIdFromCookie,
  setConversationIdCookie: vi.fn(),
  sendToolImpressionEvent: vi.fn(),
}))

// ---------------------------------------------------------------------------
// React Query mock
// ---------------------------------------------------------------------------

const mockInvalidateQueries = vi.fn()
const mockSetQueryData = vi.fn()
const mockGetQueryData = vi.fn().mockReturnValue(undefined)

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
    getQueryData: mockGetQueryData,
  }),
  useQuery: () => ({
    data: undefined,
    refetch: vi.fn().mockResolvedValue({ data: undefined }),
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}))

// ---------------------------------------------------------------------------
// Switchboard / Sites / Grants mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/useBillingModeStore', () => ({
  useResolvedBillingMode: () => false,
}))

const mockRefetchGrants = vi.fn().mockResolvedValue({ data: [] })

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => ({
    data: [],
    refetch: mockRefetchGrants,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}))

const mockUpdateSite = vi.fn()
const mockGetSite = vi.fn()

vi.mock('@/stores/useSitesStore', () => {
  const hook = Object.assign(() => 'sub-123', {
    getState: () => ({ updateSite: mockUpdateSite, getSite: mockGetSite }),
  })
  return { useSitesStore: hook }
})

vi.mock('@/types/budget', () => ({
  BUDGET_STATUS_QUERY_KEY: 'budget-status',
}))

// ---------------------------------------------------------------------------
// SSETransport mock
// ---------------------------------------------------------------------------

type MockCallbacks = {
  onEvent: (e: { type: string; content?: string; conversationId?: string; data: Record<string, unknown>; sequence?: number }) => void
  onStateChange: (s: string) => void
  onError: (err: Error) => void
}

// Per-instance storage so each test gets a fresh transport mock
interface MockTransport {
  callbacks: MockCallbacks | null
  state: string
  on: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  stopGeneration: ReturnType<typeof vi.fn>
  loadHistory: ReturnType<typeof vi.fn>
  postClientActionResult: ReturnType<typeof vi.fn>
  emitGrantContext: ReturnType<typeof vi.fn>
  onGrantRefreshRequested: ReturnType<typeof vi.fn>
  onBudgetUpdate: ReturnType<typeof vi.fn>
  setTokenRefresher: ReturnType<typeof vi.fn>
  updateToken: ReturnType<typeof vi.fn>
}

let lastTransport: MockTransport

vi.mock('@/services/transport/SSETransport', () => {
  return {
    SSETransport: vi.fn().mockImplementation(function () {
      const instance: MockTransport = {
        callbacks: null,
        state: 'disconnected' as string,
        on: vi.fn(function (cbs: MockCallbacks) {
          instance.callbacks = cbs
        }),
        connect: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        stopGeneration: vi.fn().mockResolvedValue(undefined),
        loadHistory: vi.fn(),
        postClientActionResult: vi.fn().mockResolvedValue(undefined),
        emitGrantContext: vi.fn().mockReturnValue(true),
        onGrantRefreshRequested: vi.fn().mockReturnValue(() => {}),
        onBudgetUpdate: vi.fn().mockReturnValue(() => {}),
        setTokenRefresher: vi.fn(),
        updateToken: vi.fn(),
      }
      lastTransport = instance
      return instance
    }),
  }
})

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ baseUrl: 'https://agent.example.com' }),
    clearCache: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// SSEQualityMonitor mock
// ---------------------------------------------------------------------------

const mockMarkConnectStart = vi.fn()
const mockRecordConnectPhases = vi.fn()
const mockMarkStreamOpenStart = vi.fn()
const mockMarkFirstStreamEvent = vi.fn()
const mockMarkSend = vi.fn()
const mockMarkFirstResponse = vi.fn()
const mockClearSend = vi.fn()
const mockRecordEventSourceError = vi.fn()
const mockResetErrorBuckets = vi.fn()
const mockMonitorDestroy = vi.fn()

vi.mock('@/services/transport/SSEQualityMonitor', () => ({
  SSEQualityMonitor: vi.fn().mockImplementation(function () {
    return {
      markConnectStart: mockMarkConnectStart,
      recordConnectPhases: mockRecordConnectPhases,
      markStreamOpenStart: mockMarkStreamOpenStart,
      markFirstStreamEvent: mockMarkFirstStreamEvent,
      markSend: mockMarkSend,
      markFirstResponse: mockMarkFirstResponse,
      clearSend: mockClearSend,
      recordEventSourceError: mockRecordEventSourceError,
      resetErrorBuckets: mockResetErrorBuckets,
      destroy: mockMonitorDestroy,
    }
  }),
}))

vi.mock('@/lib/agent-fetch', () => ({
  getAgentToken: vi.fn().mockResolvedValue('test-token'),
  clearAgentTokenCache: vi.fn(),
  agentFetch: vi.fn(function (url: string, init: any) {
    const { siteId: _siteId, ...rest } = init ?? {}
    return fetch(url, rest)
  }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string) => id,
}))

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: vi.fn() },
}))

const mockSetLaunchVideoResult = vi.fn()
const mockSetLastCompleteTraceIds = vi.fn()

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn().mockReturnValue({
      selectedModel: undefined,
      setLaunchVideoResult: mockSetLaunchVideoResult,
      setLastCompleteTraceIds: mockSetLastCompleteTraceIds,
    }),
  },
}))

const mockPublishAction = vi.fn().mockResolvedValue({ success: true })
const mockGetSiteDataAction = vi.fn().mockResolvedValue({ html: '<div/>' })

vi.mock('@/hooks/chat/actions', () => ({
  clientActionExecutors: {
    publishAction: (...args: unknown[]) => mockPublishAction(...args),
    getSiteDataAction: (...args: unknown[]) => mockGetSiteDataAction(...args),
  },
}))

let mockRouteParams: Record<string, string> = {}

vi.mock('next/navigation', () => ({
  useParams: () => mockRouteParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}))

const mockBufferTextChunk = vi.fn()
const mockBufferStoreUpdate = vi.fn()
const mockFlushStoreUpdateBufferImmediate = vi.fn()

vi.mock('@/services/transport/buffering/storeUpdateBuffer', () => ({
  bufferTextChunk: (...args: unknown[]) => mockBufferTextChunk(...args),
  bufferStoreUpdate: vi.fn(function (fn: () => void) {
    mockBufferStoreUpdate(fn)
    fn()
  }),
  flushStoreUpdateBufferImmediate: (...args: unknown[]) => mockFlushStoreUpdateBufferImmediate(...args),
}))

const mockScheduleToolDeltaFlush = vi.fn()

vi.mock('@/services/transport/buffering/toolDeltaBuffer', () => ({
  scheduleToolDeltaFlush: (...args: unknown[]) => mockScheduleToolDeltaFlush(...args),
}))

// ---------------------------------------------------------------------------
// completionSideEffects mock
// ---------------------------------------------------------------------------

const mockPostInitialBuildEvent = vi.fn()
const mockTrackInitialBuildComplete = vi.fn()

vi.mock('@/hooks/shared/completionSideEffects', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    postInitialBuildEvent: (...args: unknown[]) => mockPostInitialBuildEvent(...args),
    trackInitialBuildComplete: (...args: unknown[]) => mockTrackInitialBuildComplete(...args),
  }
})

// ---------------------------------------------------------------------------
// useSwitchboard + readDesignChoiceForCurrentApp mocks
// ---------------------------------------------------------------------------

let mockBringOverTogglesEnabled: boolean | undefined = false
let mockDesignChoiceForApp: unknown = null
// A1 (AIROBUILD-2665) is gated on this flag — default true so the parked-turn
// skip tests exercise the gallery-on path; the flag-off test flips it false.
let mockDesignKitGalleryEnabled: boolean | undefined = true

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function (flag: string) {
    if (flag === 'appbuilder-rebuild-bring-over-toggles') return mockBringOverTogglesEnabled
    return false
  }),
  getSwitchboardFlag: vi.fn(function (flag: string) {
    if (flag === 'appbuilder-design-kit-gallery') return mockDesignKitGalleryEnabled
    return false
  }),
}))

vi.mock('@/lib/rebuild-design-choice', () => ({
  readDesignChoiceForCurrentApp: vi.fn(function () { return mockDesignChoiceForApp }),
  persistPendingDesignChoice: vi.fn(),
  clearDesignChoiceForApp: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function setupHook(appIdOrOptions: string | { appId?: string; market?: string } = 'test-app-123') {
  const appId = typeof appIdOrOptions === 'string' ? appIdOrOptions : (appIdOrOptions.appId ?? 'test-app-123')
  const market = typeof appIdOrOptions === 'object' ? appIdOrOptions.market : undefined
  currentAppId = appId
  mockRouteParams = market ? { market } : {}
  const { useSSEChat } = await import('@/hooks/useSSEChat')
  const hook = renderHook(() => useSSEChat())

  await act(async () => {
    await flushPromises()
  })

  return hook
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSSEChat', () => {
  beforeEach(() => {
    currentAppId = 'test-app-123'
    storeState = {}
    mockRouteParams = {}
    mockTokenAuthType = 'basic'
    mockBringOverTogglesEnabled = false
    mockDesignKitGalleryEnabled = true
    mockDesignChoiceForApp = null
    mockConversationIdFromCookie = null
    // Mock fetch for conversation creation POST
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ conversationId: 'conv-created-123' }),
    }) as any
    mockIsActivelyStreaming = false
    mockInvalidateQueries.mockClear()
    mockSetQueryData.mockClear()
    mockGetQueryData.mockClear().mockReturnValue(undefined)
    mockRefetchGrants.mockClear().mockResolvedValue({ data: [] })
    mockBufferTextChunk.mockClear()
    mockBufferStoreUpdate.mockClear()
    mockFlushStoreUpdateBufferImmediate.mockClear()
    mockAppendTextSegment.mockClear()
    mockAddToolStartSegment.mockClear()
    mockAddToolCallSegment.mockClear()
    mockAddToolResultSegment.mockClear()
    mockFinalizeStream.mockClear()
    mockMarkUpstreamError.mockClear()
    mockSetIsLoading.mockClear()
    mockStartNewStream.mockClear()
    mockLoadAndPersistHistory.mockClear()
    mockClearActiveStream.mockClear().mockImplementation(function () {
      storeState.activeStream = null
    })
    mockClearStreamForRetry.mockClear()
    mockSetHistoryLoadRequested.mockClear().mockImplementation(function (requested: boolean) {
      storeState.historyLoadRequested = requested
    })
    mockSetHistoryLoadingComplete.mockClear().mockImplementation(function (complete: boolean) {
      storeState.historyLoadingComplete = complete
    })
    mockSetHistoryPagination.mockClear().mockImplementation(function (pagination: { hasMore: boolean; nextCursor: string | null }) {
      storeState.historyHasMore = pagination.hasMore
      storeState.historyNextCursor = pagination.nextCursor
    })
    mockSetHistoryLoadingMore.mockClear()
    mockClearMessages.mockClear()
    mockSetConnectionState.mockClear()
    mockSetConversationId.mockClear()
    mockSetLaunchVideoResult.mockClear()
    mockSetLastCompleteTraceIds.mockClear()
    mockPublishAction.mockClear()
    mockGetSiteDataAction.mockClear()
    vi.mocked(logger.debug).mockClear()
    vi.mocked(logger.info).mockClear()
    vi.mocked(logger.warn).mockClear()
    vi.mocked(logger.error).mockClear()
    mockPostInitialBuildEvent.mockClear()
    mockMarkConnectStart.mockClear()
    mockRecordConnectPhases.mockClear()
    mockMarkStreamOpenStart.mockClear()
    mockMarkFirstStreamEvent.mockClear()
    mockMarkSend.mockClear()
    mockMarkFirstResponse.mockClear()
    mockClearSend.mockClear()
    mockRecordEventSourceError.mockClear()
    mockResetErrorBuckets.mockClear()
    mockMonitorDestroy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    // No vi.restoreAllMocks() - it would clear vi.fn() implementations in vi.mock factories
  })

  it('connects transport on mount with appId and token', async () => {
    await setupHook()

    expect(lastTransport.connect).toHaveBeenCalledWith('test-app-123', 'test-token', 'conv-created-123')
  })

  it('disconnects transport on unmount', async () => {
    const hook = await setupHook()

    hook.unmount()

    expect(lastTransport.disconnect).toHaveBeenCalled()
  })

  it('chunk event calls bufferTextChunk', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'chunk', content: 'hello', data: {} })
    })

    expect(mockBufferTextChunk).toHaveBeenCalledWith('hello')
  })

  it('creates an active stream when an SSE chunk arrives without one', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'chunk',
        content: 'hello',
        conversationId: 'conv-created-123',
        data: { conversationId: 'conv-created-123' },
      })
    })

    expect(storeState.activeStream).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^sse_recovered_/),
      role: 'assistant',
      content: '',
      isComplete: false,
      metadata: expect.objectContaining({
        source: 'sse_recovery',
        conversationId: 'conv-created-123',
      }),
    }))
    expect(storeState.streamingState).toBe('streaming')
    expect(storeState.isLoading).toBe(true)
  })

  it.each(['tool_start', 'tool_input_delta', 'tool_call'])(
    'creates an active stream when an SSE %s event arrives without one',
    async (type) => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type,
          conversationId: 'conv-created-123',
          data: {
            conversationId: 'conv-created-123',
            tool: { id: 't1', name: 'read_file', input: {}, status: 'running' },
            toolId: 't1',
            toolName: 'read_file',
            delta: '{"path":',
          },
        })
      })

      expect(storeState.activeStream).toEqual(expect.objectContaining({
        id: expect.stringMatching(/^sse_recovered_/),
        role: 'assistant',
        isComplete: false,
        metadata: expect.objectContaining({
          source: 'sse_recovery',
          conversationId: 'conv-created-123',
        }),
      }))
      expect(storeState.streamingState).toBe('streaming')
      expect(storeState.isLoading).toBe(true)
    }
  )

  it('does not replace an existing active stream when an SSE chunk arrives', async () => {
    await setupHook()
    const existingStream = {
      id: 'existing-assistant-stream',
      role: 'assistant',
      content: 'partial',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false,
    }
    storeState.activeStream = existingStream
    vi.mocked(logger.info).mockClear()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'chunk',
        content: 'hello',
        conversationId: 'conv-created-123',
        data: { conversationId: 'conv-created-123' },
      })
    })

    expect(storeState.activeStream).toBe(existingStream)
    expect(logger.info).not.toHaveBeenCalledWith(
      'sse.stream.active_stream.created',
      expect.anything()
    )
  })

  it('warns when creating an SSE active stream without a conversation id', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'chunk', content: 'hello', data: {} })
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'sse.stream.active_stream.missing_conversation_id',
      expect.objectContaining({ appId: 'test-app-123', reason: 'chunk' })
    )
  })

  it('creates an active stream before replayed SSE events are applied', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          hasBufferedEvents: true,
          bufferedCount: 2,
          conversationId: 'conv-created-123',
          streamCompleted: false,
        },
      })
    })

    expect(storeState.activeStream).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^sse_recovered_/),
      role: 'assistant',
      isComplete: false,
    }))
    expect(storeState.streamingState).toBe('streaming')
  })

  it('triggers loadHistory fallback when loss detected with failed inline history and active stream', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    // Even though there are buffered events (active stream), the history fallback
    // should fire because inline history failed and data was lost.
    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
  })

  it('does not mark recovery complete until fallback history succeeds after inline history failure', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
    expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)

    mockSetHistoryLoadingComplete.mockClear()
    mockSetHistoryLoadRequested.mockClear()
    mockSetHistoryPagination.mockClear()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'replay_complete',
        data: { replayedCount: 5 },
      })
    })

    expect(mockSetHistoryPagination).not.toHaveBeenCalled()
    expect(mockSetHistoryLoadingComplete).not.toHaveBeenCalledWith(true)
    expect(mockSetHistoryLoadRequested).not.toHaveBeenCalledWith(false)

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'history_loaded',
        data: { hasMore: false, nextCursor: null, messageCount: 2 },
      })
    })

    expect(mockSetHistoryPagination).toHaveBeenCalledWith({ hasMore: false, nextCursor: null })
    expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(true)
  })

  it('keeps fallback history retryable when fallback history fails after replay_complete', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    mockSetHistoryLoadingComplete.mockClear()
    mockSetHistoryLoadRequested.mockClear()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'replay_complete',
        data: { replayedCount: 5 },
      })
      lastTransport.callbacks?.onEvent({
        type: 'history_loaded',
        data: { error: 'History fetch failed: 500', hasMore: false, nextCursor: null, messageCount: 0 },
      })
    })

    expect(mockSetHistoryLoadingComplete).not.toHaveBeenCalledWith(true)
    expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)
  })

  it('does not release a deferred initial history load when fallback history succeeds before replay_complete', async () => {
    mockConversationIdFromCookie = 'conv-abc-123'
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('connected')
    })

    expect(lastTransport.loadHistory).not.toHaveBeenCalled()
    expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'history_loaded',
        data: { hasMore: false, nextCursor: null, messageCount: 2 },
      })
      lastTransport.callbacks?.onEvent({
        type: 'replay_complete',
        data: { replayedCount: 5 },
      })
    })

    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
    expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(true)
  })

  it('clears pending fallback recovery on transport error', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
      lastTransport.callbacks?.onError(new Error('sse_transport_unreachable'))
    })

    mockSetHistoryLoadingComplete.mockClear()
    mockSetHistoryLoadRequested.mockClear()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'replay_complete',
        data: { replayedCount: 5 },
      })
    })

    expect(mockSetHistoryLoadingComplete).not.toHaveBeenCalledWith(true)
    expect(mockSetHistoryLoadRequested).not.toHaveBeenCalledWith(false)
  })

  it('does not double-load history when streamCompleted path already handles it', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: true,
          historyMessageCount: 0,
          historyStreaming: false,
          hasBufferedEvents: false,
          bufferedCount: 0,
          streamCompleted: true,
          conversationId: 'conv-created-123',
        },
      })
    })

    // streamCompleted + !hasBufferedEvents triggers startInitialHistoryLoad.
    // The historyLoadFailed fallback should NOT also fire (double-load).
    expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
  })

  it('does not trigger loadHistory fallback when historyLoadFailed is false', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'recovery_status',
        data: {
          lossDetected: true,
          historyLoadFailed: false,
          historyMessageCount: 3,
          historyStreaming: true,
          hasBufferedEvents: true,
          bufferedCount: 5,
          streamCompleted: false,
          conversationId: 'conv-created-123',
        },
      })
    })

    // History was delivered inline — no fallback needed.
    expect(lastTransport.loadHistory).not.toHaveBeenCalled()
  })

  it('complete event calls flushStoreUpdateBufferImmediate then finalizeStream', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'complete', data: {} })
    })

    expect(mockFlushStoreUpdateBufferImmediate).toHaveBeenCalled()
    expect(mockFinalizeStream).toHaveBeenCalled()
  })

  describe('postInitialBuildEvent', () => {
    it('should call postInitialBuildEvent with appId when complete event has a commitHash', async () => {
      await setupHook('test-app-123')

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { commitHash: 'abc123' },
        })
      })

      expect(mockPostInitialBuildEvent).toHaveBeenCalledWith('test-app-123')
    })

    it('should not call postInitialBuildEvent when complete event has no commitHash', async () => {
      await setupHook('test-app-123')

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'complete', data: {} })
      })

      expect(mockPostInitialBuildEvent).not.toHaveBeenCalled()
    })

    it('should not call postInitialBuildEvent when appId is null', async () => {
      await setupHook()
      currentAppId = null

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { commitHash: 'abc123' },
        })
      })

      expect(mockPostInitialBuildEvent).not.toHaveBeenCalled()
    })

    // AIROBUILD-2665 / A1 — the kit-attach interview turn parks on an unanswered
    // askQuestion AND commits its forced-install tokens, so the complete event
    // carries a commitHash. That commitHash must NOT flip the client first-build
    // flag: a parked askQuestion is a pre-build interview, not a completed build.
    // So neither postInitialBuildEvent (optimistic client flip) nor
    // trackInitialBuildComplete (build-complete telemetry) may fire.
    //
    // GATED on `appbuilder-design-kit-gallery`: the skip only applies with the
    // gallery flag ON (default in these tests). The flag-off case below proves the
    // non-gallery path is unchanged (both still fire on a parked turn).
    function parkedAskQuestionMessages() {
      return [
        { id: 'u1', role: 'user' as const, content: 'build me a coffee shop', timestamp: new Date() },
        {
          id: 'a1',
          role: 'assistant' as const,
          content: 'A few questions first.',
          timestamp: new Date(),
          toolCalls: [
            {
              id: 'tc-ask',
              name: 'askQuestion',
              input: {},
              status: 'completed' as const,
              result: {
                output: {
                  widgetData: {
                    currentQuestionIndex: 0,
                    questions: [
                      {
                        question: 'What is your brand voice?',
                        suggestions: [{ text: 'Warm and rustic' }, { text: 'Modern and minimal' }],
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      ]
    }

    it('does NOT call postInitialBuildEvent or trackInitialBuildComplete when parked on an unanswered askQuestion (commitHash present, gallery flag ON)', async () => {
      mockDesignKitGalleryEnabled = true
      storeState.messages = parkedAskQuestionMessages()
      await setupHook('test-app-123')

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { commitHash: 'abc123' },
        })
      })

      expect(mockPostInitialBuildEvent).not.toHaveBeenCalled()
      expect(mockTrackInitialBuildComplete).not.toHaveBeenCalled()
    })

    it('DOES call BOTH on a parked askQuestion when the gallery flag is OFF (non-gallery path unchanged)', async () => {
      // Regression guard: A1 must be inert with appbuilder-design-kit-gallery off,
      // so the standard design-system flow (which also ends its first build on a
      // "Do you like the design?" askQuestion) behaves exactly as before A1.
      mockDesignKitGalleryEnabled = false
      storeState.messages = parkedAskQuestionMessages()
      await setupHook('test-app-123')

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { commitHash: 'abc123' },
        })
      })

      expect(mockPostInitialBuildEvent).toHaveBeenCalledWith('test-app-123')
      expect(mockTrackInitialBuildComplete).toHaveBeenCalledWith('abc123')
    })

    it('calls BOTH postInitialBuildEvent and trackInitialBuildComplete on a normal complete (commitHash present, not parked)', async () => {
      storeState.messages = [
        { id: 'u1', role: 'user' as const, content: 'add a hero section', timestamp: new Date() },
        { id: 'a1', role: 'assistant' as const, content: 'Done — added the hero section.', timestamp: new Date() },
      ]
      await setupHook('test-app-123')

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { commitHash: 'abc123' },
        })
      })

      expect(mockPostInitialBuildEvent).toHaveBeenCalledWith('test-app-123')
      expect(mockTrackInitialBuildComplete).toHaveBeenCalledWith('abc123')
    })
  })

  describe('complete event trace ID extraction', () => {
    it('populates store with traceId, observationId, and requestId from complete event', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'complete',
          data: { traceId: 'trace-abc', observationId: 'obs-xyz', requestId: 'req-123' },
        })
      })

      expect(mockSetLastCompleteTraceIds).toHaveBeenCalledWith({
        traceId: 'trace-abc',
        observationId: 'obs-xyz',
        requestId: 'req-123',
      })
    })

    it('clears trace IDs when complete event has no traceId', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'complete', data: {} })
      })

      expect(mockSetLastCompleteTraceIds).toHaveBeenCalledWith(null)
    })
  })

  it('error event calls store.markUpstreamError', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'error', content: 'something went wrong', data: {} })
    })

    expect(mockMarkUpstreamError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'something went wrong', type: 'UPSTREAM_ERROR' })
    )
  })

  it('stream_error event calls store.markUpstreamError', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'stream_error', content: 'upstream failed', data: {} })
    })

    expect(mockMarkUpstreamError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'upstream failed' })
    )
  })

  it('error event sanitizes gateway timeout before markUpstreamError', async function gatewayTimeoutErrorEvent() {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'error', content: 'Gateway Time-out', data: {} })
    })

    expect(mockMarkUpstreamError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'builder_common_error_generic',
        type: 'UPSTREAM_ERROR',
        statusCode: 504,
      })
    )
  })

  it('copies retry metadata from SSE error events into StructuredError', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'error',
        content: 'retry failed',
        data: {
          errorType: 'RETRY_ERROR',
          statusCode: 500,
          retryAttempts: 3,
          retryReason: 'maxRetriesExceeded',
          timestamp: '2026-05-26T00:00:00.000Z',
        },
      })
    })

    expect(mockMarkUpstreamError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'builder_common_error_generic',
      type: 'RETRY_ERROR',
      statusCode: 500,
      retryAttempts: 3,
      retryReason: 'maxRetriesExceeded',
      timestamp: '2026-05-26T00:00:00.000Z',
    }))
  })

  it('stream_retry clears retry UI when requestId matches the active stream', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'step_start',
        data: { requestId: 'req-active' },
      })
      lastTransport.callbacks?.onEvent({
        type: 'stream_retry',
        data: { requestId: 'req-active', reason: 'budget_exceeded_grant_advanced' },
      })
    })

    expect(mockFlushStoreUpdateBufferImmediate).toHaveBeenCalled()
    expect(mockClearStreamForRetry).toHaveBeenCalled()
  })

  it('stream_retry without requestId bypasses guard and clears UI', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'step_start',
        data: { requestId: 'req-active' },
      })
      lastTransport.callbacks?.onEvent({
        type: 'stream_retry',
        data: { reason: 'budget_exceeded_grant_advanced' },
      })
    })

    expect(mockFlushStoreUpdateBufferImmediate).toHaveBeenCalled()
    expect(mockClearStreamForRetry).toHaveBeenCalled()
  })

  it('ignores stale stream_retry events for a prior requestId', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'step_start',
        data: { requestId: 'req-current' },
      })
      lastTransport.callbacks?.onEvent({
        type: 'stream_retry',
        data: { requestId: 'req-stale', reason: 'budget_exceeded_grant_advanced' },
      })
    })

    expect(mockClearStreamForRetry).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'sse.stream_retry.stale_ignored',
      expect.objectContaining({ requestId: 'req-stale', activeRequestId: 'req-current' }),
    )
  })

  it('tool_start event calls bufferStoreUpdate with addToolStartSegment', async () => {
    await setupHook()
    const tool = { id: 't1', name: 'read_file', input: {}, status: 'running' as const }

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'tool_start', data: { tool } })
    })

    expect(mockBufferStoreUpdate).toHaveBeenCalled()
    expect(mockAddToolStartSegment).toHaveBeenCalledWith({
      id: 't1', name: 'read_file', input: {}, status: 'running', startTime: expect.any(Number),
    })
  })

  it('tool_call event calls bufferStoreUpdate with addToolCallSegment', async () => {
    await setupHook()
    const tool = { id: 't2', name: 'write_file', input: { path: '/foo' }, status: 'completed' as const }

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'tool_call', data: { tool } })
    })

    expect(mockBufferStoreUpdate).toHaveBeenCalled()
    // mapToolCall always sets status: 'running' regardless of the incoming tool.status
    expect(mockAddToolCallSegment).toHaveBeenCalledWith({
      id: 't2', name: 'write_file', input: { path: '/foo' }, status: 'running',
    })
  })

  it('tool_result event calls bufferStoreUpdate with addToolResultSegment', async () => {
    await setupHook()
    const tool = { id: 't3', name: 'read_file', input: { path: '/bar' }, result: 'content', startTime: 123, status: 'completed' as const }

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'tool_result', data: { tool } })
    })

    expect(mockBufferStoreUpdate).toHaveBeenCalled()
    expect(mockAddToolResultSegment).toHaveBeenCalledWith({
      id: 't3', name: 'read_file', input: { path: '/bar' }, result: 'content',
      error: undefined, status: 'completed', startTime: 123, endTime: expect.any(Number),
    })
  })

  it('validation_message running event adds a validateCode tool-start segment', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'validation_message',
        content: 'Validating code...',
        data: {
          validationId: 'post_stream_validation_0_123',
          metadata: { source: 'post_stream_validator', displayAs: 'validation', validationStatus: 'running' },
          agentId: 'develop',
        },
      })
    })

    expect(mockAddToolStartSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'post_stream_validation_0_123',
      name: 'validateCode',
      status: 'running',
    }))
    expect(mockAddToolResultSegment).not.toHaveBeenCalled()
  })

  it('validation_message completed event adds both start and result segments', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'validation_message',
        content: 'No issues found.',
        data: {
          validationId: 'post_stream_validation_0_123',
          metadata: { source: 'post_stream_validator', displayAs: 'validation', validationStatus: 'completed' },
          agentId: 'develop',
        },
      })
    })

    expect(mockAddToolStartSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'post_stream_validation_0_123',
      name: 'validateCode',
      status: 'completed',
    }))
    expect(mockAddToolResultSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'post_stream_validation_0_123',
      status: 'completed',
    }))
  })

  it('validation_message error event populates the error field on the tool call', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'validation_message',
        content: 'Validation could not resolve all issues.',
        data: {
          validationId: 'post_stream_validation_2_789',
          metadata: { source: 'post_stream_validator', displayAs: 'validation', validationStatus: 'error' },
          agentId: 'develop',
        },
      })
    })

    expect(mockAddToolResultSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'post_stream_validation_2_789',
      name: 'validateCode',
      status: 'error',
      error: 'Validation could not resolve all issues.',
    }))
  })

  it('validation_message failed event marks the tool call completed with diagnostics', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'validation_message',
        content: 'tsc reported 1 error in src/foo.ts',
        data: {
          validationId: 'post_stream_validation_1_456',
          messageId: 'persisted-789',
          role: 'user',
          metadata: { source: 'post_stream_validator', displayAs: 'validation', validationStatus: 'failed' },
          agentId: 'develop',
        },
      })
    })

    expect(mockAddToolResultSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'post_stream_validation_1_456',
      name: 'validateCode',
      result: expect.objectContaining({ status: 'failed', diagnostics: 'tsc reported 1 error in src/foo.ts' }),
    }))
  })

  it('tool_result event does not synthesize an active stream', async () => {
    await setupHook()
    const tool = { id: 't3', name: 'read_file', input: { path: '/bar' }, result: 'content', startTime: 123, status: 'completed' as const }
    storeState.activeStream = null

    act(() => {
      lastTransport.callbacks?.onEvent({ type: 'tool_result', data: { tool } })
    })

    expect(storeState.activeStream).toBeNull()
    expect(mockAddToolResultSegment).toHaveBeenCalled()
  })

  it('tool_result event with enriched SSE metadata still renders tool result segment', async () => {
    await setupHook()
    const tool = { id: 't4', name: 'read_file', input: { path: '/baz' }, output: 'ok' }

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'tool_result',
        data: {
          source: 'ai_response',
          messageId: 'agent-msg-44',
          agentId: 'develop',
          toolName: 'read_file',
          tool,
        },
      })
    })

    expect(mockAddToolResultSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 't4',
      name: 'read_file',
      result: 'ok',
      status: 'completed',
    }))
  })

  it('tool_input_delta event calls updateToolDelta and scheduleToolDeltaFlush', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'tool_input_delta',
        data: { toolId: 't1', toolName: 'write_file', delta: '{"path":' },
      })
    })

    expect(mockBufferStoreUpdate).toHaveBeenCalled()
    expect(mockUpdateToolDelta).toHaveBeenCalledWith('t1', 'write_file', '{"path":')
    expect(mockScheduleToolDeltaFlush).toHaveBeenCalled()
  })

  it('error event flushes buffer and finalizes stream', async () => {
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'error',
        content: 'something broke',
        data: {},
      })
    })

    expect(mockFlushStoreUpdateBufferImmediate).toHaveBeenCalled()
    expect(mockMarkUpstreamError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'something broke', type: 'UPSTREAM_ERROR' })
    )
    expect(mockFinalizeStream).toHaveBeenCalled()
  })

  it('sendMessage calls startNewStream before sending', async () => {
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hello' })
    })

    expect(mockStartNewStream).toHaveBeenCalledWith('hello', undefined, undefined, 'customer', undefined, undefined)
    expect(mockSetIsLoading).toHaveBeenCalledWith(true)
  })

  it.each([
    ['e2s'],
    ['e2s2s'],
  ])('sendMessage sets support origin for %s auth type', async (authType) => {
    mockTokenAuthType = authType
    const hook = await setupHook(`app-${authType}-origin`)

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hello from support' })
    })

    expect(mockStartNewStream).toHaveBeenCalledWith('hello from support', undefined, undefined, 'support', undefined, undefined)
  })

  it('sendMessage defaults to customer origin when auth type has not resolved', async () => {
    mockTokenAuthType = undefined
    const hook = await setupHook('app-pending-auth-origin')

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hello before auth resolves' })
    })

    expect(mockStartNewStream).toHaveBeenCalledWith('hello before auth resolves', undefined, undefined, 'customer', undefined, undefined)
  })

  it('sendMessage uses latest auth type after auth context changes', async () => {
    mockTokenAuthType = undefined
    const hook = await setupHook('app-auth-refresh-origin')

    mockTokenAuthType = 'e2s'
    hook.rerender()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hello after auth resolves' })
    })

    expect(mockStartNewStream).toHaveBeenCalledWith('hello after auth resolves', undefined, undefined, 'support', undefined, undefined)
  })

  it('sendMessage calls transport.sendMessage with correct params', async () => {
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'build a login page' })
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'build a login page', sessionId: 'test-app-123', userTimezone: expect.any(String) })
    )
  })

  it('sendMessage maps transport failures to friendly upstream error copy', async function sendFailureFriendlyCopy() {
    const hook = await setupHook()
    lastTransport.sendMessage.mockRejectedValueOnce(new Error('Gateway Time-out'))

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hello' })
    })

    expect(mockMarkUpstreamError).toHaveBeenCalledWith({
      message: 'builder_common_error_generic',
      type: 'UPSTREAM_ERROR',
      statusCode: 504,
    })
    expect(mockFinalizeStream).toHaveBeenCalled()
    expect(mockSetIsLoading).toHaveBeenCalledWith(false)
  })

  it('sendMessage forwards aiEditContexts and uploadedFileName', async () => {
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({
        content: 'build with context',
        aiEditContexts: [{ id: 'ctx-1' }] as any,
        uploadedFileName: 'logo.png',
      })
    })

    expect(mockStartNewStream).toHaveBeenCalledWith(
      'build with context',
      undefined,
      undefined,
      'customer',
      'logo.png',
      undefined,
    )
    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      aiEditContexts: [{ id: 'ctx-1' }],
      uploadedFileName: 'logo.png',
    }))
  })

  it('APP_NOT_FOUND resend forwards aiEditContexts and uploadedFileName', async () => {
    const hook = await setupHook()
    storeState.buildErrorContext = { error: 'build failed', details: 'stderr', exitCode: 1 }

    await act(async () => {
      await hook.result.current.actions.send({
        content: 'build with retry context',
        aiEditContexts: [{ id: 'ctx-1' }] as any,
        uploadedFileName: 'logo.png',
      })
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      aiEditContexts: [{ id: 'ctx-1' }],
      uploadedFileName: 'logo.png',
      buildErrorContext: { error: 'build failed', details: 'stderr', exitCode: 1 },
    }))
    lastTransport.sendMessage.mockClear()
    vi.useFakeTimers()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'stream_error',
        content: 'app not ready',
        data: { errorType: 'APP_NOT_FOUND', message: 'app not ready' },
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'build with retry context',
      aiEditContexts: [{ id: 'ctx-1' }],
      uploadedFileName: 'logo.png',
      buildErrorContext: { error: 'build failed', details: 'stderr', exitCode: 1 },
    }))
  })

  it('APP_NOT_FOUND retry fires a second time with same resolved params', async () => {
    const hook = await setupHook()
    storeState.buildErrorContext = { error: 'build failed', details: 'stderr', exitCode: 1 }

    await act(async () => {
      await hook.result.current.actions.send({
        content: 'build with retry context',
        aiEditContexts: [{ id: 'ctx-1' }] as any,
        uploadedFileName: 'logo.png',
      })
    })

    lastTransport.sendMessage.mockClear()
    vi.useFakeTimers()

    // First APP_NOT_FOUND retry
    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'stream_error',
        content: 'app not ready',
        data: { errorType: 'APP_NOT_FOUND', message: 'app not ready' },
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledTimes(1)
    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'build with retry context',
      aiEditContexts: [{ id: 'ctx-1' }],
      uploadedFileName: 'logo.png',
      buildErrorContext: { error: 'build failed', details: 'stderr', exitCode: 1 },
    }))

    lastTransport.sendMessage.mockClear()

    // Second APP_NOT_FOUND retry — params should still be intact
    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'stream_error',
        content: 'app still not ready',
        data: { errorType: 'APP_NOT_FOUND', message: 'app still not ready' },
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledTimes(1)
    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'build with retry context',
      aiEditContexts: [{ id: 'ctx-1' }],
      uploadedFileName: 'logo.png',
      buildErrorContext: { error: 'build failed', details: 'stderr', exitCode: 1 },
    }))

    vi.useRealTimers()
  })

  it('APP_NOT_FOUND resend preserves market', async () => {
    const hook = await setupHook({ market: 'es-ES' })

    await act(async () => {
      await hook.result.current.actions.send({ content: 'hola' })
    })

    lastTransport.sendMessage.mockClear()
    vi.useFakeTimers()

    act(() => {
      lastTransport.callbacks?.onEvent({
        type: 'stream_error',
        content: 'app not ready',
        data: { errorType: 'APP_NOT_FOUND', message: 'app not ready' },
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'hola',
      market: 'es-ES',
      userTimezone: expect.any(String),
    }))
  })

  it('sendMessage does nothing with empty content', async () => {
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: '   ' })
    })

    expect(lastTransport.sendMessage).not.toHaveBeenCalled()
  })

  it('sendMessage omits rebuildBringOverChoice when bring-over flag is off', async () => {
    mockBringOverTogglesEnabled = false
    mockDesignChoiceForApp = { direction: 'modernize', keepLogo: false, keepImages: false }
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'rebuild it' })
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ rebuildBringOverChoice: expect.anything() })
    )
  })

  it('sendMessage includes rebuildBringOverChoice when bring-over flag is on', async () => {
    mockBringOverTogglesEnabled = true
    const choice = { direction: 'modernize', keepLogo: false, keepImages: false }
    mockDesignChoiceForApp = choice
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'rebuild it' })
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ rebuildBringOverChoice: choice })
    )
  })

  it('with bring-over flag OFF but stored choice present, sends rebuildDesignDirection but NOT rebuildBringOverChoice', async () => {
    mockBringOverTogglesEnabled = false
    const choice = { direction: 'keep-similar', keepLogo: true, keepImages: true, keepColors: true, keepFonts: true }
    mockDesignChoiceForApp = choice
    const hook = await setupHook()

    await act(async () => {
      await hook.result.current.actions.send({ content: 'rebuild it' })
    })

    expect(lastTransport.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ rebuildDesignDirection: 'keep-similar' })
    )
    expect(lastTransport.sendMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ rebuildBringOverChoice: expect.anything() })
    )
  })

  it('stop calls transport.stopGeneration', async () => {
    const hook = await setupHook()

    act(() => {
      hook.result.current.actions.stop()
    })

    expect(lastTransport.stopGeneration).toHaveBeenCalled()
  })

  it('stop finalizes the stream locally when activeStream is set', async () => {
    const hook = await setupHook()
    storeState.activeStream = {
      id: 'stream-stop',
      role: 'assistant',
      content: '',
      segments: [],
      toolCalls: [],
      timestamp: new Date(),
      isComplete: false,
    }

    act(() => {
      hook.result.current.actions.stop()
    })

    expect(mockFinalizeStream).toHaveBeenCalledWith({ finishReason: 'user_stopped' })
  })

  it('stop does not finalize when activeStream is null', async () => {
    const hook = await setupHook()
    storeState.activeStream = null

    act(() => {
      hook.result.current.actions.stop()
    })

    expect(mockFinalizeStream).not.toHaveBeenCalled()
  })

  it('connection.isConnected is false initially', async () => {
    const hook = await setupHook()

    expect(hook.result.current.connection.isConnected).toBe(false)
  })

  it('connection.isConnected is true after connected state', async () => {
    const hook = await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('connected')
    })

    expect(hook.result.current.connection.isConnected).toBe(true)
    expect(hook.result.current.connection.status).toBe('idle')
  })

  it('stream.isStreaming is true when state is streaming', async () => {
    const hook = await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('streaming')
    })

    expect(hook.result.current.stream.isStreaming).toBe(true)
    expect(hook.result.current.connection.status).toBe('streaming')
  })

  it('connection.status is error when state is error', async () => {
    const hook = await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('error')
    })

    expect(hook.result.current.connection.status).toBe('error')
  })

  it('connection.status is idle (not error) when state is dormant', async () => {
    const hook = await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('dormant')
    })

    expect(hook.result.current.connection.status).toBe('idle')
    expect(hook.result.current.connection.isConnected).toBe(false)
  })

  it('syncs transport state to streaming conversation store', async () => {
    mockSetConnectionState.mockClear()
    await setupHook()

    act(() => {
      lastTransport.callbacks?.onStateChange('connected')
    })

    expect(mockSetConnectionState).toHaveBeenCalledWith({ connected: true, status: 'idle' })

    mockSetConnectionState.mockClear()

    act(() => {
      lastTransport.callbacks?.onStateChange('streaming')
    })

    expect(mockSetConnectionState).toHaveBeenCalledWith({ connected: true, status: 'streaming' })
  })

  // ---------------------------------------------------------------------------
  // History loading
  // ---------------------------------------------------------------------------

  describe('history loading', () => {
    it('loads initial history after recovery reports no buffered replay', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)
      expect(lastTransport.loadHistory).toHaveBeenCalledWith()
    })

    it('does not duplicate initial history load when connected fallback fires after recovery', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)

      act(() => {
        lastTransport.callbacks?.onStateChange('connected')
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
    })

    it('loads initial history on legacy server_config fallback when recovery_status is absent', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'server_config',
          data: { supportsConnectThenAuth: false, serverVersion: '2.0' },
        })
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)
    })

    it('marks history complete when connected fallback finds no conversation cookie', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      mockConversationIdFromCookie = null
      mockSetHistoryLoadingComplete.mockClear()

      act(() => {
        lastTransport.callbacks?.onStateChange('connected')
      })

      expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(true)
    })

    it('loads initial history after creating a conversation once recovery reports no buffered replay', async () => {
      mockConversationIdFromCookie = null
      await setupHook()

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)
      expect(lastTransport.loadHistory).toHaveBeenCalledWith()
    })

    it('defers initial history until buffered recovery replay completes', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            hasBufferedEvents: true,
            bufferedCount: 17,
            conversationId: 'conv-abc-123',
            streamCompleted: false,
          },
        })
      })

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'replayed response',
          conversationId: 'conv-abc-123',
          data: {},
          sequence: 4286,
        })
      })

      expect(mockBufferTextChunk).toHaveBeenCalledWith('replayed response')
      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      mockSetHistoryLoadRequested.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { lastSequence: 4286, replayedCount: 17 },
        })
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { lastSequence: 4286, replayedCount: 0 },
        })
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
    })

    it('clears a deferred initial history load on transport error so recovery can retry', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            hasBufferedEvents: true,
            bufferedCount: 2,
            conversationId: 'conv-abc-123',
            streamCompleted: false,
          },
        })
      })

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()

      mockSetHistoryLoadRequested.mockClear()

      act(() => {
        lastTransport.callbacks?.onError(new Error('boom'))
      })

      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)

      mockSetHistoryLoadRequested.mockClear()
      lastTransport.loadHistory.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            hasBufferedEvents: true,
            bufferedCount: 1,
            conversationId: 'conv-abc-123',
            streamCompleted: false,
          },
        })
      })

      act(() => {
        lastTransport.callbacks?.onStateChange('connected')
      })

      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)
      expect(lastTransport.loadHistory).not.toHaveBeenCalled()
    })

    it('skips history load if already requested', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      storeState = { historyLoadRequested: true }
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onStateChange('connected')
      })

      expect(lastTransport.loadHistory).not.toHaveBeenCalled()
    })

    it('history_loaded event sets pagination and marks complete', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { hasMore: true, nextCursor: 'cursor-1', messageCount: 5 },
        })
      })

      expect(mockSetHistoryPagination).toHaveBeenCalledWith({ hasMore: true, nextCursor: 'cursor-1' })
      expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(true)
    })

    it('history_loaded with error resets historyLoadRequested and remains retryable', async () => {
      await setupHook()
      mockSetHistoryLoadingComplete.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { error: true, hasMore: false, nextCursor: null, messageCount: 0 },
        })
      })

      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)
      // Keep the transcript in loading/retry state. StreamingMessageList owns
      // the retry cap and explicit history-load failure UI.
      expect(mockSetHistoryLoadingComplete).not.toHaveBeenCalled()
    })

    it('history_complete event updates pagination and clears loading', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_complete',
          data: { hasMore: false, nextCursor: null, messageCount: 3 },
        })
      })

      expect(mockSetHistoryPagination).toHaveBeenCalledWith({ hasMore: false, nextCursor: null })
      expect(mockSetHistoryLoadingMore).toHaveBeenCalledWith(false)
    })

    it('loadMore calls transport.loadHistory with cursor', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      const hook = await setupHook()

      const result = hook.result.current.actions.loadHistory({ cursor: 'page-2', limit: 20 })

      expect(result).toBe(true)
      expect(mockSetHistoryLoadingMore).toHaveBeenCalledWith(true)
      expect(lastTransport.loadHistory).toHaveBeenCalledWith({
        cursor: 'page-2',
        limit: 20,
      })
    })

    it('loadMore without cursor retries initial load and sets dedupe guard', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      const hook = await setupHook()
      lastTransport.loadHistory.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { error: true, hasMore: false, nextCursor: null, messageCount: 0 },
        })
      })

      const result = hook.result.current.actions.loadHistory()

      expect(result).toBe(true)
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(true)
      expect(lastTransport.loadHistory).toHaveBeenCalledWith({
        cursor: undefined,
        limit: undefined,
      })
    })

    it('loadMore without cursor returns false while initial history load is in flight', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      const hook = await setupHook()
      lastTransport.loadHistory.mockClear()

      const result = hook.result.current.actions.loadHistory()

      expect(result).toBe(false)
      expect(lastTransport.loadHistory).not.toHaveBeenCalled()
    })

    it('does not duplicate retry initial history load when connected fallback fires', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      const hook = await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { error: true, hasMore: false, nextCursor: null, messageCount: 0 },
        })
      })

      lastTransport.loadHistory.mockClear()

      const result = hook.result.current.actions.loadHistory()
      expect(result).toBe(true)
      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)

      act(() => {
        lastTransport.callbacks?.onStateChange('connected')
      })

      expect(lastTransport.loadHistory).toHaveBeenCalledTimes(1)
    })

    it('loadMore returns false when no conversationId', async () => {
      mockConversationIdFromCookie = null
      const hook = await setupHook()
      lastTransport.loadHistory.mockClear()

      const result = hook.result.current.actions.loadHistory({ cursor: 'abc' })

      expect(result).toBe(false)
      expect(lastTransport.loadHistory).not.toHaveBeenCalled()
    })

    it('skips setHistoryPagination on error to preserve cursor for retry', async () => {
      mockConversationIdFromCookie = 'conv-abc-123'
      await setupHook()

      // Simulate initial recovery completing (triggers history load)
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      // Simulate successful initial history load with pagination
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { hasMore: true, nextCursor: 'cursor-page-2', messageCount: 25 },
        })
      })

      expect(mockSetHistoryPagination).toHaveBeenLastCalledWith({
        hasMore: true,
        nextCursor: 'cursor-page-2',
      })
      mockSetHistoryPagination.mockClear()

      // Simulate pagination failure
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_complete',
          data: { error: 'History fetch failed: 500', hasMore: true, nextCursor: 'cursor-page-2', messageCount: 0 },
        })
      })

      // Pagination state NOT updated — hasMore/nextCursor preserved from last
      // success so scroll-to-top retry works (matches WS HistoryCompleteHandler)
      expect(mockSetHistoryPagination).not.toHaveBeenCalled()
      expect(mockSetHistoryLoadingMore).toHaveBeenCalledWith(false)
    })

    it('history_message events are batched and flushed via history_loaded', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'history_message',
          data: { data: { id: 'msg-1', sender: 'user', content: 'hello' } },
        })
        lastTransport.callbacks?.onEvent({
          type: 'history_message',
          data: { data: { id: 'msg-2', sender: 'assistant', content: 'hi' } },
        })
        lastTransport.callbacks?.onEvent({
          type: 'history_loaded',
          data: { hasMore: false, nextCursor: null, messageCount: 2 },
        })
      })

      expect(mockLoadAndPersistHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          rawMessages: expect.arrayContaining([
            expect.objectContaining({ id: 'msg-1' }),
            expect.objectContaining({ id: 'msg-2' }),
          ]),
          mode: 'replace',
          detectInProgress: true,
        })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Client actions
  // ---------------------------------------------------------------------------

  describe('client actions', () => {
    it('executes known action and posts success result', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'client_action',
          data: { action: 'publishAction', params: { version: '1.0' }, requestId: 'req-1' },
        })
        await flushPromises()
      })

      expect(mockPublishAction).toHaveBeenCalledWith({ version: '1.0' }, expect.objectContaining({ currentAppId: 'test-app-123' }), 'req-1')
      expect(lastTransport.postClientActionResult).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-1', success: true })
      )
    })

    it('posts error result for unknown action', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'client_action',
          data: { action: 'nonExistentAction', params: {}, requestId: 'req-2' },
        })
        await flushPromises()
      })

      expect(lastTransport.postClientActionResult).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-2', success: false, error: 'Unknown action: nonExistentAction' })
      )
    })

    it('posts error result when executor throws', async () => {
      mockGetSiteDataAction.mockRejectedValueOnce(new Error('fetch failed'))
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'client_action',
          data: { action: 'getSiteDataAction', params: {}, requestId: 'req-3' },
        })
        await flushPromises()
      })

      expect(lastTransport.postClientActionResult).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-3', success: false, error: 'fetch failed' })
      )
    })

    it('ignores client_action without requestId', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'client_action',
          data: { action: 'publishAction', params: {} },
        })
        await flushPromises()
      })

      expect(mockPublishAction).not.toHaveBeenCalled()
      expect(lastTransport.postClientActionResult).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Video events
  // ---------------------------------------------------------------------------

  describe('video events', () => {
    it('sets success video result on completed status', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'video',
          data: { appId: 'test-app-123', status: 'completed', videoUrl: 'https://example.com/video.mp4' },
        })
        await flushPromises()
      })

      expect(mockSetLaunchVideoResult).toHaveBeenCalledWith(
        'test-app-123',
        { type: 'success', url: 'https://example.com/video.mp4' }
      )
    })

    it('sets error video result on failed status', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'video',
          data: { appId: 'test-app-123', status: 'failed', error: 'Render timeout' },
        })
        await flushPromises()
      })

      // Matches the WS VideoHandler reference: the store carries a generic
      // failure message; the specific error is logged, not surfaced here.
      expect(mockSetLaunchVideoResult).toHaveBeenCalledWith(
        'test-app-123',
        { type: 'error', message: 'Video generation failed' }
      )
    })

    it('uses store currentAppId when video event has no appId', async () => {
      await setupHook()

      await act(async () => {
        lastTransport.callbacks?.onEvent({
          type: 'video',
          data: { status: 'completed', videoUrl: 'https://example.com/v.mp4' },
        })
        await flushPromises()
      })

      expect(mockSetLaunchVideoResult).toHaveBeenCalledWith(
        'test-app-123',
        expect.objectContaining({ type: 'success' })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Connection recovery
  // ---------------------------------------------------------------------------

  describe('connection recovery', () => {
    it('recovery_status with buffered events sets streaming state', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 5, streamCompleted: false },
        })
      })

      expect(mockSetConnectionState).toHaveBeenCalledWith({ connected: true, status: 'streaming' })
    })

    it('replay_complete finalizes when buffered recovery completed the stream', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            hasBufferedEvents: true,
            bufferedCount: 5,
            streamCompleted: true,
            conversationId: 'conv-created-123',
          },
        })
      })

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { replayedCount: 5 },
        })
      })

      expect(mockFlushStoreUpdateBufferImmediate).toHaveBeenCalled()
      expect(mockFinalizeStream).toHaveBeenCalled()
      expect(mockSetConnectionState).toHaveBeenCalledWith({ connected: true, status: 'idle' })
    })

    it('lossDetected recovery flushes inline history on replay_complete', async () => {
      await setupHook()
      mockLoadAndPersistHistory.mockClear()
      mockSetHistoryPagination.mockClear()
      mockSetHistoryLoadingComplete.mockClear()
      mockSetHistoryLoadRequested.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            lossDetected: true,
            hasBufferedEvents: false,
            streamCompleted: true,
            historyHasMore: true,
            historyNextCursor: 'cursor-1',
          },
        })
        lastTransport.callbacks?.onEvent({
          type: 'history_message',
          data: { data: { id: 'msg-1', sender: 'assistant', content: 'recovered' } },
        })
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { replayedCount: 0 },
        })
      })

      expect(mockLoadAndPersistHistory).toHaveBeenCalledWith(expect.objectContaining({
        rawMessages: [expect.objectContaining({ id: 'msg-1' })],
        mode: 'replace',
        detectInProgress: true,
      }))
      expect(mockSetHistoryPagination).toHaveBeenCalledWith({ hasMore: true, nextCursor: 'cursor-1' })
      expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(true)
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)
    })

    it('recovery_status for a completed stream reloads history', async () => {
      await setupHook()
      storeState.activeStream = {
        id: 'stream-to-clear',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      }
      lastTransport.loadHistory.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: true },
        })
      })

      expect(mockClearActiveStream).toHaveBeenCalled()
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)
      expect(lastTransport.loadHistory).toHaveBeenCalled()
    })

    it('terminal transport error during streaming clears the active stream and loading state', async () => {
      await setupHook()
      storeState.activeStream = {
        id: 'stream-in-cooldown',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      }

      act(() => {
        lastTransport.callbacks?.onError(new Error('sse_transport_unreachable'))
      })

      expect(mockClearActiveStream).toHaveBeenCalled()
      expect(mockSetIsLoading).toHaveBeenCalledWith(false)
    })

    it('uses the latest recovery_status to decide whether replay_complete finalizes', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: {
            hasBufferedEvents: true,
            bufferedCount: 5,
            streamCompleted: true,
            conversationId: 'conv-created-123',
          },
        })
      })

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { replayedCount: 5 },
        })
      })

      expect(mockFinalizeStream).not.toHaveBeenCalled()
    })

    it('recovery_status without buffered events does not set streaming', async () => {
      mockSetConnectionState.mockClear()
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      // Should NOT have been called with streaming status from the recovery event
      const streamingCalls = mockSetConnectionState.mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.status === 'streaming'
      )
      expect(streamingCalls).toHaveLength(0)
    })

    it('deduplicates replay events by SSE sequence while recovery replay is active', async () => {
      await setupHook()
      mockBufferTextChunk.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 2, streamCompleted: false },
        })
      })

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'hello',
          data: {},
          sequence: 77,
        })
      })
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'hello',
          data: {},
          sequence: 77,
        })
      })

      expect(mockBufferTextChunk).toHaveBeenCalledTimes(1)

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { replayedCount: 2 },
        })
      })
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 1, streamCompleted: false },
        })
      })
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'new cycle',
          data: {},
          sequence: 77,
        })
      })

      expect(mockBufferTextChunk).toHaveBeenCalledTimes(2)
    })

    it('clears recovery dedupe state on terminal transport error', async () => {
      await setupHook()
      mockBufferTextChunk.mockClear()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 1, streamCompleted: false },
        })
      })
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'before error',
          data: {},
          sequence: 77,
        })
      })
      act(() => {
        lastTransport.callbacks?.onError(new Error('sse_transport_unreachable'))
      })
      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'chunk',
          content: 'after error',
          data: {},
          sequence: 77,
        })
      })

      expect(mockBufferTextChunk).toHaveBeenCalledTimes(2)
    })

    it('ambiguous recovery_status clears stale activeStream when history is complete', async () => {
      await setupHook()
      storeState.activeStream = {
        id: 'stale-placeholder',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      }
      storeState.messages = [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'done' },
      ]

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(mockClearActiveStream).toHaveBeenCalled()
    })

    it('recovery_status with buffered events does not clear activeStream via the fallback', async () => {
      await setupHook()
      storeState.messages = [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'done' },
      ]

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 3, streamCompleted: false },
        })
      })

      expect(mockClearActiveStream).not.toHaveBeenCalled()
    })

    it('streamCompleted=true does not fire the ambiguous fallback', async () => {
      await setupHook()
      storeState.messages = [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'done' },
      ]

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: true },
        })
      })

      // clearActiveStream should fire from the existing streamCompleted branch,
      // not the fallback — but only when activeStream is set (it isn't here).
      expect(mockClearActiveStream).not.toHaveBeenCalled()
    })

    it('ambiguous recovery_status with null activeStream does not call clearActiveStream', async () => {
      await setupHook()
      storeState.activeStream = null
      storeState.messages = [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'done' },
      ]

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(mockClearActiveStream).not.toHaveBeenCalled()
    })

    it('ambiguous recovery_status with only user messages does not clear activeStream', async () => {
      await setupHook()
      storeState.activeStream = {
        id: 'live-placeholder',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [],
        timestamp: new Date(),
        isComplete: false,
      }
      storeState.messages = [
        { id: 'm1', role: 'user', content: 'hello' },
      ]

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: false, bufferedCount: 0, streamCompleted: false },
        })
      })

      expect(mockClearActiveStream).not.toHaveBeenCalled()
    })

    it('replay_complete event does not throw', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'replay_complete',
          data: { replayedCount: 3 },
        })
      })

      expect(mockFinalizeStream).not.toHaveBeenCalled()
    })
  })

  describe('reconnect', () => {
    it('destroys transport, clears cache, resets history state, and creates new transport', async () => {
      const { dynamicApiConfigService } = await import('@/config/dynamic-api')
      mockConversationIdFromCookie = 'conv-abc-123'

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => {
        await flushPromises()
      })

      const firstTransport = lastTransport
      expect(firstTransport.connect).toHaveBeenCalledTimes(1)

      // Simulate archive restore: new URL available
      vi.mocked(dynamicApiConfigService.getConfigForSite).mockResolvedValue({
        baseUrl: 'https://new-agent.example.com',
      })

      // Trigger reconnect
      await act(async () => {
        await hook.result.current.actions.reconnect()
        await flushPromises()
      })

      // Old transport destroyed
      expect(firstTransport.destroy).toHaveBeenCalled()

      // Cache cleared
      expect(dynamicApiConfigService.clearCache).toHaveBeenCalledWith('test-app-123')

      // History state reset
      expect(mockClearMessages).toHaveBeenCalled()
      expect(mockSetHistoryLoadingComplete).toHaveBeenCalledWith(false)
      expect(mockSetHistoryLoadRequested).toHaveBeenCalledWith(false)

      // New transport created with fresh URL
      const { SSETransport } = await import('@/services/transport/SSETransport')
      expect(SSETransport).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseUrl: 'https://new-agent.example.com' })
      )

      hook.unmount()
    })
  })

  describe('conversation creation retry', () => {
    it('retries POST /api/conversations on failure and connects on success', async () => {
      mockConversationIdFromCookie = null
      let callCount = 0
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ conversationId: 'conv-retry-ok' }) })
      })

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => { await flushPromises() })
      // Wait for the retry delay + subsequent attempt to resolve
      await act(async () => { await new Promise(r => setTimeout(r, 1500)) })

      expect(lastTransport.connect).toHaveBeenCalledWith('test-app-123', 'test-token', 'conv-retry-ok')
      expect(logger.warn).toHaveBeenCalledWith('sse.connect.conversationCreate.retry', expect.objectContaining({ attempt: 1 }))

      hook.unmount()
    })

    it('logs error after exhausting all retries with exactly 3 retry warnings', async () => {
      mockConversationIdFromCookie = null
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      // Total retry time: 0 + 1s + 2s + 4s = 7s. Wait with margin.
      await act(async () => { await new Promise(r => setTimeout(r, 8000)) })

      expect(lastTransport.connect).not.toHaveBeenCalled()

      const retryCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls
        .filter(([event]: [string]) => event === 'sse.connect.conversationCreate.retry')
      expect(retryCalls).toHaveLength(3)
      expect(retryCalls[0][1]).toMatchObject({ attempt: 1, maxRetries: 3 })
      expect(retryCalls[1][1]).toMatchObject({ attempt: 2, maxRetries: 3 })
      expect(retryCalls[2][1]).toMatchObject({ attempt: 3, maxRetries: 3 })

      expect(logger.warn).toHaveBeenCalledWith('sse.connect.conversationCreate.exhausted', expect.objectContaining({
        maxRetries: 3, error: 'Failed to create conversation: 503',
      }))
      expect(logger.error).toHaveBeenCalledWith('sse.connect.failed', expect.objectContaining({
        error: 'Failed to create conversation: 503',
      }))

      hook.unmount()
    }, 15000)

    it('skips retry loop when conversation cookie exists', async () => {
      mockConversationIdFromCookie = 'conv-from-cookie'
      ;(global.fetch as ReturnType<typeof vi.fn>).mockClear()

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => { await flushPromises() })

      expect(lastTransport.connect).toHaveBeenCalledWith('test-app-123', 'test-token', 'conv-from-cookie')
      expect(global.fetch).not.toHaveBeenCalled()

      hook.unmount()
    })
  })

  // ---------------------------------------------------------------------------
  // SSEQualityMonitor instrumentation
  // ---------------------------------------------------------------------------

  describe('quality monitor instrumentation', () => {
    it('marks connect start and records created-conversation phases when no cookie', async () => {
      mockConversationIdFromCookie = null
      await setupHook('app-monitor-created')

      expect(mockMarkConnectStart).toHaveBeenCalledWith('app-monitor-created')
      expect(mockRecordConnectPhases).toHaveBeenCalledTimes(1)
      const phases = mockRecordConnectPhases.mock.calls[0][0]
      expect(phases).toEqual(expect.objectContaining({
        configFetchMs: expect.any(Number),
        tokenFetchMs: expect.any(Number),
        conversationCreateMs: expect.any(Number),
        conversationSource: 'created',
      }))
    })

    it('records cookie-conversation phases with no conversationCreateMs when a cookie exists', async () => {
      mockConversationIdFromCookie = 'conv-from-cookie'
      await setupHook('app-monitor-cookie')

      expect(mockRecordConnectPhases).toHaveBeenCalledTimes(1)
      const phases = mockRecordConnectPhases.mock.calls[0][0]
      expect(phases).toEqual(expect.objectContaining({
        configFetchMs: expect.any(Number),
        tokenFetchMs: expect.any(Number),
        conversationSource: 'cookie',
      }))
      expect(phases).not.toHaveProperty('conversationCreateMs')
    })

    it('marks send then first response when a chunk follows a sendMessage', async () => {
      const hook = await setupHook()

      await act(async () => {
        await hook.result.current.actions.send({ content: 'hello' })
      })

      expect(mockMarkSend).toHaveBeenCalledTimes(1)
      expect(mockMarkFirstResponse).not.toHaveBeenCalled()

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'chunk', content: 'hi', data: {} })
      })

      expect(mockMarkFirstResponse).toHaveBeenCalledTimes(1)
    })

    it('does not mark first response for a deduped replay event', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({
          type: 'recovery_status',
          data: { hasBufferedEvents: true, bufferedCount: 2, streamCompleted: false },
        })
      })

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'chunk', content: 'first', data: {}, sequence: 99 })
      })

      expect(mockMarkFirstResponse).toHaveBeenCalledTimes(1)
      mockMarkFirstResponse.mockClear()

      // Duplicate sequence is dropped before the STREAM_UPDATE_EVENTS block, so
      // markFirstResponse must not fire again for it.
      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'chunk', content: 'first', data: {}, sequence: 99 })
      })

      expect(mockMarkFirstResponse).not.toHaveBeenCalled()
    })

    it('clears the pending send on a complete event', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'complete', data: {} })
      })

      expect(mockClearSend).toHaveBeenCalled()
    })

    it('clears the pending send on a terminal error event', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onEvent({ type: 'error', content: 'boom', data: {} })
      })

      expect(mockClearSend).toHaveBeenCalled()
    })

    it('clears the pending send when stop is called', async () => {
      const hook = await setupHook()

      act(() => {
        hook.result.current.actions.stop()
      })

      expect(mockClearSend).toHaveBeenCalled()
    })

    it('clears the pending send on a terminal transport error', async () => {
      await setupHook()

      act(() => {
        lastTransport.callbacks?.onError(new Error('sse_transport_cooldown'))
      })

      expect(mockClearSend).toHaveBeenCalled()
    })

    it('destroys the monitor on unmount', async () => {
      const hook = await setupHook()

      hook.unmount()

      expect(mockMonitorDestroy).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Connect failure classification (AIROBUILD-2628)
  // ---------------------------------------------------------------------------

  describe('connect failure classification', () => {
    it('deterministic: gates sendMessage and marks terminal error after 404 token failure', async () => {
      const { getAgentToken } = await import('@/lib/agent-fetch')
      vi.mocked(getAgentToken).mockRejectedValueOnce(new Error('Failed to get agent token: 404'))

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => {
        await flushPromises()
      })

      expect(hook.result.current.connection.status).toBe('error')

      // Attempt a send — should NOT reach transport.sendMessage
      await act(async () => {
        await hook.result.current.actions.send({ content: 'hi' })
      })

      expect(lastTransport.sendMessage).not.toHaveBeenCalled()
      expect(mockMarkUpstreamError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'APP_NOT_FOUND' })
      )

      hook.unmount()
    })

    it('provisioning: schedules retry on "agent is not ready yet" without surfacing error', async () => {
      vi.useFakeTimers()
      const { getAgentToken } = await import('@/lib/agent-fetch')
      // Fail twice with provisioning error, then succeed
      vi.mocked(getAgentToken)
        .mockRejectedValueOnce(new Error('agent is not ready yet'))
        .mockRejectedValueOnce(new Error('agent is not ready yet'))
        .mockResolvedValue('test-token')

      const { dynamicApiConfigService } = await import('@/config/dynamic-api')
      vi.mocked(dynamicApiConfigService.getConfigForSite)
        .mockResolvedValue({ baseUrl: 'https://agent.example.com' })

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => {
        await Promise.resolve()
      })

      // Status should NOT be error — provisioning retry keeps it connecting
      expect(hook.result.current.connection.status).not.toBe('error')

      // Advance past the first retry delay (2s)
      await act(async () => {
        vi.advanceTimersByTime(2100)
        await Promise.resolve()
      })

      // getAgentToken should have been called again (retry fired)
      expect(vi.mocked(getAgentToken).mock.calls.length).toBeGreaterThanOrEqual(2)

      hook.unmount()
      vi.useRealTimers()
    })

    it('network: sets connection error and send is NOT gated', async () => {
      const { getAgentToken } = await import('@/lib/agent-fetch')
      vi.mocked(getAgentToken).mockRejectedValueOnce(new Error('Failed to fetch'))

      const { useSSEChat } = await import('@/hooks/useSSEChat')
      const hook = renderHook(() => useSSEChat())

      await act(async () => {
        await flushPromises()
      })

      expect(hook.result.current.connection.error).toBeTruthy()
      // Network branch sets connectionError but NOT the terminal 'error' state
      // (that is the deterministic branch) — so the send gate stays disarmed.
      expect(hook.result.current.connection.status).not.toBe('error')

      await act(async () => {
        await hook.result.current.actions.send({ content: 'hello network' })
      })

      // The deterministic gate did NOT engage for a network failure.
      const appNotFoundCalls = mockMarkUpstreamError.mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.type === 'APP_NOT_FOUND'
      )
      expect(appNotFoundCalls).toHaveLength(0)

      hook.unmount()
    })
  })
})

describe('lastAssistantMessageIsComplete', () => {
  it('returns false for empty array', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([])).toBe(false)
  })

  it('returns false when there is no assistant message', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([
      { role: 'user' },
      { role: 'system' },
    ])).toBe(false)
  })

  it('returns true when last assistant message has no isComplete field (persisted)', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([
      { role: 'user' },
      { role: 'assistant' },
    ])).toBe(true)
  })

  it('returns false when last assistant message is isComplete: false (streaming)', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([
      { role: 'assistant', isComplete: false },
    ])).toBe(false)
  })

  it('returns true when last assistant message is isComplete: true', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([
      { role: 'assistant', isComplete: true },
    ])).toBe(true)
  })

  it('ignores trailing non-assistant messages and inspects the last assistant', async () => {
    const { lastAssistantMessageIsComplete } = await import('../useSSEChat')
    expect(lastAssistantMessageIsComplete([
      { role: 'assistant', isComplete: false },
      { role: 'user' },
    ])).toBe(false)
  })

})
