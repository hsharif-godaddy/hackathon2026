'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import Button from '@ux/button';

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useConversationId } from '@/hooks/useConversationId';
import { useInboxAccount } from '@/hooks/useInboxAccount';
import { useInboxEntryRef } from '@/hooks/useInboxEntryRef';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { IntString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { InboxConversationListEmptyState } from './InboxConversationListEmptyState';
import { InboxConversationListSkeleton } from './InboxSkeletons';
import { slideMotionProps } from './slideView';

export default function Inbox() {
  const appId: string | undefined = useAppIdFromParams();
  const isInboxEnabled: boolean | undefined = useSwitchboard('app-builder-inbox-button');
  const { brandId, embeddableId, categoryId, isLoading, error, refetch } = useInboxAccount(
    isInboxEnabled ? appId : undefined,
  );
  const t = useTranslations();
  const [direction, setDirection] = useState<number>(1);
  const { activeConversationId, setActiveConversationId } = useConversationId();
  const { consumeEntryRef } = useInboxEntryRef();

  if (isLoading) {
    return (
      <div className="h-full p-3" data-testid="inbox-loading">
        <InboxConversationListSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="inbox-error"
      >
        <p className="text-sm text-ux-text-secondary">
          {t('builder_common_error_generic', undefined, 'Something went wrong. Please try again.')}
        </p>
        <Button design="secondary" size="sm" onClick={() => void refetch()}>
          {t('builder_common_try_again', undefined, 'Try again')}
        </Button>
      </div>
    );
  }

  if (!brandId) {
    return (
      <InboxConversationListEmptyState
        statusFilter="all"
        embeddableId={null}
        categoryId={null}
      />
    );
  }

  function handleConversationClick(conversationId: IntString): void {
    setDirection(1);
    setActiveConversationId(conversationId);
  }

  function handleBack(): void {
    setDirection(-1);
    setActiveConversationId(null);
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-ux-surface-base">
      <AnimatePresence initial={false} custom={direction}>
        {activeConversationId ? (
          <motion.div
            key="conversation-detail"
            {...slideMotionProps(direction)}
            className="absolute inset-0 flex flex-col bg-ux-surface-base"
          >
            <InboxConversationDetail
              conversationId={activeConversationId}
              brandId={brandId}
              onBack={handleBack}
              consumeEntryRef={consumeEntryRef}
            />
          </motion.div>
        ) : (
          <motion.div
            key="conversation-list"
            {...slideMotionProps(direction)}
            className="absolute inset-0 flex flex-col bg-ux-surface-base"
          >
            <InboxConversationList
              brandId={brandId}
              embeddableId={embeddableId}
              categoryId={categoryId}
              onConversationClick={handleConversationClick}
              consumeEntryRef={consumeEntryRef}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
