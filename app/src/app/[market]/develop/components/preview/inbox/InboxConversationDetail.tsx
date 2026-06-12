'use client';

import { useCallback, useEffect, useState } from 'react';

import { useInboxConversation, useInboxConversationMessages, useSendInboxReply } from '@/app/[market]/develop/hooks/useInbox';
import { useTranslations } from '@/hooks/useTranslations';
import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetailHeader } from './InboxConversationDetailHeader';
import { InboxConversationMessageThread } from './InboxConversationMessageThread';
import { InboxReplyComposer } from './InboxReplyComposer';

interface InboxConversationDetailProps {
  conversationId: IntString;
  brandId: UuidString;
  onBack: () => void;
}

export function InboxConversationDetail({
  conversationId,
  brandId,
  onBack,
}: InboxConversationDetailProps) {
  const t = useTranslations();
  const [body, setBody] = useState('');
  const [sendError, setSendError] = useState(false);

  const {
    isLoading: messagesLoading,
    isError: messagesIsError,
    error: messagesError,
    data: messagesData
  } = useInboxConversationMessages(
    conversationId,
    brandId,
  );

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
        onSuccess: () => setBody(''),
        onError: () => setSendError(true),
      });
    },
    [sendReply.mutate],
  );

  const messages = messagesData?.messages ?? [];

  if (messagesLoading || conversationLoading ) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div className='text-ux-text-primary'>{t('builder_common_loading')}</div>
      </div>
    );
  }

  if (messagesIsError) {
    return (
      <div className='flex flex-1 items-center justify-center px-4'>
        <div className='text-center text-ux-text-error'>
          {messagesError instanceof Error ? messagesError.message : t('builder_inbox_messages_load_error')}
        </div>
      </div>
    );
  }

  if (conversationIsError) {
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
        messages={messages}
        conversation={conversation}
      />

      {!isGuideBotConversation(conversation) && (
        <InboxReplyComposer
          value={body}
          onChange={(value: string) => { setSendError(false); setBody(value); }}
          onSend={handleSend}
          disabled={sendReply.isPending}
          error={sendError}
        />
      )}
    </div>
  );
}
