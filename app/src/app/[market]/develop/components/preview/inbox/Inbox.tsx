'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import { useConversationId } from '@/hooks/useConversationId';
import { useInboxEntryRef } from '@/hooks/useInboxEntryRef';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { slideMotionProps } from './slideView';

interface InboxProps {
  brandId: UuidString;
  embeddableId: number | null;
  categoryId: number | string | null;
}

export default function Inbox({ brandId, embeddableId, categoryId }: InboxProps) {
  const [direction, setDirection] = useState(1);

  // The active conversation is synced to the `?conversationId=` URL param, so
  // selecting/closing a conversation, reloading, and Back/Forward stay in sync.
  const { activeConversationId, setActiveConversationId } = useConversationId();

  // Captures the `?ref=` deep-link entry point (e.g. email) once and strips it
  // from the URL; consumed by whichever landing impression fires first.
  const { consumeEntryRef } = useInboxEntryRef();

  function handleConversationClick(conversationId: IntString) {
    setDirection(1);
    setActiveConversationId(conversationId);
  }

  function handleBack() {
    setDirection(-1);
    setActiveConversationId(null);
  }

  return (
    <div className='relative h-full min-h-0 overflow-hidden bg-ux-surface-base'>
      <AnimatePresence
        initial={false}
        custom={direction}
      >
        {activeConversationId ? (
          <motion.div
            key='conversation-detail'
            {...slideMotionProps(direction)}
            className='absolute inset-0 flex flex-col bg-ux-surface-base'
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
            key='conversation-list'
            {...slideMotionProps(direction)}
            className='absolute inset-0 flex flex-col bg-ux-surface-base'
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
