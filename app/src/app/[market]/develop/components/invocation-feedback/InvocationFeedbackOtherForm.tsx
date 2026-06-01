'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';
import { useInvocationFeedback } from './InvocationFeedbackContext';

/** Shared “Other” free-text step used by per-message and agent-work negative feedback. */
export default function InvocationFeedbackOtherForm() {
  const t = useTranslations();
  const { otherFeedback, handleOtherFeedbackChange, handleOtherSubmit } = useInvocationFeedback();

  return (
    <Box gap="md" className="pt-1">
      <TextInput
        id="negative-feedback-other-input"
        label={null}
        multiline
        size={6}
        value={otherFeedback}
        placeholder={t(
          'builder_chat_feedback_other_placeholder',
          undefined,
          'Share your feedback...'
        )}
        onChange={handleOtherFeedbackChange}
        className="rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor text-sm text-foreground"
      />
      <div className="flex justify-end pt-1">
        <Button
          type="button"
          design="primary"
          size="sm"
          className="min-w-[90px] rounded-lg"
          text={t('builder_common_submit', undefined, 'Submit')}
          onClick={handleOtherSubmit}
          disabled={!otherFeedback.trim()}
        />
      </div>
    </Box>
  );
}
