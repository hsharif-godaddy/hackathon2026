'use client';

import { useEffect, useRef } from 'react';

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
import { logger } from '@/lib/request-context';
import {
  hasCooldown,
  hasShownInSession,
  markCooldown,
  markShownInSession,
} from '@/lib/task-completion-feedback-storage';
import { traceIdsFromMessage } from '@/lib/trace-ids-from-message';
import { type TraceIds, useDevelopPageStore } from '@/stores/useDevelopPageStore';
import {
  type ChatMessage,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore';

const BANNER_DELAY_MS = 10_000;
const DEBUG_STORAGE_KEY = 'appbuilder-debug-jtbd-feedback';

function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function debug(event: string, data?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  logger.info(`jtbd.feedback.trigger.${event}`, data);
}

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
 * Decides when to show the agent-work feedback banner ("How did the agent work?")
 *
 * Triggered from JTBD task-completion reveal milestones (`reveal`) and only when
 * base runtime gates pass (flag on, idle stream, app/agent context present, and
 * no competing feedback banners).
 *
 * Additional suppression/spacing guards:
 * - per-milestone persistence dedupe (has this milestone ever shown for this app/agent)
 * - 14-day cooldown per app + milestone
 * - once-per-session suppression per app + milestone
 * - delayed display timer (`BANNER_DELAY_MS`) to avoid interrupting completion flow
 *
 * Invocation submit shape is unchanged — this hook controls display gating only.
 */
export function useAgentWorkFeedbackTrigger(reveal: FeedbackRevealState): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagEnabled = useSwitchboard('appbuilder-agent-work-feedback-banner') ?? false;
  const streamingState = useStreamingConversationStore((state) => state.streamingState);
  const lastAssistantSignature = useStreamingConversationStore((state) => {
    const lastAssistant = lastAssistantMessage(state.messages);
    const traceContext = lastAssistant ? traceIdsFromMessage(lastAssistant) : null;
    return `${traceContext?.traceId ?? ''}|${traceContext?.observationId ?? ''}|${traceContext?.agentName ?? ''}`;
  });
  const [lastAssistantTraceId, lastAssistantObservationId, lastAssistantAgentName] =
    lastAssistantSignature.split('|');
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
    if (timerRef.current) {
      debug('timer.cleared.effect-restart');
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!flagEnabled) {
      debug('gate.blocked', { reason: 'flag-disabled' });
      return;
    }
    if (!reveal.isRevealReady) {
      debug('gate.blocked', { reason: 'reveal-not-ready', reveal });
      return;
    }
    if (streamingState !== 'idle') {
      debug('gate.blocked', { reason: 'streaming-not-idle', streamingState });
      return;
    }
    if (!appId) {
      debug('gate.blocked', { reason: 'missing-app-id' });
      return;
    }

    const fromLastMessage =
      lastAssistantTraceId ||
      lastAssistantObservationId ||
      lastAssistantAgentName
        ? {
            ...(lastAssistantTraceId && { traceId: lastAssistantTraceId }),
            ...(lastAssistantObservationId && { observationId: lastAssistantObservationId }),
            ...(lastAssistantAgentName && { agentName: lastAssistantAgentName }),
          }
        : null;
    const agentKey =
      fromLastMessage?.agentName ?? lastCompleteTraceIds?.agentName ?? currentAgentName;
    if (!agentKey) {
      debug('gate.blocked', { reason: 'missing-agent-key' });
      return;
    }

    if (showAppGenerationFeedbackBanner) {
      debug('gate.blocked', { reason: 'app-generation-banner-active' });
      return;
    }
    if (showAgentWorkFeedbackBanner || agentWorkFeedbackSubmitted) {
      debug('gate.blocked', {
        reason: 'agent-banner-active-or-submitted',
        showAgentWorkFeedbackBanner,
        agentWorkFeedbackSubmitted,
      });
      return;
    }

    const pendingMilestone = resolvePendingFeedbackRevealMilestone(
      reveal,
      shownAgentWorkMilestones(agentKey, appId)
    );
    if (!pendingMilestone) {
      debug('gate.blocked', { reason: 'no-pending-milestone', reveal, agentKey, appId });
      return;
    }
    if (hasCooldown(appId, pendingMilestone)) {
      debug('gate.blocked', { reason: 'cooldown-active', appId, pendingMilestone });
      return;
    }
    if (hasShownInSession(appId, pendingMilestone)) {
      debug('gate.blocked', { reason: 'already-shown-this-session', appId, pendingMilestone });
      return;
    }

    const traceIds = traceSnapshotForBanner(fromLastMessage) ?? lastCompleteTraceIds;
    const dedupeKey = agentWorkFeedbackStorageKey(agentKey, appId, pendingMilestone);

    // Delay banner to avoid interrupting immediate post-completion interactions.
    debug('timer.scheduled', { appId, pendingMilestone, delayMs: BANNER_DELAY_MS, agentKey });
    timerRef.current = setTimeout(() => {
      const state = useDevelopPageStore.getState();
      if (state.showAppGenerationFeedbackBanner) {
        debug('timer.blocked', { reason: 'app-generation-banner-active', appId, pendingMilestone });
        return;
      }
      if (state.showAgentWorkFeedbackBanner || state.agentWorkFeedbackSubmitted) {
        debug('timer.blocked', {
          reason: 'agent-banner-active-or-submitted',
          appId,
          pendingMilestone,
          showAgentWorkFeedbackBanner: state.showAgentWorkFeedbackBanner,
          agentWorkFeedbackSubmitted: state.agentWorkFeedbackSubmitted,
        });
        return;
      }
      debug('timer.fired.show-banner', { appId, pendingMilestone, agentKey });
      setShowAgentWorkFeedbackBanner(true, formatAgentId(agentKey), traceIds, pendingMilestone);
      markAgentWorkFeedbackShown(dedupeKey);
      markCooldown(appId, pendingMilestone);
      markShownInSession(appId, pendingMilestone);
      debug('state.marked', { appId, pendingMilestone, dedupeKey });
    }, BANNER_DELAY_MS);
    return () => {
      if (timerRef.current) {
        debug('timer.cleared.cleanup', { appId, pendingMilestone });
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    flagEnabled,
    reveal,
    streamingState,
    appId,
    lastAssistantTraceId,
    lastAssistantObservationId,
    lastAssistantAgentName,
    currentAgentName,
    lastCompleteTraceIds,
    showAppGenerationFeedbackBanner,
    showAgentWorkFeedbackBanner,
    agentWorkFeedbackSubmitted,
    setShowAgentWorkFeedbackBanner,
  ]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        debug('timer.cleared.unmount');
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
