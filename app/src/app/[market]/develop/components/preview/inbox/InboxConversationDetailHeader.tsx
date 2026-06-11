'use client';

import Button from '@ux/button';
import ChevronLeftIcon from '@ux/icon/chevron-left';

import { useTranslations } from '@/hooks/useTranslations';
import { primaryParticipantName } from '@/lib/inbox/conversationParticipant';
import { Conversation } from '@/types/inbox/local/conversation';
import { ConversationOriginLine } from './InboxConversationOriginLine';

interface InboxConversationDetailHeaderProps {
  conversation: Conversation;
  onBack: () => void;
}

export function InboxConversationDetailHeader({
  conversation,
  onBack,
}: InboxConversationDetailHeaderProps) {
  const t = useTranslations();
  const displayName = primaryParticipantName(conversation) || t('builder_inbox_unknown');

  return (
    <header className='flex min-h-0 shrink-0 items-center gap-1.5 border-b border-ux-border-subtle px-3 py-1.5'>
      <Button
        design='minimal'
        size='sm'
        icon={<ChevronLeftIcon width={16} height={16} />}
        aria-label={t('builder_common_back')}
        onClick={onBack}
        data-testid='conversation-detail-back'
      />

      <div className='ms-2 flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-sm font-semibold leading-none text-ux-text-primary'>
          {displayName}
        </span>
        <ConversationOriginLine conversation={conversation} />
      </div>

      <div className='shrink-0 self-center'>
        <Button
          design={conversation.isResolved ? 'secondary' : 'primary'}
          size='sm'
          text={conversation.isResolved ? t('builder_inbox_unresolve') : t('builder_inbox_resolve')}
          onClick={() => {}} // TODO
          data-testid={
            conversation.isResolved ? 'conversation-detail-unresolve' : 'conversation-detail-resolve'
          }
        />
      </div>
    </header>
  );
}