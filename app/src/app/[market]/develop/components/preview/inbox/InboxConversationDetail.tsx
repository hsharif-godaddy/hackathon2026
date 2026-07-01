'use client';

import { useEffect, useRef } from 'react';

import { useInboxConversation } from '@/app/[market]/develop/hooks/useInbox';
import { useTranslations } from '@/hooks/useTranslations';
import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { logImpressionEvent } from '@/utils/instrumentation';
import { InboxConversationDetailHeader } from './InboxConversationDetailHeader';
import { InboxConversationMessageThread } from './InboxConversationMessageThread';
import { InboxReplyComposer } from './InboxReplyComposer';
import { InboxConversationDetailSkeleton } from './InboxSkeletons';

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

  const {
    isLoading: conversationLoading,
    isError: conversationIsError,
    error: conversationError,
    data: conversation
  } = useInboxConversation(
    brandId,
    conversationId,
  );

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

  if (conversationLoading) {
    return <InboxConversationDetailSkeleton />;
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
        key={conversationId}
        brandId={brandId}
        conversationId={conversationId}
        disabled={isGuideBotConversation(conversation)}
      />
    </div>
  );
}
