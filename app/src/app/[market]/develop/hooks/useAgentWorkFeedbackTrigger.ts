'use client';

import { useEffect } from 'react';

import type { FeedbackRevealState } from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import {
  agentWorkFeedbackStorageKey,
  hasShownAgentWorkFeedback,
  markAgentWorkFeedbackShown,
} from '@/lib/agent-work-feedback-storage';
import { formatAgentId } from '@/lib/format-agent-id';
import {
  ACTIVE_FEEDBACK_REVEAL_MILESTONES,
  type FeedbackRevealMilestone,
  resolvePendingFeedbackRevealMilestone,
} from '@/lib/initial-build-reveal';
import { traceIdsFromMessage } from '@/lib/trace-ids-from-message';
import { type TraceIds, useDevelopPageStore } from '@/stores/useDevelopPageStore';
import {
  type ChatMessage,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore';

function lastAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return null;
}

function traceSnapshotForBanner(
  fromMessage: ReturnType<typeof traceIdsFromMessage>
): TraceIds | null {
  if (!fromMessage) return null;
  if (fromMessage.traceId && fromMessage.observationId) {
    return {
      traceId: fromMessage.traceId,
      observationId: fromMessage.observationId,
      ...(fromMessage.agentName && { agentName: fromMessage.agentName }),
    };
  }
  return null;
}

function shownAgentWorkMilestones(
  agentKey: string,
  appId: string
): Set<FeedbackRevealMilestone> {
  const shown = new Set<FeedbackRevealMilestone>();
  for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
    if (hasShownAgentWorkFeedback(agentWorkFeedbackStorageKey(agentKey, appId, milestone))) {
      shown.add(milestone);
    }
  }
  return shown;
}

/**
 * Decides when to show the agent-work feedback banner ("How did the agent work?").
 *
 * Gated on `reveal.isRevealReady` (today: first file edit only).
 * Invocation submit shape is unchanged — gating lives here only.
 */
export function useAgentWorkFeedbackTrigger(reveal: FeedbackRevealState): void {
  const flagEnabled = useSwitchboard('appbuilder-agent-work-feedback-banner') ?? false;
  const streamingState = useStreamingConversationStore((state) => state.streamingState);
  const messages = useStreamingConversationStore((state) => state.messages);
  const currentAgentName = useStreamingConversationStore((state) => state.currentAgentName);
  const appId = useDevelopPageStore((state) => state.currentAppId);
  const lastCompleteTraceIds = useDevelopPageStore((state) => state.lastCompleteTraceIds);
  const showAppGenerationFeedbackBanner = useDevelopPageStore(
    (state) => state.showAppGenerationFeedbackBanner
  );
  const showAgentWorkFeedbackBanner = useDevelopPageStore(
    (state) => state.showAgentWorkFeedbackBanner
  );
  const agentWorkFeedbackSubmitted = useDevelopPageStore(
    (state) => state.agentWorkFeedbackSubmitted
  );
  const setShowAgentWorkFeedbackBanner = useDevelopPageStore(
    (state) => state.setShowAgentWorkFeedbackBanner
  );

  useEffect(() => {
    if (!flagEnabled) return;
    if (!reveal.isRevealReady) return;
    if (streamingState !== 'idle') return;
    if (!appId) return;

    const lastAssistant = lastAssistantMessage(messages);
    const fromLastMessage = lastAssistant ? traceIdsFromMessage(lastAssistant) : null;
    const agentKey =
      fromLastMessage?.agentName ?? lastCompleteTraceIds?.agentName ?? currentAgentName;
    if (!agentKey) return;

    if (showAppGenerationFeedbackBanner) return;
    if (showAgentWorkFeedbackBanner || agentWorkFeedbackSubmitted) return;

    const pendingMilestone = resolvePendingFeedbackRevealMilestone(
      reveal,
      shownAgentWorkMilestones(agentKey, appId)
    );
    if (!pendingMilestone) return;

    const traceIds = traceSnapshotForBanner(fromLastMessage) ?? lastCompleteTraceIds;
    const dedupeKey = agentWorkFeedbackStorageKey(agentKey, appId, pendingMilestone);

    setShowAgentWorkFeedbackBanner(true, formatAgentId(agentKey), traceIds, pendingMilestone);
    markAgentWorkFeedbackShown(dedupeKey);
  }, [
    flagEnabled,
    reveal,
    streamingState,
    appId,
    messages,
    currentAgentName,
    lastCompleteTraceIds,
    showAppGenerationFeedbackBanner,
    showAgentWorkFeedbackBanner,
    agentWorkFeedbackSubmitted,
    setShowAgentWorkFeedbackBanner,
  ]);
}
