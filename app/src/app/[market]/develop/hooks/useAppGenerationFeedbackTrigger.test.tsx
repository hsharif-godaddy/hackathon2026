/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Flag defaults to on so existing behavioral tests don't have to mock it.
// Individual tests override with mockReturnValueOnce for flag-off coverage.
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
  getSwitchboardFlag: vi.fn(function () { return true; }),
}))

import { useAppGenerationFeedbackTrigger } from '@/app/[market]/develop/hooks/useAppGenerationFeedbackTrigger'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { renderHookWithProviders } from '@/tests/test-utils'

const APP_ID = 'app-test-1'
const TRACE_IDS = { traceId: 'trace-1', observationId: 'obs-1' }

function resetState() {
  const store = useDevelopPageStore.getState()
  store.setShowAppGenerationFeedbackBanner(false, null)
  // Clear submitted flag via direct set since there's no public setter
  useDevelopPageStore.setState({
    appGenerationFeedbackSubmitted: false,
    lastCompleteTraceIds: null,
    currentAppId: null,
  })
  useStreamingConversationStore.setState({ streamingState: 'idle' })
  window.localStorage.clear()
}

function setStateFor({
  streamingState,
  appId,
  lastCompleteTraceIds,
}: {
  streamingState?: 'idle' | 'streaming' | 'completing' | 'error'
  appId?: string | null
  lastCompleteTraceIds?: typeof TRACE_IDS | null
}) {
  if (streamingState !== undefined) {
    useStreamingConversationStore.setState({ streamingState })
  }
  if (appId !== undefined) {
    useDevelopPageStore.setState({ currentAppId: appId })
  }
  if (lastCompleteTraceIds !== undefined) {
    useDevelopPageStore.getState().setLastCompleteTraceIds(lastCompleteTraceIds)
  }
}

describe('useAppGenerationFeedbackTrigger', () => {
  beforeEach(() => {
    resetState()
    vi.mocked(useSwitchboard).mockReturnValue(true)
  })

  it('does not show the banner or write localStorage when the Switchboard flag is off', () => {
    // Gating here (not at render) so that an app generated while the flag is
    // off is NOT marked as feedback-shown in localStorage — it stays eligible
    // for the banner once the flag flips on.
    vi.mocked(useSwitchboard).mockReturnValue(false)
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))

    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
    expect(window.localStorage.getItem(`airo-app-generation-feedback-shown:${APP_ID}`)).toBeNull()
  })

  it('does not show the banner before hasSeenFirstFileEdit is true', () => {
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(false))
    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
  })

  it('does not show the banner while streaming', () => {
    setStateFor({ streamingState: 'streaming', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))
    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
  })

  it('shows the banner without trace IDs (feedback event will emit without Langfuse stitching)', () => {
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: null })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))

    const state = useDevelopPageStore.getState()
    expect(state.showAppGenerationFeedbackBanner).toBe(true)
    expect(state.appGenerationFeedbackTraceIds).toBeNull()
  })

  it('does not show the banner without appId', () => {
    setStateFor({ streamingState: 'idle', appId: null, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))
    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
  })

  it('shows the banner and pins the trace IDs when all preconditions are met', () => {
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))

    const state = useDevelopPageStore.getState()
    expect(state.showAppGenerationFeedbackBanner).toBe(true)
    expect(state.appGenerationFeedbackTraceIds).toEqual(TRACE_IDS)
    expect(window.localStorage.getItem(`airo-app-generation-feedback-shown:${APP_ID}`)).toBe('true')
  })

  it('respects the per-app localStorage guard', () => {
    window.localStorage.setItem(`airo-app-generation-feedback-shown:${APP_ID}`, 'true')
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))
    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
  })

  it('does not re-show the banner after submit', () => {
    setStateFor({ streamingState: 'idle', appId: APP_ID, lastCompleteTraceIds: TRACE_IDS })
    useDevelopPageStore.setState({ appGenerationFeedbackSubmitted: true })
    renderHookWithProviders(() => useAppGenerationFeedbackTrigger(true))
    expect(useDevelopPageStore.getState().showAppGenerationFeedbackBanner).toBe(false)
  })
})
