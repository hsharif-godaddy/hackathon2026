'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import Growl from '@ux/growl';

import { useTranslations } from '@/hooks/useTranslations';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { type InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { InboxConversationListEmptyState } from './InboxConversationListEmptyState';
import { InboxConversationListPagination } from './InboxConversationListPagination';
import { InboxConversationRow } from './InboxConversationRow';
import { InboxConversationStatusFilters } from './InboxConversationStatusFilters';
import { InboxNotificationSettings } from './InboxNotificationSettings';
import { InboxConversationListSkeleton } from './InboxSkeletons';
import { slideMotionProps, slideTransition } from './slideView';
import { useInboxConversations } from '../../../hooks/useInbox';

interface InboxConversationListProps {
  brandId: UuidString;
  // Reamaze provisioning pointers driving the empty-state variations:
  // embeddableId → chat widget present; categoryId → contact form present.
  embeddableId: number | null;
  categoryId: number | string | null;
  onConversationClick: (conversationId: IntString) => void;
  consumeEntryRef: () => string | null;
}

export function InboxConversationList({
  brandId,
  embeddableId,
  categoryId,
  onConversationClick,
  consumeEntryRef,
}: InboxConversationListProps) {
  const t = useTranslations();
  const [statusFilter, setStatusFilter] = useState<InboxConversationStatusFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDirection, setPageDirection] = useState(0);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = (value: InboxConversationStatusFilter): void => {
    logClickEvent('inbox.filter.status', { filter: value })();
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const { data, isLoading, error } = useInboxConversations(brandId, currentPage, statusFilter);
  const conversations = data?.conversations ?? [];
  const pageCount = data?.pageCount ?? 1;
  const droppedCount = data?.droppedCount ?? 0;

  const handlePageChange = useCallback(function handlePageChange(newPage: number) {
    setPageDirection(newPage > currentPage ? 1 : -1);
    setCurrentPage(newPage);
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage]);

  useEffect(() => {
    if (droppedCount === 0) return;
    Growl.addGrowlMessage({
      id: 'inbox-conversations-partial-error',
      title: t('builder_inbox_conversations_partial_error'),
      emphasis: 'warning',
      lifetime: 5000,
    });
  }, [droppedCount, t]);

  const listViewedRef = useRef(false);
  useEffect(() => {
    if (isLoading || error || listViewedRef.current) return;
    listViewedRef.current = true;
    const entryRef = consumeEntryRef();
    logImpressionEvent('inbox.list.viewed', {
      conversationCount: conversations.length,
      statusFilter,
      ...(entryRef ? { ref: entryRef } : {}),
    })();
  }, [isLoading, error, conversations.length, statusFilter, consumeEntryRef]);

  if (error) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-ux-text-danger'>
          {t('builder_inbox_list_load_error', {
            error: error instanceof Error ? error.message : t('builder_common_unknown_error'),
          })}
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col bg-ux-surface-base'>
      <div className='flex shrink-0 items-center gap-2 border-b border-ux-border-subtle px-3 py-1.5'>
        <InboxConversationStatusFilters
          value={statusFilter}
          onChange={handleFilterChange}
          disabled={isLoading || (statusFilter === 'all' && conversations.length === 0)}
        />

        <InboxNotificationSettings brandId={brandId} disabled={isLoading} />
      </div>

      <div
        ref={listScrollRef}
        className='relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-ux-surface-base'
      >
        {isLoading ? (
          <InboxConversationListSkeleton />
        ) : conversations.length === 0 ? (
          <InboxConversationListEmptyState
            statusFilter={statusFilter}
            embeddableId={embeddableId}
            categoryId={categoryId}
          />
        ) : (
          <AnimatePresence initial={false} custom={pageDirection}>
            <motion.div
              key={currentPage}
              {...slideMotionProps(
                pageDirection,
                pageDirection === 0 ? { duration: 0 } : slideTransition,
              )}
              className='w-full'
            >
              {conversations.map((conversation) => (
                <InboxConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  onClick={onConversationClick}
                  showResolvedTag={statusFilter === 'all'}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {pageCount > 1 && (
        <InboxConversationListPagination
          currentPage={currentPage}
          totalPages={pageCount}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
