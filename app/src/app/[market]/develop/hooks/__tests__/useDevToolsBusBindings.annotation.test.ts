/**
 * @vitest-environment jsdom
 */

import { type MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/agent-fetch', () => ({ agentFetch: vi.fn() }))
vi.mock('@/config/dynamic-api', () => ({ buildDynamicApiUrl: vi.fn() }))
vi.mock('@/utils/postMessage', () => ({ postMessageToIframe: vi.fn() }))
vi.mock('@/app/[market]/develop/components/utils', () => ({
  extractNewPageRoute: vi.fn(),
  handlePreviewRefresh: vi.fn(),
  navigatePreviewToRoute: vi.fn(),
  requestPreviewScreenshot: vi.fn(),
}))
vi.mock('@/app/[market]/develop/utils/iframeProcessingState', () => ({ handle: vi.fn() }))
vi.mock('@/utils/media-slot-fork', () => ({
  loadMediaSlotForkContext: vi.fn(),
  loadMediaSlotOccurrenceIndex: vi.fn(),
  parseCollectionOccurrenceIndex: vi.fn(),
  saveMediaSlotForkContext: vi.fn(),
  saveMediaSlotOccurrenceIndex: vi.fn(),
}))

const { mockSetActiveChatTab } = vi.hoisted(() => ({
  mockSetActiveChatTab: vi.fn(),
}))

vi.mock('@/stores/useDevelopPageStore', () => {
  const store = vi.fn()
  ;(store as unknown as { getState: () => unknown }).getState = () => ({
    setActiveChatTab: mockSetActiveChatTab,
    isMultiSelectEnabled: false,
    addPreviewUnsupportedFeatureWarning: vi.fn(),
    clearPreviewUnsupportedFeatureWarnings: vi.fn(),
    setPendingMediaDelete: vi.fn(),
  })
  return { useDevelopPageStore: store }
})

vi.mock('@/stores/useMediaSlotDialogStore', () => ({ useMediaSlotDialogStore: vi.fn() }))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(() => ({ messages: [], aiEditContext: null, aiEditContexts: [], removeAiEditContext: vi.fn() })),
  },
}))

import { ChatTab } from '@/app/[market]/develop/components/types'
import { type DevToolsBusBindingsDeps, useDevToolsBusBindings } from '@/app/[market]/develop/hooks/useDevToolsBusBindings'
import { _resetForTests, dispatch } from '@/utils/eventBus'

function makeRef<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeDeps(overrides: Partial<DevToolsBusBindingsDeps> = {}): DevToolsBusBindingsDeps {
  return {
    appId: 'test-app',
    cmsInlineEditEnabled: false,
    isProcessingRef: makeRef(false),
    pendingPublishSnapshotRef: makeRef(false),
    lastIframeState: makeRef({}),
    sendTextUpdate: vi.fn(),
    sendTextFix: vi.fn(),
    sendStyleUpdate: vi.fn(),
    sendFormatOverrideUpdate: vi.fn(),
    sendUserRequestedFix: vi.fn(),
    sendEditModeMessage: vi.fn(),
    isEditModeEnabled: false,
    setAiEditContext: vi.fn(),
    addAiEditContext: vi.fn(),
    setIsAssetManagerOpen: vi.fn(),
    setInputValue: vi.fn(),
    scheduleMicrotask: (fn) => { void fn() },
    handleScreenshotUpload: vi.fn(),
    handleEvalViewportScreenshot: vi.fn(),
    handleAutoImportMediaSlot: vi.fn(),
    speechBridge: {
      broadcastSupport: vi.fn(),
      handleStart: vi.fn(),
      handleStop: vi.fn(),
      handleIframeReady: vi.fn(),
    },
    t: (key: string) => key,
    wsSend: vi.fn().mockResolvedValue(undefined),
    showUnsupportedFeatureWarning: false,
    ...overrides,
  }
}

describe('useDevToolsBusBindings — ANNOTATION_SELECTION_CREATED handler', function annotationTests() {
  beforeEach(function reset() {
    _resetForTests()
    vi.clearAllMocks()
  })

  afterEach(function cleanup() {
    _resetForTests()
  })

  it('registers ANNOTATION_SELECTION_CREATED on mount', function registersHandler() {
    renderHook(() => useDevToolsBusBindings(makeDeps()))
    expect(
      dispatch({
        type: 'ANNOTATION_SELECTION_CREATED',
        data: { number: 1, rect: { x: 0, y: 0, width: 10, height: 10 }, prompt: 'hi' },
      }),
    ).toBe(true)
  })

  it('maps rect coordinates and adds annotation context', function mapsRect() {
    const addAiEditContext = vi.fn()
    renderHook(() => useDevToolsBusBindings(makeDeps({ addAiEditContext })))

    dispatch({
      type: 'ANNOTATION_SELECTION_CREATED',
      data: {
        number: 1,
        rect: { x: 10, y: 20, width: 100, height: 50 },
        prompt: 'make this bigger',
      },
    })

    expect(addAiEditContext).toHaveBeenCalledWith({
      number: 1,
      isAnnotation: true,
      annotationRect: { x: 10, y: 20, width: 100, height: 50 },
      annotationPrompt: 'make this bigger',
      elementInfo: {
        tagName: 'selection',
        className: '',
        id: '',
        textContent: 'make this bigger',
        selector: '',
        rect: { top: 20, left: 10, width: 100, height: 50 },
        computedStyles: {},
      },
      selector: '',
      devContext: { fileName: '', componentName: '', lineNumber: 0 },
    })
    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.CHAT)
  })

  it('ignores malformed payloads', function malformedPayload() {
    const addAiEditContext = vi.fn()
    renderHook(() => useDevToolsBusBindings(makeDeps({ addAiEditContext })))

    dispatch({ type: 'ANNOTATION_SELECTION_CREATED', data: { number: '1', rect: null, prompt: '' } } as never)
    dispatch({ type: 'ANNOTATION_SELECTION_CREATED', data: undefined } as never)

    expect(addAiEditContext).not.toHaveBeenCalled()
    expect(mockSetActiveChatTab).not.toHaveBeenCalled()
  })
})
