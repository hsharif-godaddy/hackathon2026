import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';
import { TopicChips } from './TopicChips';
import type { SupportFormData } from '../types';
import { SUPPORT_TOPICS } from '../utils';

interface GetSupportStepProps {
  onBack: () => void;
  onSubmit: (data: SupportFormData) => Promise<boolean>;
  onDone: () => void;
}

export function GetSupportStep({ onBack, onSubmit, onDone }: GetSupportStepProps) {
  const t = useTranslations();
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showTopicError, setShowTopicError] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    logImpressionEvent('feedback.support.view')();
  }, []);

  useEffect(() => {
    if (!submitted) return;
    const id = setTimeout(onDone, 3000);
    return () => clearTimeout(id);
  }, [submitted, onDone]);

  const handleSubmit = async () => {
    const missingTopic = topics.size === 0;
    const missingDescription = !description.trim();
    if (missingTopic) setShowTopicError(true);
    if (missingDescription) setShowError(true);
    if (missingTopic || missingDescription) return;
    setIsSubmitting(true);
    setSubmitError(false);
    try {
      const success = await onSubmit({ topics: Array.from(topics), description, followUp });
      if (success) {
        setSubmitted(true);
        logImpressionEvent('feedback.support.submitSuccess')();
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
        <text.p size={-1} emphasis="passive">
          {t('builder_feedback_support_description')}
        </text.p>

        <Box gap="sm">
          <TopicChips
            label={t('builder_feedback_support_topics_label')}
            topics={SUPPORT_TOPICS}
            multi
            selected={topics}
            onChange={(tp) => { setTopics(tp); setShowTopicError(false); }}
          />
          {showTopicError && (
            <text.p as="caption" emphasis="critical">
              {t('builder_feedback_support_topics_error')}
            </text.p>
          )}
        </Box>

        <Box gap="sm">
          <text.p size={-1} emphasis="passive">
            {t('builder_feedback_support_description_label')}
          </text.p>
          <TextInput
            label={null}
            multiline
            size={3}
            value={description}
            onChange={(e: any) => {
              setDescription(typeof e === 'string' ? e : e?.target?.value ?? '');
              if (showError) setShowError(false);
            }}
            placeholder={t('builder_feedback_support_description_placeholder')}
          />
          {showError && !description.trim() && (
            <text.p as="caption" emphasis="critical">
              {t('builder_feedback_support_description_error')}
            </text.p>
          )}
        </Box>

        <text.p size={-1} emphasis="passive">
          {t('builder_feedback_support_reply_note')}
        </text.p>

        <Checkbox
          id="feedback-support-followup"
          name="feedback-support-followup"
          label={t('builder_feedback_support_followup_label')}
          checked={followUp}
          onChange={() => setFollowUp(!followUp)}
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
          data-eid={generateClickEID('feedback.support.back')}
        />
        <Button
          design="primary"
          text={submitted ? t('builder_feedback_thank_you') : isSubmitting ? t('builder_feedback_support_submitting') : t('builder_feedback_support_submit')}
          onClick={handleSubmit}
          disabled={isSubmitting || submitted}
          icon={isSubmitting ? <Spinner size="sm" /> : undefined}
          data-eid={generateClickEID('feedback.support.submit')}
        />
      </Box>
    </div>
  );
}
