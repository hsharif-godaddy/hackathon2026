'use client';

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import Spinner from '@ux/spinner';

import { useSendInboxReply } from '@/app/[market]/develop/hooks/useInbox';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { logActionEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

interface InboxReplyComposerProps {
  brandId: UuidString;
  conversationId: IntString;
  disabled?: boolean;
}

export function InboxReplyComposer({
  brandId,
  conversationId,
  disabled = false,
}: InboxReplyComposerProps) {
  const t = useTranslations();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [sendError, setSendError] = useState(false);

  const sendReply = useSendInboxReply(brandId, conversationId);

  useEffect(
    function autoGrow() {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    },
    [body],
  );

  const handleSend = useCallback(
    function send(replyBody: string): void {
      setSendError(false);
      sendReply.mutate({ body: replyBody }, {
        onSuccess: () => {
          logClickEvent('inbox.detail.reply_send')();
          setBody((current: string) => current.trim() === replyBody ? '' : current);
        },
        onError: () => {
          logImpressionEvent('inbox.detail.reply_failed')();
          setSendError(true);
        },
      });
    },
    [sendReply.mutate],
  );

  function handleSubmit(): void {
    const trimmed: string = body.trim();
    if (!trimmed || disabled || sendReply.isPending) return;
    handleSend(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="mt-auto shrink-0 px-3 pt-2 pb-14 md:pb-3">
      {sendError && (
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
            value={body}
            onChange={(event) => { setSendError(false); setBody(event.target.value); }}
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
              icon={sendReply.isPending ? <span className="flex items-center justify-center"><Spinner size="sm" /></span> : <AsyncIcon icon="arrow-up" />}
              aria-label={t('builder_chatinput_send')}
              onClick={handleSubmit}
              disabled={disabled || sendReply.isPending || !body.trim()}
              data-testid="inbox-reply-send"
            />
          </div>
        </div>
      </FloatingFooter>
    </div>
  );
}
