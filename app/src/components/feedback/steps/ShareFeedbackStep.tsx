import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';
import { NpsRating } from './NpsRating';
import { TopicChips } from './TopicChips';
import type { ShareFeedbackFormData } from '../types';
import { FEEDBACK_TOPICS } from '../utils';

interface ShareFeedbackStepProps {
  onBack: () => void;
  onSubmit: (data: ShareFeedbackFormData) => Promise<boolean>;
  onDone: () => void;
  hideRating?: boolean;
}

export function ShareFeedbackStep({ onBack, onSubmit, onDone, hideRating }: ShareFeedbackStepProps) {
  const t = useTranslations();
  const [rating, setRating] = useState<number | null>(null);
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [customerConsent, setCustomerConsent] = useState(false);
  const [publicShareConsent, setPublicShareConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showRatingError, setShowRatingError] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    logImpressionEvent('feedback.share.view')();
  }, []);

  useEffect(() => {
    if (!submitted) return;
    const id = setTimeout(onDone, 3000);
    return () => clearTimeout(id);
  }, [submitted, onDone]);

  const handleSubmit = async () => {
    if (!hideRating && !rating) {
      setShowRatingError(true);
      return;
    }
    setIsSubmitting(true);
    setSubmitError(false);
    try {
      const success = await onSubmit({ rating, topics: Array.from(topics), comment, customerConsent, publicShareConsent });
      if (success) {
        setSubmitted(true);
        logImpressionEvent('feedback.share.submitSuccess')();
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Box gap="lg" className="flex-1 overflow-y-auto min-h-0">
        {!hideRating && (
          <NpsRating
            label={t('builder_feedback_share_rating_label')}
            value={rating}
            onChange={(v) => {
              setRating(v);
              setShowRatingError(false);
              if (v == null || v < 6) setPublicShareConsent(false);
            }}
            error={showRatingError}
          />
        )}

        <TopicChips
          label={t('builder_feedback_share_topics_label')}
          topics={FEEDBACK_TOPICS}
          multi
          selected={topics}
          onChange={setTopics}
        />

        <Box gap="sm">
          <text.p size={-1} emphasis="passive">
            {t('builder_feedback_share_comment_label')}
          </text.p>
          <TextInput
            label={null}
            multiline
            size={3}
            value={comment}
            onChange={(e: any) => {
              setComment(typeof e === 'string' ? e : e?.target?.value ?? '');
            }}
            placeholder={t('builder_feedback_share_comment_placeholder')}
          />
        </Box>

        <Checkbox
          id="feedback-share-consent"
          name="feedback-share-consent"
          label={t('builder_feedback_share_consent_label')}
          checked={customerConsent}
          onChange={() => setCustomerConsent(!customerConsent)}
        />

        {rating != null && rating >= 6 && (
          <Checkbox
            id="feedback-share-public-consent"
            name="feedback-share-public-consent"
            label={t('builder_feedback_share_public_consent_label')}
            checked={publicShareConsent}
            onChange={() => setPublicShareConsent(!publicShareConsent)}
          />
        )}

        {submitError && (
          <text.p as="caption" emphasis="critical">
            {t('builder_feedback_submit_error')}
          </text.p>
        )}
      </Box>

      <Box orientation="horizontal" className="justify-between mt-auto pt-2">
        <Button
          design="secondary"
          text={t('builder_feedback_back')}
          onClick={onBack}
          disabled={isSubmitting}
          data-eid={generateClickEID('feedback.share.back')}
        />
        <Button
          design="primary"
          text={submitted ? t('builder_feedback_thank_you') : isSubmitting ? t('builder_feedback_share_submitting') : t('builder_feedback_share_submit')}
          onClick={handleSubmit}
          disabled={isSubmitting || submitted}
          icon={isSubmitting ? <Spinner size="sm" /> : undefined}
          data-eid={generateClickEID('feedback.share.submit')}
        />
      </Box>
    </div>
  );
}
