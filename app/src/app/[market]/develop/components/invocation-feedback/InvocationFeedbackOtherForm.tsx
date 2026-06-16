'use client';

import { useEffect, useRef } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import TextInput from '@ux/text-input';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG } from './constants';
import { useInvocationFeedback } from './InvocationFeedbackContext';

/** Shared “Other” free-text step used by per-message and agent-work negative feedback. */
export default function InvocationFeedbackOtherForm() {
  const t = useTranslations();
  const isFlyoutHeightEnabled = useSwitchboard(INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG) ?? false;
  const { otherFeedback, handleOtherFeedbackChange, handleOtherSubmit } = useInvocationFeedback();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(function focusOtherInput() {
    if (!isFlyoutHeightEnabled) {
      return;
    }
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isFlyoutHeightEnabled]);

  if (!isFlyoutHeightEnabled) {
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

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-2">
      <TextInput
        ref={inputRef}
        id="negative-feedback-other-input"
        label={null}
        multiline
        stretch
        value={otherFeedback}
        placeholder={t(
          'builder_chat_feedback_other_placeholder',
          undefined,
          'Share your feedback...'
        )}
        onChange={handleOtherFeedbackChange}
        className="flex min-h-0 flex-1 flex-col text-sm [&_.ux-field-frame]:min-h-0 [&_.ux-field-frame]:flex-1 [&_.ux-text-entry-shell]:h-full [&_.ux-text-entry-shell]:min-h-0 [&_textarea]:box-border [&_textarea]:block [&_textarea]:!h-full [&_textarea]:min-h-0 [&_textarea]:resize-none"
      />
      <div className="flex justify-end">
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
    </div>
  );
}
