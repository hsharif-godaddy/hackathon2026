import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showRatingError, setShowRatingError] = useState(false);
  const [submitError, setSubmitError] = useState(false);

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
      const success = await onSubmit({ rating, topics: Array.from(topics), comment, customerConsent });
      if (success) {
        setSubmitted(true);
      } else {
        setSubmitError(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <Box gap="lg" className="flex-1">
        {!hideRating && (
          <NpsRating
            label={t('builder_feedback_share_rating_label')}
            value={rating}
            onChange={(v) => { setRating(v); setShowRatingError(false); }}
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
        />
        <Button
          design="primary"
          text={submitted ? t('builder_feedback_thank_you') : isSubmitting ? t('builder_feedback_share_submitting') : t('builder_feedback_share_submit')}
          onClick={handleSubmit}
          disabled={isSubmitting || submitted}
          icon={isSubmitting ? <Spinner size="sm" /> : undefined}
        />
      </Box>
    </div>
  );
}
