/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockShipAnalyticsLog,
  mockLogImpressionEvent,
  mockLogImpressionEventInner,
  mockSetInstrumentationIntentCategory,
  mockReadIntentCategoryFromSession,
  mockGetSelectedCommitHash,
  mockMarkFileStreaming,
  mockMarkFileComplete,
  mockClearFileChange,
  mockMarkUpstreamError,
  mockLoggerWarn,
  mockLoggerError,
  mockTrackContextGathering,
  mockTrackQuestionReceived,
  mockTrackHandoff,
  mockSetPlan,
  mockEnqueue,
  mockMarkProcessing,
} = vi.hoisted(() => {
  const mockLogImpressionEventInner = vi.fn()
  return {
    mockShipAnalyticsLog: vi.fn(),
    mockLogImpressionEvent: vi.fn(() => mockLogImpressionEventInner),
    mockLogImpressionEventInner,
    mockSetInstrumentationIntentCategory: vi.fn(),
    mockReadIntentCategoryFromSession: vi.fn<[string], string | undefined>(),
    mockGetSelectedCommitHash: vi.fn<[string], string | null>(),
    mockMarkFileStreaming: vi.fn(),
    mockMarkFileComplete: vi.fn(),
    mockClearFileChange: vi.fn(),
    mockMarkUpstreamError: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerError: vi.fn(),
    mockTrackContextGathering: vi.fn(),
    mockTrackQuestionReceived: vi.fn(),
    mockTrackHandoff: vi.fn(),
    mockSetPlan: vi.fn(),
    mockEnqueue: vi.fn(),
    mockMarkProcessing: vi.fn(),
  }
})

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: mockShipAnalyticsLog,
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: mockLogImpressionEvent,
  setInstrumentationIntentCategory: mockSetInstrumentationIntentCategory,
  setInstrumentationBusinessName: vi.fn(),
}))

vi.mock('@/utils/traffic-signals', () => ({
  readIntentCategoryFromSession: mockReadIntentCategoryFromSession,
}))

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      getSelectedCommitHash: mockGetSelectedCommitHash,
    })),
  },
}))

vi.mock('@/stores/useCodeSyncStore', () => ({
  useCodeSyncStore: {
    getState: vi.fn(() => ({
      markFileStreaming: mockMarkFileStreaming,
      markFileComplete: mockMarkFileComplete,
      clearFileChange: mockClearFileChange,
    })),
  },
}))

const mockStreamingState = vi.hoisted(() => ({
  streamingState: 'idle' as string,
  activeStream: null as { isComplete: boolean } | null,
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(() => ({
      markUpstreamError: mockMarkUpstreamError,
      streamingState: mockStreamingState.streamingState,
      activeStream: mockStreamingState.activeStream,
    })),
  },
}))

vi.mock('@/stores/useUpfrontRebuildBuildQueueStore', () => ({
  useUpfrontRebuildBuildQueueStore: {
    getState: vi.fn(() => ({
      setPlan: mockSetPlan,
      enqueue: mockEnqueue,
      markProcessing: mockMarkProcessing,
    })),
  },
}))

vi.mock('@/stores/useTodoListStore', () => ({
  useTodoListStore: {
    getState: vi.fn(() => ({
      updateFromToolCall: vi.fn(),
    })),
  },
}))

vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: vi.fn(() => null),
}))

vi.mock('@/hooks/shared/contextGatheringTracker', () => ({
  trackFromToolResult: mockTrackContextGathering,
}))

vi.mock('@/hooks/shared/initialBuildFunnel', () => ({
  trackQuestionReceived: mockTrackQuestionReceived,
  trackHandoff: mockTrackHandoff,
}))

vi.mock('@/hooks/useBrandData', () => ({
  BRAND_DATA_UPDATED_EVENT: 'brand-data-updated',
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { detectRebuildIntent, handleToolCallSideEffects, handleToolResultSideEffects } from './toolSideEffects'

let dispatchEventSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSelectedCommitHash.mockReturnValue(null)
  mockReadIntentCategoryFromSession.mockReturnValue(undefined)
  mockLogImpressionEvent.mockReturnValue(mockLogImpressionEventInner)
  mockStreamingState.streamingState = 'idle'
  mockStreamingState.activeStream = null
  dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
})

describe('detectRebuildIntent', () => {
  it.each([
    ['rebuild', 'Please rebuild my site'],
    ['redesign', 'Can you redesign the homepage?'],
    ['start over', 'Let\'s start over from scratch'],
    ['redo', 'Redo the entire layout'],
    ['recreate', 'Recreate the landing page'],
  ])('matches %s keyword', (_keyword, message) => {
    expect(detectRebuildIntent(message)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(detectRebuildIntent('REBUILD everything')).toBe(true)
    expect(detectRebuildIntent('Redesign the footer')).toBe(true)
    expect(detectRebuildIntent('START OVER please')).toBe(true)
  })

  it('returns false for ordinary edit messages', () => {
    expect(detectRebuildIntent('Change the background color to blue')).toBe(false)
    expect(detectRebuildIntent('Update the hero text')).toBe(false)
    expect(detectRebuildIntent('')).toBe(false)
  })
})

describe('handleToolCallSideEffects — funnel.rebuild.started', () => {
  it('emits funnel.rebuild.started for websiteRebuild', () => {
    handleToolCallSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'funnel.rebuild.started',
      expect.objectContaining({ appId: 'app-1' }),
    )
  })

  it('includes priorArtifactHash when a prior commit hash exists', () => {
    mockGetSelectedCommitHash.mockReturnValue('abc1234')

    handleToolCallSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'funnel.rebuild.started',
      expect.objectContaining({ appId: 'app-1', priorArtifactHash: 'abc1234' }),
    )
  })

  it('omits priorArtifactHash when no prior commit hash exists', () => {
    mockGetSelectedCommitHash.mockReturnValue(null)

    handleToolCallSideEffects({ name: 'websiteRebuild' }, 'app-1')

    const call = mockShipAnalyticsLog.mock.calls.find(([event]) => event === 'funnel.rebuild.started')
    expect(call).toBeDefined()
    expect(call?.[1]).not.toHaveProperty('priorArtifactHash')
  })

  it('omits priorArtifactHash when appId is null', () => {
    // Cannot call getSelectedCommitHash without an appId
    handleToolCallSideEffects({ name: 'websiteRebuild' }, null)

    const call = mockShipAnalyticsLog.mock.calls.find(([event]) => event === 'funnel.rebuild.started')
    expect(call).toBeDefined()
    expect(call?.[1]).not.toHaveProperty('priorArtifactHash')
    expect(mockGetSelectedCommitHash).not.toHaveBeenCalled()
  })

  it('fires the EID impression alongside the analytics log', () => {
    handleToolCallSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockLogImpressionEvent).toHaveBeenCalledWith(
      'develop.rebuild.started',
      expect.objectContaining({ appId: 'app-1' }),
    )
    expect(mockLogImpressionEventInner).toHaveBeenCalled()
  })

  it('sets intent_category to rebuild when rebuild tool is called', () => {
    handleToolCallSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockSetInstrumentationIntentCategory).toHaveBeenCalledWith('rebuild')
  })

  it('does not emit rebuild.started for non-rebuild tools', () => {
    handleToolCallSideEffects({ name: 'fileEdit' }, 'app-1')

    const rebuildCall = mockShipAnalyticsLog.mock.calls.find(([event]) => event === 'funnel.rebuild.started')
    expect(rebuildCall).toBeUndefined()
  })
})

describe('handleToolResultSideEffects — post-rebuild intent restore', () => {
  it('restores intent_category from session after websiteRebuild completes', async () => {
    mockReadIntentCategoryFromSession.mockReturnValue('edit')

    await handleToolResultSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockSetInstrumentationIntentCategory).toHaveBeenCalledWith('edit')
  })

  it("falls back to 'edit' when session has no stored intent_category", async () => {
    mockReadIntentCategoryFromSession.mockReturnValue(undefined)

    await handleToolResultSideEffects({ name: 'websiteRebuild' }, 'app-1')

    expect(mockSetInstrumentationIntentCategory).toHaveBeenCalledWith('edit')
  })

  it('does not restore intent_category when rebuild tool errored', async () => {
    mockReadIntentCategoryFromSession.mockReturnValue('edit')

    await handleToolResultSideEffects({ name: 'websiteRebuild', is_error: true }, 'app-1')

    expect(mockSetInstrumentationIntentCategory).not.toHaveBeenCalled()
  })

  it('does not restore intent_category for non-rebuild tools', async () => {
    await handleToolResultSideEffects({ name: 'fileEdit' }, 'app-1')

    expect(mockSetInstrumentationIntentCategory).not.toHaveBeenCalled()
  })
})

describe('handleToolResultSideEffects — websiteRebuild upfront queue', () => {
  it('seeds queue via setPlan when upfrontPlanSlugs are present', async () => {
    await handleToolResultSideEffects({
      name: 'websiteRebuild',
      output: JSON.stringify({
        upfrontPlanSlugs: ['homepage', 'about'],
        upfrontBuildSlugs: ['about'],
      }),
    }, 'app-1')

    expect(mockSetPlan).toHaveBeenCalledWith('app-1', ['homepage', 'about'], ['about'])
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('falls back to enqueue when only upfrontBuildSlugs are present', async () => {
    await handleToolResultSideEffects({
      name: 'websiteRebuild',
      output: JSON.stringify({
        upfrontBuildSlugs: ['about', 'contact'],
      }),
    }, 'app-1')

    expect(mockEnqueue).toHaveBeenCalledWith('app-1', ['about', 'contact'])
    expect(mockSetPlan).not.toHaveBeenCalled()
  })

  it('marks processing when rebuild completes during an active stream', async () => {
    mockStreamingState.streamingState = 'streaming'
    mockStreamingState.activeStream = { isComplete: false }

    await handleToolResultSideEffects({
      name: 'websiteRebuild',
      output: JSON.stringify({
        upfrontPlanSlugs: ['homepage', 'about'],
        upfrontBuildSlugs: ['about'],
      }),
    }, 'app-1')

    expect(mockMarkProcessing).toHaveBeenCalledWith('app-1')
  })

  it('does not mark processing when active stream is already complete', async () => {
    mockStreamingState.streamingState = 'streaming'
    mockStreamingState.activeStream = { isComplete: true }

    await handleToolResultSideEffects({
      name: 'websiteRebuild',
      output: JSON.stringify({
        upfrontPlanSlugs: ['homepage', 'about'],
        upfrontBuildSlugs: ['about'],
      }),
    }, 'app-1')

    expect(mockMarkProcessing).not.toHaveBeenCalled()
  })

  it('logs warn when websiteRebuild output cannot be parsed', async () => {
    await handleToolResultSideEffects({
      name: 'websiteRebuild',
      output: '{not-json',
    }, 'app-1')

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'toolSideEffects.websiteRebuild.upfrontQueueFailed',
      expect.objectContaining({ appId: 'app-1' }),
    )
    expect(mockSetPlan).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('handleToolResultSideEffects — logo-generated event', () => {
  it('dispatches logo-generated for new singular structuredContent.logo shape', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__generate_logo',
      output: JSON.stringify({
        structuredContent: {
          logo: {
            id: 'logo-1',
            urls: { square: { transparent: 'https://cdn.example.com/logo.png', solid: 'https://cdn.example.com/logo-solid.png' } },
          },
          sessionId: 'sess-1',
        },
      }),
    }, 'app-1')

    const event = dispatchEventSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'logo-generated',
    )?.[0] as CustomEvent
    expect(event).toBeDefined()
    expect(event.detail).toEqual(expect.objectContaining({
      id: 'logo-1',
      transparentUrl: 'https://cdn.example.com/logo.png',
      solidUrl: 'https://cdn.example.com/logo-solid.png',
    }))
  })

  it('dispatches logo-generated for legacy structuredContent.logos array', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__generate_logo',
      output: JSON.stringify({
        structuredContent: {
          logos: [{ id: 'logo-2', transparentUrl: 'https://cdn.example.com/legacy.png' }],
        },
      }),
    }, 'app-1')

    const event = dispatchEventSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'logo-generated',
    )?.[0] as CustomEvent
    expect(event).toBeDefined()
    expect(event.detail).toEqual(expect.objectContaining({
      id: 'logo-2',
      transparentUrl: 'https://cdn.example.com/legacy.png',
    }))
  })

  it('dispatches logo-generated for edit_logo tool', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__edit_logo',
      output: JSON.stringify({
        structuredContent: {
          logo: {
            id: 'logo-3',
            urls: { horizontal: { transparent: 'https://cdn.example.com/horiz.png' } },
          },
        },
      }),
    }, 'app-1')

    const event = dispatchEventSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'logo-generated',
    )?.[0] as CustomEvent
    expect(event).toBeDefined()
    expect(event.detail.horizontalTransparentUrl).toBe('https://cdn.example.com/horiz.png')
  })

  it('does not dispatch when logo has no valid URL', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__generate_logo',
      output: JSON.stringify({
        structuredContent: {
          logo: { id: 'logo-empty', urls: {} },
        },
      }),
    }, 'app-1')

    const event = dispatchEventSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'logo-generated',
    )
    expect(event).toBeUndefined()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'toolSideEffects.logoTool.noLogosInResult',
      expect.objectContaining({ appId: 'app-1', toolName: 'media-logo__generate_logo' }),
    )
  })

  it('does not dispatch when tool errored', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__generate_logo',
      is_error: true,
      output: JSON.stringify({
        structuredContent: {
          logo: { id: 'logo-err', urls: { square: { transparent: 'https://cdn.example.com/x.png' } } },
        },
      }),
    }, 'app-1')

    const event = dispatchEventSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'logo-generated',
    )
    expect(event).toBeUndefined()
  })

  it('warns when result cannot be parsed', async () => {
    await handleToolResultSideEffects({
      name: 'media-logo__generate_logo',
      output: '{invalid-json',
    }, 'app-1')

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'toolSideEffects.logoTool.resultParseFailed',
      expect.objectContaining({ appId: 'app-1', toolName: 'media-logo__generate_logo' }),
    )
  })
})
