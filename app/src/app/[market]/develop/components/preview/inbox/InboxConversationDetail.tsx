'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useInboxConversation, useSendInboxReply } from '@/app/[market]/develop/hooks/useInbox';
import { useTranslations } from '@/hooks/useTranslations';
import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { InboxConversationDetailHeader } from './InboxConversationDetailHeader';
import { InboxConversationMessageThread } from './InboxConversationMessageThread';
import { InboxReplyComposer } from './InboxReplyComposer';

interface InboxConversationDetailProps {
  conversationId: IntString;
  brandId: UuidString;
  onBack: () => void;
  consumeEntryRef: () => string | null;
}

export function InboxConversationDetail({
  conversationId,
  brandId,
  onBack,
  consumeEntryRef,
}: InboxConversationDetailProps) {
  const t = useTranslations();
  const [body, setBody] = useState('');
  const [sendError, setSendError] = useState(false);

  const {
    isLoading: conversationLoading,
    isError: conversationIsError,
    error: conversationError,
    data: conversation
  } = useInboxConversation(
    brandId,
    conversationId,
  );

  const sendReply = useSendInboxReply(brandId, conversationId);

  const detailViewedRef = useRef<IntString | null>(null);
  useEffect(() => {
    if (!conversation || detailViewedRef.current === conversationId) return;
    detailViewedRef.current = conversationId;
    const entryRef = consumeEntryRef();
    logImpressionEvent('inbox.detail.viewed', {
      channel: conversation.category.type,
      ...(entryRef ? { ref: entryRef } : {}),
    })();
  }, [conversation, conversationId, consumeEntryRef]);

  useEffect(
    function resetBodyOnConversationChange() {
      setBody('');
    },
    [conversationId],
  );

  const handleSend = useCallback(
    function send(replyBody: string) {
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

  if (conversationLoading) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='text-ux-text-primary'>{t('builder_common_loading')}</div>
      </div>
    );
  }

  if (conversationIsError || !conversation) {
    return (
      <div className='flex flex-1 items-center justify-center px-4'>
        <div className='text-center text-ux-text-error'>
          {conversationError instanceof Error ? conversationError.message : t('builder_inbox_conversation_load_error')}
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className='flex flex-1 items-center justify-center px-4'>
        <div className='text-center text-ux-text-error'>
          {t('builder_inbox_conversation_load_error')}
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <InboxConversationDetailHeader
        conversation={conversation}
        brandId={brandId}
        onBack={onBack}
      />

      <InboxConversationMessageThread
        conversationId={conversationId}
        brandId={brandId}
        conversation={conversation}
      />

      <InboxReplyComposer
        value={body}
        onChange={(value: string) => { setSendError(false); setBody(value); }}
        onSend={handleSend}
        disabled={isGuideBotConversation(conversation)}
        sending={sendReply.isPending}
        error={sendError}
      />
    </div>
  );
}
