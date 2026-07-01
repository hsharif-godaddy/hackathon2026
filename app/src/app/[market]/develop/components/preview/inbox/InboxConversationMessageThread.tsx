'use client';

import { useInView } from 'framer-motion';
import { useEffect, useRef } from 'react';
import Growl from '@ux/growl';

import { useTranslations } from '@/hooks/useTranslations';
import { Conversation } from '@/types/inbox/local/conversation';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxMessageBubble } from './InboxMessageBubble';
import { InboxMessagePaginationSkeleton, InboxMessageThreadSkeleton } from './InboxSkeletons';
import { useInfiniteInboxConversationMessages } from '../../../hooks/useInbox';

interface InboxConversationMessageThreadProps {
  conversationId: IntString;
  brandId: UuidString;
  conversation: Conversation;
}

export function InboxConversationMessageThread({
  conversationId,
  brandId,
  conversation,
}: InboxConversationMessageThreadProps) {
  const t = useTranslations();
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isTopInView = useInView(sentinelRef, { margin: '0px 0px 100px 0px' });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteInboxConversationMessages(conversationId, brandId);

  const hasLoadedMessages = (data?.pages.length ?? 0) > 0;

  useEffect(() => {
    if (!isTopInView || !hasNextPage || isFetchingNextPage || isError) return;
    const container = containerRef.current;
    if (!container || container.scrollHeight <= container.clientHeight) return;
    fetchNextPage();
  }, [isTopInView, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  useEffect(() => {
    if (!isError || !hasLoadedMessages) return;
    Growl.addGrowlMessage({
      id: `inbox-messages-pagination-error-${conversationId}`,
      title: t('builder_inbox_messages_load_error'),
      emphasis: 'critical',
      lifetime: 5000,
    });
  }, [isError, hasLoadedMessages, conversationId, t]);

  const messages = data?.pages.flatMap((page) => page.messages) ?? [];

  function renderContent() {
    if (isLoading) {
      return <InboxMessageThreadSkeleton />;
    }

    if (isError && !hasLoadedMessages) {
      return (
        <div className='flex flex-1 items-center justify-center px-4'>
          <span className='text-center text-ux-text-error'>
            {error instanceof Error ? error.message : t('builder_inbox_messages_load_error')}
          </span>
        </div>
      );
    }

    return (
      <>
        {messages.map((message, index) => (
          <InboxMessageBubble
            key={message.id}
            message={message}
            conversation={conversation}
            isFirstMessage={index === messages.length - 1 && !hasNextPage}
          />
        ))}

        {isFetchingNextPage && <InboxMessagePaginationSkeleton />}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className='flex flex-1 flex-col-reverse gap-1 overflow-y-auto bg-ux-surface-base px-3 py-3'
      data-testid='conversation-message-thread'
    >
      {renderContent()}
      <div ref={sentinelRef} className='h-px shrink-0' aria-hidden='true' />
    </div>
  );
}
