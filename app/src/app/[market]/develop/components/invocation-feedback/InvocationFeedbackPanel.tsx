'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import ArrowRightIcon from '@ux/icon/arrow-right';
import XThickIcon from '@ux/icon/x-thick';
import Radio from '@ux/radio';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import {
  INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG,
  invocationFeedbackIconClass,
  invocationFeedbackPanelBodyClass,
  invocationFeedbackPanelBodyFallbackMinClass,
  invocationFeedbackPanelBodyOtherClass,
  invocationFeedbackPanelHeaderClass,
} from './constants';
import { useInvocationFeedback } from './InvocationFeedbackContext';
import InvocationFeedbackOtherForm from './InvocationFeedbackOtherForm';
import type { FeedbackReason } from './types';

export default function InvocationFeedbackPanel() {
  const t = useTranslations();
  const isFlyoutHeightEnabled = useSwitchboard(INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG) ?? false;
  const {
    isNegativeFeedbackOpen,
    negativeFeedbackReason,
    feedbackPanelRef,
    handleReasonSelect,
    closeNegativePanel,
  } = useInvocationFeedback();

  const showOtherForm = negativeFeedbackReason === 'other';
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number>();

  const legacyFeedbackReasons: Array<{ id: FeedbackReason; label: string }> = useMemo(
    () => [
      {
        id: 'not_factually_correct',
        label: t(
          'builder_chat_feedback_reason_not_factually_correct',
          undefined,
          'Not factually correct'
        ),
      },
      {
        id: 'not_relevant',
        label: t('builder_chat_feedback_reason_not_relevant', undefined, 'Not relevant'),
      },
      {
        id: 'did_not_follow_instructions',
        label: t(
          'builder_chat_feedback_reason_did_not_follow_instructions',
          undefined,
          "Didn't follow instructions"
        ),
      },
      {
        id: 'poor_quality_or_too_generic',
        label: t(
          'builder_chat_feedback_reason_poor_quality_or_too_generic',
          undefined,
          'Poor quality or too generic'
        ),
      },
      {
        id: 'confusing_or_unclear',
        label: t(
          'builder_chat_feedback_reason_confusing_or_unclear',
          undefined,
          'Confusing or unclear'
        ),
      },
      {
        id: 'other',
        label: t('builder_chat_feedback_reason_other', undefined, 'Other'),
      },
    ],
    [t]
  );

  const flyoutHeightFeedbackReasons: Array<{ id: FeedbackReason; label: string }> = useMemo(
    () => [
      {
        id: 'not_factually_correct',
        label: t(
          'builder_chat_feedback_reason_not_factually_correct',
          undefined,
          'Not factually correct'
        ),
      },
      {
        id: 'confusing_or_unclear',
        label: t(
          'builder_chat_feedback_reason_confusing_or_unclear',
          undefined,
          'Confusing or unclear'
        ),
      },
      {
        id: 'did_not_follow_instructions',
        label: t(
          'builder_chat_feedback_reason_did_not_follow_instructions',
          undefined,
          "Didn't follow instructions"
        ),
      },
      {
        id: 'not_relevant',
        label: t('builder_chat_feedback_reason_not_relevant', undefined, 'Not relevant'),
      },
      {
        id: 'poor_quality_or_too_generic',
        label: t(
          'builder_chat_feedback_reason_poor_quality_or_too_generic',
          undefined,
          'Poor quality or too generic'
        ),
      },
      {
        id: 'other',
        label: t('builder_chat_feedback_reason_other', undefined, 'Other'),
      },
    ],
    [t]
  );

  const feedbackReasons = isFlyoutHeightEnabled
    ? flyoutHeightFeedbackReasons
    : legacyFeedbackReasons;

  useLayoutEffect(function measureChipBodyHeight() {
    if (!isFlyoutHeightEnabled) {
      return;
    }
    if (!isNegativeFeedbackOpen) {
      setBodyHeight(undefined);
      return;
    }
    if (showOtherForm) {
      return;
    }
    const node = bodyRef.current;
    if (!node) {
      return;
    }
    setBodyHeight(node.getBoundingClientRect().height);
  }, [feedbackReasons, isFlyoutHeightEnabled, isNegativeFeedbackOpen, showOtherForm]);

  return (
    <AnimatePresence>
      {isNegativeFeedbackOpen && (
        <motion.div
          ref={feedbackPanelRef}
          className={clsx(
            'mt-1 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor',
            !isFlyoutHeightEnabled && 'p-3'
          )}
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {isFlyoutHeightEnabled ? (
            <Box blockPadding="sm" inlinePadding="sm" className="w-full">
              <div className={invocationFeedbackPanelHeaderClass}>
                <Box gap="sm">
                  <p className="text-lg font-semibold leading-tight text-foreground">
                    {t('builder_feedback_issue_description_label', undefined, 'What happened?')}
                  </p>
                  <p className="text-sm font-normal leading-snug text-muted-foreground">
                    {t(
                      'builder_chat_feedback_panel_subtitle',
                      undefined,
                      'Sharing your feedback helps Airo get better.'
                    )}
                  </p>
                </Box>
                <Button
                  type="button"
                  design="stateless"
                  size="sm"
                  aria-label={t('builder_common_close', undefined, 'Close')}
                  title={t('builder_common_close', undefined, 'Close')}
                  icon={<XThickIcon className={invocationFeedbackIconClass} />}
                  onClick={closeNegativePanel}
                />
              </div>
              <div
                ref={bodyRef}
                className={clsx(
                  showOtherForm
                    ? invocationFeedbackPanelBodyOtherClass
                    : invocationFeedbackPanelBodyClass,
                  showOtherForm && 'flex flex-col',
                  showOtherForm &&
                    bodyHeight === undefined &&
                    invocationFeedbackPanelBodyFallbackMinClass
                )}
                style={bodyHeight !== undefined ? { minHeight: bodyHeight } : undefined}
              >
                {showOtherForm ? (
                  <InvocationFeedbackOtherForm />
                ) : (
                  <div
                    role="radiogroup"
                    aria-label={t(
                      'builder_feedback_issue_description_label',
                      undefined,
                      'What happened?'
                    )}
                    className="flex flex-wrap gap-x-1 gap-y-1"
                  >
                    {feedbackReasons.map(function renderReason(reason) {
                      const isSelected = negativeFeedbackReason === reason.id;
                      const isOther = reason.id === 'other';
                      return (
                        <button
                          key={reason.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => {
                            handleReasonSelect(reason.id);
                          }}
                          className={clsx(
                            'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-sm font-normal leading-normal transition-colors',
                            isSelected
                              ? 'border-intents-ux-actionOptionChosen-borderColor bg-intents-ux-actionOptionChosen-backgroundColor text-foreground'
                              : 'border-intents-ux-box-borderColor text-foreground hover:bg-intents-ux-actionOptionHovered-backgroundColor'
                          )}
                        >
                          {reason.label}
                          {isOther && (
                            <ArrowRightIcon
                              className="size-2 shrink-0 text-muted-foreground rtl:scale-x-[-1]"
                              aria-hidden
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Box>
          ) : (
            <>
              <div className="mb-2 flex items-start justify-between gap-2">
                <Box gap="sm">
                  <p className="text-lg font-semibold leading-tight text-foreground">
                    {t('builder_feedback_issue_description_label', undefined, 'What happened?')}
                  </p>
                  <p className="text-sm font-normal leading-snug text-muted-foreground">
                    {t(
                      'builder_chat_feedback_panel_subtitle',
                      undefined,
                      'Sharing your feedback helps Airo get better.'
                    )}
                  </p>
                </Box>
                <Button
                  type="button"
                  design="stateless"
                  size="sm"
                  aria-label={t('builder_common_close', undefined, 'Close')}
                  title={t('builder_common_close', undefined, 'Close')}
                  icon={<XThickIcon className={invocationFeedbackIconClass} />}
                  onClick={closeNegativePanel}
                />
              </div>
              {showOtherForm ? (
                <InvocationFeedbackOtherForm />
              ) : (
                <div className="flex flex-col">
                  {feedbackReasons.map(function renderReason(reason) {
                    const isSelected = negativeFeedbackReason === reason.id;
                    return (
                      <label
                        key={reason.id}
                        htmlFor={`negative-feedback-${reason.id}`}
                        className="group relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5"
                      >
                        <span
                          className={clsx(
                            'pointer-events-none absolute inset-0 rounded-lg transition-colors duration-150',
                            isSelected
                              ? 'bg-intents-ux-actionOptionChosen-backgroundColor group-hover:bg-intents-ux-actionOptionHovered-backgroundColor'
                              : 'bg-transparent group-hover:bg-intents-ux-actionOptionHovered-backgroundColor'
                          )}
                          aria-hidden="true"
                        />
                        <span className="relative z-[1]">
                          <Radio
                            id={`negative-feedback-${reason.id}`}
                            name="negative-feedback-reason"
                            checked={isSelected}
                            onChange={() => {
                              handleReasonSelect(reason.id);
                            }}
                          />
                        </span>
                        <span className="relative z-[1] text-sm font-normal leading-normal text-foreground">
                          {reason.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
