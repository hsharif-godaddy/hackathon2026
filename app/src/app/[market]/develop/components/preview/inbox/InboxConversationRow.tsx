'use client';

import ReplyIcon from '@ux/icon/reply';
import Tag from '@ux/tag';

import { useTranslations } from '@/hooks/useTranslations';
import { primaryParticipantName } from '@/lib/inbox/conversationParticipant';
import { conversationTypeLabel } from '@/lib/inbox/conversationTypeLabel';
import { Conversation } from '@/types/inbox/local/conversation';
import { IntString } from '@/types/inbox/local/core';
import { timeAgo } from '@/utils/time';
import { InboxChannelIcon } from './InboxChannelIcon';

interface InboxConversationRowProps {
  conversation: Conversation;
  onClick: (conversationId: IntString) => void;
  showResolvedTag?: boolean;
}

export function InboxConversationRow({
  conversation,
  onClick,
  showResolvedTag = false,
}: InboxConversationRowProps) {
  const t = useTranslations();
  const { lastMessage } = conversation;
  const displayName = primaryParticipantName(conversation) || t('builder_inbox_unknown');
  const preview = lastMessage.body?.substring(0, 100) || t('builder_inbox_no_preview');
  const relativeTime = timeAgo(lastMessage.createdAt);

  return (
    <div
      role='button'
      tabIndex={0}
      className='flex cursor-pointer items-center gap-2 border-b border-ux-border-subtle px-3 py-1.5 transition-colors hover:bg-ux-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ux-border-focus'
      onClick={() => onClick(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(conversation.id);
        }
      }}
    >
      <div
        role='img'
        className='flex shrink-0 items-center justify-center rounded-full bg-intents-ux-boxLowContrast-backgroundColor size-6'
        aria-label={t(conversationTypeLabel(conversation))}
      >
        <InboxChannelIcon
          conversation={conversation}
          size={14}
          suppressAccessibility
        />
      </div>

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className='min-w-0 flex-1 truncate text-sm font-medium text-ux-text-primary'>
            {displayName}
          </span>
          <div className='flex shrink-0 items-center gap-1.5'>
            {showResolvedTag && conversation.status === 'resolved' ? (
              <span data-testid='conversation-row-resolved'>
                <Tag size='sm' emphasis='passive'>
                  {t('builder_inbox_resolved')}
                </Tag>
              </span>
            ) : null}
            <span className='text-xs text-ux-text-tertiary'>
              {t(relativeTime.key, relativeTime.values)}
            </span>
          </div>
        </div>
        <div className='flex items-center gap-0.5'>
          {conversation.status === 'pending' && (
            <ReplyIcon width={14} height={14} aria-hidden />
          )}
          <p className='truncate text-xs leading-snug text-ux-text-secondary'>
            {preview}
          </p>
        </div>
      </div>
    </div>
  );
}
