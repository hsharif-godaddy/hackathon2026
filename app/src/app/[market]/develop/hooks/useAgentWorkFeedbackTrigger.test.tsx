/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
  getSwitchboardFlag: vi.fn(() => true),
}));

import { useAgentWorkFeedbackTrigger } from '@/app/[market]/develop/hooks/useAgentWorkFeedbackTrigger';
import type { FeedbackRevealState } from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { agentWorkFeedbackStorageKey } from '@/lib/agent-work-feedback-storage';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import {
  type ChatMessage,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore';
import { renderHookWithProviders } from '@/tests/test-utils';

const APP_ID = 'app-test-1';
const AGENT_KEY = 'InitialAgent';
const TRACE_IDS = { traceId: 'trace-1', observationId: 'obs-1', agentName: AGENT_KEY };

const ASSISTANT_MESSAGE: ChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  content: 'Done',
  timestamp: new Date(),
  metadata: {
    traceId: TRACE_IDS.traceId,
    observationId: TRACE_IDS.observationId,
    agentId: AGENT_KEY,
  },
};

const REVEAL_NONE: FeedbackRevealState = {
  firstFileEdit: false,
  logoCreation: false,
  imageSelection: false,
  isRevealReady: false,
};

const REVEAL_READY: FeedbackRevealState = {
  firstFileEdit: true,
  logoCreation: false,
  imageSelection: false,
  isRevealReady: true,
};

function resetState() {
  useDevelopPageStore.getState().setShowAgentWorkFeedbackBanner(false, null);
  useDevelopPageStore.setState({
    agentWorkFeedbackSubmitted: false,
    lastCompleteTraceIds: null,
    currentAppId: null,
    showAppGenerationFeedbackBanner: false,
  });
  useStreamingConversationStore.setState({
    streamingState: 'idle',
    messages: [],
    currentAgentName: null,
  });
  window.localStorage.clear();
}

function setStateFor({
  streamingState,
  appId,
  messages,
  lastCompleteTraceIds,
}: {
  streamingState?: 'idle' | 'streaming';
  appId?: string | null;
  messages?: ChatMessage[];
  lastCompleteTraceIds?: typeof TRACE_IDS | null;
}) {
  if (streamingState !== undefined) {
    useStreamingConversationStore.setState({ streamingState });
  }
  if (appId !== undefined) {
    useDevelopPageStore.setState({ currentAppId: appId });
  }
  if (messages !== undefined) {
    useStreamingConversationStore.setState({ messages });
  }
  if (lastCompleteTraceIds !== undefined) {
    useDevelopPageStore.getState().setLastCompleteTraceIds(lastCompleteTraceIds);
  }
}

describe('useAgentWorkFeedbackTrigger', function hookTests() {
  beforeEach(function setup() {
    resetState();
    vi.mocked(useSwitchboard).mockReturnValue(true);
  });

  it('does not show the banner before reveal is ready', function notReady() {
    setStateFor({
      streamingState: 'idle',
      appId: APP_ID,
      messages: [ASSISTANT_MESSAGE],
      lastCompleteTraceIds: TRACE_IDS,
    });
    renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_NONE));

    expect(useDevelopPageStore.getState().showAgentWorkFeedbackBanner).toBe(false);
  });

  it('does not show the banner when the Switchboard flag is off', function flagOff() {
    vi.mocked(useSwitchboard).mockReturnValue(false);
    setStateFor({
      streamingState: 'idle',
      appId: APP_ID,
      messages: [ASSISTANT_MESSAGE],
      lastCompleteTraceIds: TRACE_IDS,
    });
    renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_READY));

    expect(useDevelopPageStore.getState().showAgentWorkFeedbackBanner).toBe(false);
  });

  it('shows the banner and records firstFileEdit milestone dedupe when preconditions are met', function show() {
    setStateFor({
      streamingState: 'idle',
      appId: APP_ID,
      messages: [ASSISTANT_MESSAGE],
      lastCompleteTraceIds: TRACE_IDS,
    });
    renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_READY));

    const state = useDevelopPageStore.getState();
    expect(state.showAgentWorkFeedbackBanner).toBe(true);
    expect(state.agentWorkFeedbackAgentId).toBe('airo-app-builder-InitialAgent');
    expect(state.agentWorkFeedbackRevealMilestone).toBe('firstFileEdit');
    expect(
      window.localStorage.getItem(
        `appbuilder-agent-work-feedback-shown:${agentWorkFeedbackStorageKey(
          AGENT_KEY,
          APP_ID,
          'firstFileEdit'
        )}`
      )
    ).toBe('true');
  });

  it('does not show while app-generation feedback banner is active', function appGenActive() {
    setStateFor({
      streamingState: 'idle',
      appId: APP_ID,
      messages: [ASSISTANT_MESSAGE],
      lastCompleteTraceIds: TRACE_IDS,
    });
    useDevelopPageStore.setState({ showAppGenerationFeedbackBanner: true });
    renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_READY));

    expect(useDevelopPageStore.getState().showAgentWorkFeedbackBanner).toBe(false);
  });
});
