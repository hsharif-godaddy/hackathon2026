'use client'

import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { type JSX, useState } from 'react';
import Button from '@ux/button';
import ThumbsDownIcon from '@ux/icon/thumbs-down';
import ThumbsUpIcon from '@ux/icon/thumbs-up';
import ThumbsUpFilledIcon from '@ux/icon/thumbs-up-filled';
import TextInput from '@ux/text-input';

import { invocationFeedbackActionIconClass } from '@/app/[market]/develop/components/invocation-feedback';
import { useTranslations } from '@/hooks/useTranslations';
import { submitFeedback, type SubmitFeedbackResult } from '@/lib/feedback-client';
import { shipAnalyticsLog } from '@/lib/logging';
import { defaultMessageForDomainFeedbackKey, type DomainFeedbackKey } from '@/lib/translations/domain-feedback-defaults';
import { generateClickEID } from '@/utils/instrumentation';

const REASON_BUTTON_BASE_CLASS =
  'inline-flex cursor-pointer items-center rounded-full border px-2 py-1 text-xs font-normal leading-normal text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50';

interface DomainSuggestionFeedbackProps {
  appId: string;
  messageId?: string;
  conversationId?: string | null;
}

export default function DomainSuggestionFeedback({ appId, messageId, conversationId }: DomainSuggestionFeedbackProps): JSX.Element {
  const t = useTranslations();
  const [vote, setVote] = useState<'positive' | 'negative' | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [detailText, setDetailText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const targetId: string = messageId || appId;

  const td = (key: DomainFeedbackKey): string => t(key, undefined, defaultMessageForDomainFeedbackKey(key));

  const reasons: { id: string; label: string }[] = [
    { id: 'domain_mismatch', label: td('builder_domain_suggestion_feedback_reason_mismatch') },
    { id: 'domain_unavailable', label: td('builder_domain_suggestion_feedback_reason_unavailable') },
    { id: 'domain_too_expensive', label: td('builder_domain_suggestion_feedback_reason_price') },
    { id: 'domain_other', label: t('builder_chat_feedback_reason_other', undefined, 'Other') },
  ];

  async function handlePositive(): Promise<void> {
    if (submitted || submitting) return;
    setVote('positive');
    setSubmitting(true);
    const result: SubmitFeedbackResult = await submitFeedback({
      feedback: 'positive',
      targetLevel: 'invocation',
      targetId,
      appId,
      feedbackCategory: 'domain_suggestions',
    });
    shipAnalyticsLog('domain.suggestion_feedback.submitted', {
      appId,
      targetId,
      feedback: 'positive',
      feedbackCategory: 'domain_suggestions',
      outcome: result.ok ? 'success' : 'failure',
      ...(result.reason && { failureReason: result.reason }),
      ...(conversationId && { conversationId }),
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  function handleNegative(): void {
    if (submitted || submitting) return;
    setVote('negative');
    shipAnalyticsLog('domain.suggestion_feedback.negative_intent', {
      appId,
      targetId,
      ...(conversationId && { conversationId }),
    });
  }

  async function handleNegativeSubmit(): Promise<void> {
    if (submitted || submitting || !selectedReason) return;
    setSubmitting(true);
    const trimmedText: string = detailText.trim();
    const result: SubmitFeedbackResult = await submitFeedback({
      feedback: 'negative',
      targetLevel: 'invocation',
      targetId,
      appId,
      feedbackCategory: selectedReason,
      ...(trimmedText && { feedbackText: trimmedText }),
      hasDetailedFeedback: true,
    });
    shipAnalyticsLog('domain.suggestion_feedback.submitted', {
      appId,
      targetId,
      feedback: 'negative',
      feedbackCategory: selectedReason,
      outcome: result.ok ? 'success' : 'failure',
      ...(result.reason && { failureReason: result.reason }),
      ...(conversationId && { conversationId }),
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-xs text-intents-ux-text-secondary"
      >
        {t('builder_app_generation_feedback_thanks', undefined, 'Thanks for the feedback!')}
      </motion.p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="text-xs text-intents-ux-text-secondary">
          {td('builder_domain_suggestion_feedback_prompt')}
        </span>
        <AnimatePresence>
          {vote !== 'negative' && (
            <Button
              key="thumbs-up"
              type="button"
              design="stateless"
              size="small"
              className="inline-flex"
              aria-label={td('builder_domain_suggestion_feedback_positive')}
              title={td('builder_domain_suggestion_feedback_positive')}
              data-eid={generateClickEID('domain.suggestion_feedback.thumbs_up')}
              onClick={handlePositive}
              icon={
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {vote === 'positive' ? (
                    <ThumbsUpFilledIcon
                      className={clsx(invocationFeedbackActionIconClass, 'text-black hover:text-black active:text-black')}
                    />
                  ) : (
                    <ThumbsUpIcon className={invocationFeedbackActionIconClass} />
                  )}
                </motion.div>
              }
            />
          )}
          {vote !== 'positive' && (
            <Button
              key="thumbs-down"
              type="button"
              design="stateless"
              size="small"
              className="inline-flex"
              aria-label={td('builder_domain_suggestion_feedback_negative')}
              title={td('builder_domain_suggestion_feedback_negative')}
              data-eid={generateClickEID('domain.suggestion_feedback.thumbs_down')}
              onClick={handleNegative}
              icon={
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {vote === 'negative' ? (
                    <ThumbsUpFilledIcon
                      className={clsx(invocationFeedbackActionIconClass, 'rotate-180 text-black hover:text-black active:text-black')}
                    />
                  ) : (
                    <ThumbsDownIcon className={invocationFeedbackActionIconClass} />
                  )}
                </motion.div>
              }
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {vote === 'negative' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1" role="radiogroup">
                {reasons.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selectedReason === id}
                    onClick={() => setSelectedReason(id)}
                    disabled={submitting}
                    className={clsx(
                      REASON_BUTTON_BASE_CLASS,
                      selectedReason === id
                        ? 'border-intents-ux-actionOptionChosen-borderColor bg-intents-ux-actionOptionChosen-backgroundColor'
                        : 'border-intents-ux-box-borderColor hover:bg-intents-ux-actionOptionHovered-backgroundColor'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {selectedReason && (
                <div className="flex flex-col gap-2">
                  <TextInput
                    id="domain-suggestion-feedback-other-input"
                    label={null}
                    multiline
                    size={6}
                    value={detailText}
                    placeholder={t('builder_chat_feedback_other_placeholder', undefined, 'Share your feedback...')}
                    onChange={setDetailText}
                    className="rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor text-sm text-foreground"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      design="primary"
                      size="small"
                      className="min-w-[90px] rounded-lg"
                      text={t('builder_common_submit', undefined, 'Submit')}
                      onClick={handleNegativeSubmit}
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
