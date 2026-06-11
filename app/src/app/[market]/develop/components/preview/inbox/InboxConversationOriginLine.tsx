'use client';

import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { conversationTypeLabel } from '@/lib/inbox/conversationTypeLabel';
import { isGuideBotConversation } from '@/lib/inbox/isGuideBotConversation';
import { Conversation } from '@/types/inbox/local/conversation';
import { InboxChannelIcon } from './InboxChannelIcon';

interface ConversationOriginLineProps {
  conversation: Conversation;
}

/**
 * Returns the raw category name, or an empty string when none is set; callers
 * supply a translated fallback (this is a pure helper and cannot translate).
 */
export function conversationChannelName(conversation: Conversation): string {
  return conversation.category.name.trim();
}

export function ConversationOriginLine({ conversation }: ConversationOriginLineProps) {
  const t = useTranslations();
  const label = isGuideBotConversation(conversation)
    ? t('builder_inbox_origin_guidebot')
    : t('builder_inbox_origin_via', {
        type: t(conversationTypeLabel(conversation)),
        channel: conversationChannelName(conversation) || t('builder_inbox_unknown'),
      });

  return (
    <div
      className='flex min-w-0 items-center gap-1'
      data-testid='conversation-origin-line'
    >
      <InboxChannelIcon
        conversation={conversation}
        size={12}
        className='text-intents-ux-passive-foregroundColor'
      />
      <text.span as='caption' size={-2} emphasis='passive' className='truncate leading-none'>
        {label}
      </text.span>
    </div>
  );
}
