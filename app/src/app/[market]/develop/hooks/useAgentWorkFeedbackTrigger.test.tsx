/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
  getSwitchboardFlag: vi.fn(function () { return true; }),
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
  logoDownload: false,
  logoDownstreamApply: false,
  websitePublish: false,
  websiteDomainConnect: false,
  domainPurchase: false,
  domainDownstreamConnect: false,
  imageSelection: false,
  firstFileEdit: false,
  isRevealReady: false,
};

const REVEAL_READY: FeedbackRevealState = {
  logoDownload: true,
  logoDownstreamApply: false,
  websitePublish: false,
  websiteDomainConnect: false,
  domainPurchase: false,
  domainDownstreamConnect: false,
  imageSelection: false,
  firstFileEdit: false,
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
  window.sessionStorage.clear();
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

  it('shows the banner and records logoDownload milestone dedupe when preconditions are met', async function show() {
    vi.useFakeTimers();
    try {
      setStateFor({
        streamingState: 'idle',
        appId: APP_ID,
        messages: [ASSISTANT_MESSAGE],
        lastCompleteTraceIds: TRACE_IDS,
      });
      renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_READY));
      vi.advanceTimersByTime(10_000);

      const state = useDevelopPageStore.getState();
      expect(state.showAgentWorkFeedbackBanner).toBe(true);
      expect(state.agentWorkFeedbackAgentId).toBe('airo-app-builder-InitialAgent');
      expect(state.agentWorkFeedbackRevealMilestone).toBe('logoDownload');
      expect(
        window.localStorage.getItem(
          `appbuilder-agent-work-feedback-shown:${agentWorkFeedbackStorageKey(
            AGENT_KEY,
            APP_ID,
            'logoDownload'
          )}`
        )
      ).toBe('true');
    } finally {
      vi.useRealTimers();
    }
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

  it('does not reset the reveal timer for unrelated message array updates', function noTimerStarvation() {
    vi.useFakeTimers();
    try {
      setStateFor({
        streamingState: 'idle',
        appId: APP_ID,
        messages: [ASSISTANT_MESSAGE],
        lastCompleteTraceIds: TRACE_IDS,
      });
      renderHookWithProviders(() => useAgentWorkFeedbackTrigger(REVEAL_READY));
      vi.advanceTimersByTime(9_000);

      setStateFor({
        messages: [
          ASSISTANT_MESSAGE,
          {
            id: 'msg-2',
            role: 'user',
            content: 'follow up',
            timestamp: new Date(),
          } as ChatMessage,
        ],
      });
      vi.advanceTimersByTime(1_000);

      expect(useDevelopPageStore.getState().showAgentWorkFeedbackBanner).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
