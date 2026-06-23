'use client';

import { KeyboardEvent, useEffect, useRef } from 'react';
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import Spinner from '@ux/spinner';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { logActionEvent } from '@/utils/instrumentation';

interface InboxReplyComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (body: string) => void;
  disabled?: boolean;
  sending?: boolean;
  error?: boolean;
}

export function InboxReplyComposer({
  value,
  onChange,
  onSend,
  disabled = false,
  sending = false,
  error = false,
}: InboxReplyComposerProps) {
  const t = useTranslations();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    function autoGrow() {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    },
    [value],
  );

  function handleSubmit(): void {
    const trimmed: string = value.trim();
    if (!trimmed || disabled || sending) return;
    onSend(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="mt-auto shrink-0 px-3 pb-3 pt-2">
      {error && (
        <p className="mb-1 text-xs text-ux-text-error" data-testid="inbox-reply-error">
          {t('builder_inbox_reply_send_error')}
        </p>
      )}
      <FloatingFooter
        data-testid="inbox-reply-composer"
        orientation="vertical"
        className={cn(
          'mb-px focus-within:ring-1 focus-within:ring-intents-ux-boxLowContrast-borderColor',
          disabled && 'opacity-60',
        )}
      >
        <div className="flex flex-col gap-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={logActionEvent({ eid: 'inbox.detail.reply_composer', action: 'focus' })}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={disabled ? t('builder_inbox_reply_disabled') : t('builder_inbox_reply_placeholder')}
            rows={1}
            data-testid="inbox-reply-input"
            className="max-h-40 min-h-[1lh] w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ux-text-primary outline-none placeholder:text-ux-text-tertiary disabled:cursor-not-allowed"
          />
          <div className="flex justify-end">
            <Button
              design="primary"
              size="sm"
              icon={sending ? <span className="flex items-center justify-center"><Spinner size="sm" /></span> : <AsyncIcon icon="arrow-up" />}
              aria-label={t('builder_chatinput_send')}
              onClick={handleSubmit}
              disabled={disabled || sending || !value.trim()}
              data-testid="inbox-reply-send"
            />
          </div>
        </div>
      </FloatingFooter>
    </div>
  );
}
