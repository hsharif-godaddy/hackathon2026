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
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(vi.fn(), {
    getState: () => ({
      addPreviewUnsupportedFeatureWarning: vi.fn(),
      clearPreviewUnsupportedFeatureWarnings: vi.fn(),
      setPendingMediaDelete: vi.fn(),
    }),
  }),
}))
vi.mock('@/stores/useMediaSlotDialogStore', () => ({ useMediaSlotDialogStore: vi.fn() }))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(() => ({ messages: [], aiEditContext: null, aiEditContexts: [] })),
  },
}))
vi.mock('@/utils/media-slot-fork', () => ({
  loadMediaSlotForkContext: vi.fn(),
  loadMediaSlotOccurrenceIndex: vi.fn(),
  parseCollectionOccurrenceIndex: vi.fn(),
  saveMediaSlotForkContext: vi.fn(),
  saveMediaSlotOccurrenceIndex: vi.fn(),
}))

import { _resetForTests, dispatch } from '@/utils/eventBus'
import { type DevToolsBusBindingsDeps, useDevToolsBusBindings } from './useDevToolsBusBindings'

function makeRef<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeDeps(overrides: Partial<DevToolsBusBindingsDeps> = {}): DevToolsBusBindingsDeps {
  return {
    appId: 'test-app',
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
    wsSend: vi.fn().mockResolvedValue(undefined),
    showUnsupportedFeatureWarning: false,
    ...overrides,
  }
}

describe('useDevToolsBusBindings — auto-send handlers', function autoSendTests() {
  beforeEach(() => {
    _resetForTests()
    vi.clearAllMocks()
  })

  afterEach(() => {
    _resetForTests()
  })

  it('build-page-request sends without pre-filling the composer and clears it after send', async function buildPageRequest() {
    const setInputValue = vi.fn()
    const wsSend = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useDevToolsBusBindings(makeDeps({ setInputValue, wsSend })))

    dispatch({ type: 'build-page-request', pathToBuild: '/submit' })

    await vi.waitFor(() => expect(wsSend).toHaveBeenCalledTimes(1))
    expect(setInputValue).not.toHaveBeenCalledWith(
      expect.stringContaining("doesn't exist yet"),
    )
    expect(setInputValue).toHaveBeenCalledExactlyOnceWith('')
    expect(wsSend).toHaveBeenCalledWith({
      content: "The page at path /submit doesn't exist yet, please build it with appropriate content.",
      aiEditContext: null,
    })
  })
})
