/**
 * @vitest-environment jsdom
 *
 * Focused tests for the PREVIEW_UNSUPPORTED_FEATURE handler added to
 * useDevToolsBusBindings.  Only the parts of the hook relevant to the
 * new behaviour are exercised; all unrelated deps are stubs.
 */

import { type MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── mock everything the hook imports that we don't want running ───────────

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/agent-fetch', () => ({ agentFetch: vi.fn() }));

vi.mock('@/config/dynamic-api', () => ({ buildDynamicApiUrl: vi.fn() }));

vi.mock('@/utils/postMessage', () => ({ postMessageToIframe: vi.fn() }));

vi.mock('@/app/[market]/develop/components/utils', () => ({
  extractNewPageRoute: vi.fn(),
  handlePreviewRefresh: vi.fn(),
  navigatePreviewToRoute: vi.fn(),
  requestPreviewScreenshot: vi.fn(),
}));

vi.mock('@/app/[market]/develop/utils/iframeProcessingState', () => ({
  handle: vi.fn(),
}));

const { mockAddFeatureWarning, mockClearFeatureWarnings } = vi.hoisted(() => ({
  mockAddFeatureWarning: vi.fn(),
  mockClearFeatureWarnings: vi.fn(),
}));
vi.mock('@/stores/useDevelopPageStore', () => {
  const store = vi.fn();
  (store as unknown as { getState: () => unknown }).getState = () => ({
    addPreviewUnsupportedFeatureWarning: mockAddFeatureWarning,
    clearPreviewUnsupportedFeatureWarnings: mockClearFeatureWarnings,
  });
  return { useDevelopPageStore: store };
});

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: vi.fn(),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: {
    getState: vi.fn(() => ({ messages: [] })),
  },
}));

vi.mock('@/utils/media-slot-fork', () => ({
  loadMediaSlotForkContext: vi.fn(),
  loadMediaSlotOccurrenceIndex: vi.fn(),
  parseCollectionOccurrenceIndex: vi.fn(),
  saveMediaSlotForkContext: vi.fn(),
  saveMediaSlotOccurrenceIndex: vi.fn(),
}));

// ── import after mocks are hoisted ────────────────────────────────────────

import { _resetForTests, dispatch } from '@/utils/eventBus';
import { type DevToolsBusBindingsDeps, useDevToolsBusBindings } from './useDevToolsBusBindings';

// ── helpers ───────────────────────────────────────────────────────────────

function makeRef<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function makeNoopSpeechBridge(): DevToolsBusBindingsDeps['speechBridge'] {
  return {
    broadcastSupport: vi.fn(),
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    handleIframeReady: vi.fn(),
  };
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
    scheduleMicrotask: vi.fn(),
    handleScreenshotUpload: vi.fn(),
    handleEvalViewportScreenshot: vi.fn(),
    handleAutoImportMediaSlot: vi.fn(),
    speechBridge: makeNoopSpeechBridge(),
    wsSend: vi.fn(),
    showUnsupportedFeatureWarning: false,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('useDevToolsBusBindings — PREVIEW_UNSUPPORTED_FEATURE handler', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetForTests();
  });

  it('registers PREVIEW_UNSUPPORTED_FEATURE on mount', () => {
    renderHook(() => useDevToolsBusBindings(makeDeps()));
    // If the handler was registered, dispatching returns true
    expect(dispatch({ type: 'PREVIEW_UNSUPPORTED_FEATURE', feature: 'payment' })).toBe(true);
  });

  it('does NOT call store action when showUnsupportedFeatureWarning is false', () => {
    renderHook(() => useDevToolsBusBindings(makeDeps({ showUnsupportedFeatureWarning: false })));
    dispatch({ type: 'PREVIEW_UNSUPPORTED_FEATURE', feature: 'payment' });
    expect(mockAddFeatureWarning).not.toHaveBeenCalled();
  });

  it.each([
    ['payment'],
    ['push-notification'],
    ['oauth-popup'],
  ] as const)('calls store action with correct feature "%s"', (feature) => {
    renderHook(() => useDevToolsBusBindings(makeDeps({ showUnsupportedFeatureWarning: true, appId: 'test-app' })));
    dispatch({ type: 'PREVIEW_UNSUPPORTED_FEATURE', feature });
    expect(mockAddFeatureWarning).toHaveBeenCalledWith('test-app', feature);
  });

  it('accumulates repeated calls (store action called each time)', () => {
    renderHook(() => useDevToolsBusBindings(makeDeps({ showUnsupportedFeatureWarning: true })));
    dispatch({ type: 'PREVIEW_UNSUPPORTED_FEATURE', feature: 'payment' });
    dispatch({ type: 'PREVIEW_UNSUPPORTED_FEATURE', feature: 'payment' });
    expect(mockAddFeatureWarning).toHaveBeenCalledTimes(2);
  });

  it('clears warnings on URL_CHANGE navigation', () => {
    renderHook(() => useDevToolsBusBindings(makeDeps({ appId: 'test-app' })));
    dispatch({ type: 'URL_CHANGE', url: '/new-page' });
    expect(mockClearFeatureWarnings).toHaveBeenCalledWith('test-app');
  });
});
