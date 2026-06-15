'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import { useConversationId } from '@/hooks/useConversationId';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { slideMotionProps } from './slideView';

interface InboxProps {
  brandId: UuidString;
}

export default function Inbox({ brandId }: InboxProps) {
  const [direction, setDirection] = useState(1);

  // Read the deep-link conversation id once and strip it from the URL, seeding
  // the initial active conversation. Render-stable, so reading it as the state
  // initializer is safe (it never changes after mount).
  const conversationId = useConversationId();

  const [activeConversationId, setActiveConversationId] = useState<IntString | null>(conversationId);

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
              onConversationClick={handleConversationClick}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
