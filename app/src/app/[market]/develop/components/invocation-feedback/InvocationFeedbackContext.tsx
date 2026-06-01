'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type FeedbackValue,
  type InvocationFeedbackTraceIds,
  submitFeedback,
  type SubmitFeedbackResult,
} from '@/lib/feedback-client';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation';
import { getScrollParent } from './getScrollParent';
import {
  feedbackCategoryForReason,
  type FeedbackReason,
  type InvocationFeedbackVote,
} from './types';

export type InvocationFeedbackFlow = 'per-message' | 'agent-work' | 'artifact';
export type InvocationFeedbackThanksMode = 'global-banner' | 'none';

/**
 *
 * @param flow
 * flow === 'agent-work'      => return 'invocation' (targetLevel = 'invocation')
 * flow === 'per-message'     => return 'conversation' (targetLevel = 'conversation')
 * flow === 'artifact'        => return 'artifact' (targetLevel = 'artifact')
 * @returns 'invocation' | 'conversation' | 'artifact'
 */
function targetLevelFromFlow(
  flow: InvocationFeedbackFlow
): 'invocation' | 'conversation' | 'artifact' {
  switch (flow) {
    case 'agent-work':
      return 'invocation';
    case 'per-message':
      return 'conversation';
    case 'artifact':
      return 'artifact';
    default:
      return 'conversation';
  }
}

export interface InvocationFeedbackProviderProps {
  appId: string | null;
  messageId: string;
  traceIds?: InvocationFeedbackTraceIds | null;
  /** Per-message (ResponseMetadata) vs agent-work chat banner. */
  flow?: InvocationFeedbackFlow;
  /** Canonical agent id (`airo-app-builder-*`) when flow is `agent-work`. */
  agentTargetId?: string;
  thanksMode?: InvocationFeedbackThanksMode;
  onSubmitted?: () => void;
  onSubmitFailed?: (reason: NonNullable<SubmitFeedbackResult['reason']>) => void;
  children: ReactNode;
}

interface InvocationFeedbackContextValue {
  feedback: InvocationFeedbackVote;
  isNegativeFeedbackOpen: boolean;
  negativeFeedbackReason: FeedbackReason | null;
  otherFeedback: string;
  isSubmittingFeedback: boolean;
  feedbackPanelRef: React.RefObject<HTMLDivElement | null>;
  togglePositive: () => void;
  toggleNegative: () => void;
  handleReasonSelect: (reason: FeedbackReason) => void;
  handleOtherFeedbackChange: (value: string) => void;
  handleOtherSubmit: () => void;
  closeNegativePanel: () => void;
}

const InvocationFeedbackContext = createContext<InvocationFeedbackContextValue | null>(null);

export function useInvocationFeedback(): InvocationFeedbackContextValue {
  const value = useContext(InvocationFeedbackContext);
  if (!value) {
    throw new Error('useInvocationFeedback must be used within InvocationFeedbackProvider');
  }
  return value;
}

export function InvocationFeedbackProvider({
  appId,
  messageId,
  traceIds,
  flow = 'per-message',
  agentTargetId,
  thanksMode = 'global-banner',
  onSubmitted,
  onSubmitFailed,
  children,
}: InvocationFeedbackProviderProps) {
  const showResponseFeedbackThanksBannerTemporarily = useDevelopPageStore(
    (state) => state.showResponseFeedbackThanksBannerTemporarily
  );

  const [feedback, setFeedback] = useState<InvocationFeedbackVote>(null);
  const [isNegativeFeedbackOpen, setIsNegativeFeedbackOpen] = useState(false);
  const [negativeFeedbackReason, setNegativeFeedbackReason] = useState<FeedbackReason | null>(null);
  const [otherFeedback, setOtherFeedback] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const feedbackPanelRef = useRef<HTMLDivElement | null>(null);
  const isSubmittingRef = useRef(false);

  const clearNegativeFeedbackDraft = useCallback(function clearNegativeFeedbackDraft() {
    setNegativeFeedbackReason(null);
    setOtherFeedback('');
  }, []);

  const persistFeedback = useCallback(
    async function persistFeedback(
      feedbackValue: FeedbackValue,
      analyticsReason?: FeedbackReason,
      otherFeedbackText?: string
    ): Promise<SubmitFeedbackResult> {
      if (!appId) {
        logger.warn('invocation_feedback.persist.skipped', {
          reason: 'no_app_id',
          messageId,
        });
        onSubmitFailed?.('no_app_id');
        return { ok: false, reason: 'no_app_id' };
      }

      if (isSubmittingRef.current) {
        logger.warn('invocation_feedback.persist.skipped', {
          reason: 'in_flight',
          messageId,
        });
        onSubmitFailed?.('in_flight');
        return { ok: false, reason: 'in_flight' };
      }

      isSubmittingRef.current = true;
      setIsSubmittingFeedback(true);
      /**
       * flow === 'agent-work'      => targetId = agentTargetId, targetLevel = 'invocation'
       * flow === 'per-message'     => targetId = messageId, targetLevel = 'conversation'
       * flow === 'artifact'        => targetId = traceIds.observationId or messageId, targetLevel = 'artifact'
       *
       * targetLevel is the events-schema aggregation bucket; targetId is the rated unit
       * within that bucket. Per-message thumbs rate a specific assistant message
       * (messageId) under the conversation bucket — conversationId is sent separately
       * on the POST body from the cookie, not as targetId.
       */
      const targetId =
        flow === 'agent-work'
          ? (agentTargetId ?? 'airo-app-builder-unknown')
          : flow === 'per-message'
            ? messageId
            : (traceIds?.observationId ?? messageId);
      const trimmedOther = otherFeedbackText?.trim();

      const hasDetailedFeedback =
        analyticsReason !== 'other' || Boolean(trimmedOther);

      const schemaPayload =
        feedbackValue === 'negative' && analyticsReason
          ? {
              feedbackCategory: feedbackCategoryForReason(analyticsReason),
              ...(analyticsReason === 'other' && trimmedOther
                ? { feedbackText: trimmedOther }
                : {}),
              hasDetailedFeedback,
            }
          : { hasDetailedFeedback: false as const };

      logger.info('invocation_feedback.persist.start', {
        appId,
        messageId,
        feedback: feedbackValue,
        targetId,
        flow,
        ...(analyticsReason && { analyticsReason }),
      });

      const eventCreationTimestamp = new Date().toISOString();
      const result = await submitFeedback({
        feedback: feedbackValue,
        targetLevel: targetLevelFromFlow(flow),
        targetId,
        appId,
        ...(traceIds?.traceId !== undefined && { traceId: traceIds.traceId }),
        ...(traceIds?.observationId !== undefined && {
          observationId: traceIds.observationId,
        }),
        ...(traceIds?.agentName !== undefined && { agentName: traceIds.agentName }),
        eventCreationTimestamp,
        ...schemaPayload,
      });

      const { ok, reason } = result;
      const analyticsEvent =
        flow === 'agent-work'
          ? 'agentWork.feedback.submit'
          : 'chat.response_metadata.feedback.submit';
      const revealMilestone =
        flow === 'agent-work'
          ? useDevelopPageStore.getState().agentWorkFeedbackRevealMilestone
          : null;

      shipAnalyticsLog(analyticsEvent, {
        appId,
        messageId,
        feedback: feedbackValue,
        targetId,
        flow,
        ...(traceIds?.traceId && { traceId: traceIds.traceId }),
        ...(traceIds?.observationId && { observationId: traceIds.observationId }),
        ...(revealMilestone && { initialBuildRevealMilestone: revealMilestone }),
        ...(analyticsReason && { reason: analyticsReason }),
        outcome: ok ? 'success' : 'failure',
        ...(reason && { failureReason: reason }),
      });

      if (ok) {
        logger.info('invocation_feedback.persist.success', {
          appId,
          messageId,
          feedback: feedbackValue,
        });
      } else if (reason === 'missing_conversation_id') {
        logger.warn('invocation_feedback.persist.missing_conversation_id', { appId, messageId });
      } else {
        logger.warn('invocation_feedback.persist.failure', {
          appId,
          messageId,
          feedback: feedbackValue,
          ...(reason && { failureReason: reason }),
        });
      }

      isSubmittingRef.current = false;
      setIsSubmittingFeedback(false);

      if (!ok && reason) {
        onSubmitFailed?.(reason);
      }

      return result;
    },
    [agentTargetId, appId, flow, messageId, onSubmitFailed, traceIds]
  );

  const completePositiveFeedback = useCallback(
    async function completePositiveFeedback() {
      const result = await persistFeedback('positive');
      if (!result.ok) {
        setFeedback(null);
        return;
      }
      if (thanksMode === 'global-banner') {
        showResponseFeedbackThanksBannerTemporarily();
      }
      onSubmitted?.();
    },
    [onSubmitted, persistFeedback, showResponseFeedbackThanksBannerTemporarily, thanksMode]
  );

  const completeNegativeFeedback = useCallback(
    async function completeNegativeFeedback(reason: FeedbackReason, otherFeedbackText?: string) {
      const trimmedOther = otherFeedbackText?.trim();

      const result = await persistFeedback(
        'negative',
        reason,
        trimmedOther || undefined
      );
      if (!result.ok) {
        setFeedback(null);
        clearNegativeFeedbackDraft();
        return;
      }
      clearNegativeFeedbackDraft();
      if (thanksMode === 'global-banner') {
        showResponseFeedbackThanksBannerTemporarily();
      }
      onSubmitted?.();
    },
    [
      clearNegativeFeedbackDraft,
      onSubmitted,
      persistFeedback,
      showResponseFeedbackThanksBannerTemporarily,
      thanksMode,
    ]
  );

  useEffect(
    function scrollNegativePanelIntoView() {
      if (!isNegativeFeedbackOpen) return;

      function ensurePanelVisible() {
        try {
          const panel = feedbackPanelRef.current;
          if (!panel) return;

          const scrollParent = getScrollParent(panel);
          if (!scrollParent) {
            panel.scrollIntoView({
              behavior: 'smooth',
              block: 'end',
              inline: 'nearest',
            });
            return;
          }

          const panelRect = panel.getBoundingClientRect();
          const parentRect = scrollParent.getBoundingClientRect();

          if (panelRect.bottom > parentRect.bottom) {
            scrollParent.scrollBy({
              top: panelRect.bottom - parentRect.bottom + 8,
              behavior: 'smooth',
            });
          }

          if (panelRect.top < parentRect.top) {
            scrollParent.scrollBy({
              top: panelRect.top - parentRect.top - 8,
              behavior: 'smooth',
            });
          }
        } catch {
          // JSDOM and some embedded browsers omit full scroll APIs.
        }
      }

      const frame = requestAnimationFrame(ensurePanelVisible);
      const settleTimer = setTimeout(ensurePanelVisible, 250);

      return function cleanupScroll() {
        cancelAnimationFrame(frame);
        clearTimeout(settleTimer);
      };
    },
    [isNegativeFeedbackOpen]
  );

  const togglePositive = useCallback(
    function togglePositive() {
      logClickEvent(
        flow === 'agent-work' ? 'agentWork.feedback.thumbs_up' : 'chat.response_metadata.thumbs_up'
      )();
      setIsNegativeFeedbackOpen(false);
      clearNegativeFeedbackDraft();

      if (feedback === 'positive') {
        setFeedback(null);
        return;
      }

      setFeedback('positive');
      void completePositiveFeedback();
    },
    [clearNegativeFeedbackDraft, completePositiveFeedback, feedback, flow]
  );

  const toggleNegative = useCallback(
    function toggleNegative() {
      logClickEvent(
        flow === 'agent-work'
          ? 'agentWork.feedback.thumbs_down'
          : 'chat.response_metadata.thumbs_down'
      )();
      if (feedback !== 'negative') {
        clearNegativeFeedbackDraft();
        setFeedback('negative');
        if (flow === 'agent-work') {
          setNegativeFeedbackReason('other');
        }
        setIsNegativeFeedbackOpen(true);
        return;
      }

      setIsNegativeFeedbackOpen(false);
      clearNegativeFeedbackDraft();
      setFeedback(null);
    },
    [clearNegativeFeedbackDraft, feedback, flow]
  );

  const handleReasonSelect = useCallback(
    function handleReasonSelect(reason: FeedbackReason) {
      setNegativeFeedbackReason(reason);
      if (reason === 'other') {
        setOtherFeedback('');
        return;
      }

      setIsNegativeFeedbackOpen(false);
      void completeNegativeFeedback(reason);
    },
    [completeNegativeFeedback]
  );

  const handleOtherFeedbackChange = useCallback(function handleOtherFeedbackChange(value: string) {
    setOtherFeedback(value);
  }, []);

  const handleOtherSubmit = useCallback(
    function handleOtherSubmit() {
      const trimmed = otherFeedback.trim();
      if (!trimmed) return;

      setIsNegativeFeedbackOpen(false);
      void completeNegativeFeedback('other', trimmed);
    },
    [completeNegativeFeedback, otherFeedback]
  );

  const closeNegativePanel = useCallback(
    function closeNegativePanel() {
      setIsNegativeFeedbackOpen(false);

      if (negativeFeedbackReason === 'other') {
        void completeNegativeFeedback('other', otherFeedback);
        return;
      }

      setFeedback(null);
      clearNegativeFeedbackDraft();
    },
    [clearNegativeFeedbackDraft, completeNegativeFeedback, negativeFeedbackReason, otherFeedback]
  );

  const value = useMemo(
    () => ({
      feedback,
      isNegativeFeedbackOpen,
      negativeFeedbackReason,
      otherFeedback,
      isSubmittingFeedback,
      feedbackPanelRef,
      togglePositive,
      toggleNegative,
      handleReasonSelect,
      handleOtherFeedbackChange,
      handleOtherSubmit,
      closeNegativePanel,
    }),
    [
      feedback,
      isNegativeFeedbackOpen,
      negativeFeedbackReason,
      otherFeedback,
      isSubmittingFeedback,
      togglePositive,
      toggleNegative,
      handleReasonSelect,
      handleOtherFeedbackChange,
      handleOtherSubmit,
      closeNegativePanel,
    ]
  );

  return (
    <InvocationFeedbackContext.Provider value={value}>
      {children}
    </InvocationFeedbackContext.Provider>
  );
}
