'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';

import { useTranslations } from '@/hooks/useTranslations';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { type InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter';
import { InboxConversationRow } from './InboxConversationRow';
import { InboxConversationStatusFilters } from './InboxConversationStatusFilters';
import { InboxNotificationSettings } from './InboxNotificationSettings';
import { slideMotionProps, slideTransition } from './slideView';
import { useInboxConversations } from '../../../hooks/useInbox';

const EMPTY_STATE_KEYS: Record<InboxConversationStatusFilter, string> = {
  all: 'builder_inbox_empty_all',
  unresolved: 'builder_inbox_empty_unresolved',
  resolved: 'builder_inbox_empty_resolved',
};

interface InboxConversationListProps {
  brandId: UuidString;
  onConversationClick: (conversationId: IntString) => void;
}

export function InboxConversationList({
  brandId,
  onConversationClick,
}: InboxConversationListProps) {
  const t = useTranslations();
  const [statusFilter, setStatusFilter] = useState<InboxConversationStatusFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDirection, setPageDirection] = useState(0);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = (value: InboxConversationStatusFilter): void => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const { data, isLoading, error } = useInboxConversations(brandId, currentPage, statusFilter);
  const conversations = data?.conversations ?? [];
  const pageCount = data?.pageCount ?? 1;

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-ux-text-secondary'>{t('builder_inbox_list_loading')}</div>
      </div>
    );
  }

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
        />

        <InboxNotificationSettings brandId={brandId} />
      </div>
      
      <div
        ref={listScrollRef}
        className='relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-ux-surface-base'
      >
        {conversations.length === 0 ? (
          <div className='flex items-center justify-center h-full px-4'>
            <div className='text-center text-ux-text-secondary'>
              {t(EMPTY_STATE_KEYS[statusFilter])}
            </div>
          </div>
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
    </div>
  );
}