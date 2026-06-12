'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useConversationId } from '@/hooks/useConversationId';
import { usePusher } from '@/hooks/usePusher';
import { queryKeys } from '@/lib/inbox/constants/queryKeys';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { slideMotionProps } from './slideView';

interface InboxProps {
  brandId: UuidString;
  accountId: string;
}

// Collapse a burst of autoupdate_version increments into a single invalidation.
const INVALIDATE_DEBOUNCE_MS = 400;

export default function Inbox({ brandId, accountId }: InboxProps) {
  const [direction, setDirection] = useState(1);

  // Read the deep-link conversation id once and strip it from the URL, seeding
  // the initial active conversation. Render-stable, so reading it as the state
  // initializer is safe (it never changes after mount).
  const conversationId = useConversationId();

  const [activeConversationId, setActiveConversationId] = useState<IntString | null>(conversationId);

  const queryClient = useQueryClient();
  const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce so a burst of autoupdate_version increments triggers a single
  // invalidation. invalidateQueries on the root ['reamaze'] key refetches the
  // mounted inbox queries (list + active conversation + messages) and marks the
  // rest stale. Mirrors the setTimeout + ref debounce used in UnifiedSearch.
  // Note: the user's own reply already invalidates inboxConversationMessages via
  // useSendInboxReply, so it also self-bumps autoupdate_version — the resulting
  // broad invalidation here is a harmless, debounced, idempotent double-refetch.
  const handleAutoupdate = useCallback(() => {
    if (invalidateTimeoutRef.current) {
      clearTimeout(invalidateTimeoutRef.current);
    }
    invalidateTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    }, INVALIDATE_DEBOUNCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
    },
    []
  );

  // Initialize Pusher connection for real-time updates; refetch inbox data on events.
  usePusher({ accountId, onAutoupdate: handleAutoupdate });

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
