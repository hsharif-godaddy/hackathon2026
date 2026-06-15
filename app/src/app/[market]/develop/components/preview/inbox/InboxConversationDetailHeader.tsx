'use client';

import Button from '@ux/button';
import ChevronLeftIcon from '@ux/icon/chevron-left';

import { useConversationActions } from '@/app/[market]/develop/hooks/useConversationActions';
import { useTranslations } from '@/hooks/useTranslations';
import { primaryParticipantName } from '@/lib/inbox/conversationParticipant';
import { Conversation } from '@/types/inbox/local/conversation';
import { UuidString } from '@/types/inbox/local/core';
import { ConversationOriginLine } from './InboxConversationOriginLine';

interface InboxConversationDetailHeaderProps {
  conversation: Conversation;
  brandId: UuidString;
  onBack: () => void;
}

export function InboxConversationDetailHeader({
  conversation,
  brandId,
  onBack,
}: InboxConversationDetailHeaderProps) {
  const t = useTranslations();
  const displayName = primaryParticipantName(conversation) || t('builder_inbox_unknown');
  const { resolve, unresolve } = useConversationActions(brandId);
  const isPending = resolve.isPending || unresolve.isPending;
  const canResolve = resolve.canExecute(conversation);
  const canUnresolve = unresolve.canExecute(conversation);

  const handleAction = (): void => {
    if (canUnresolve) {
      unresolve.execute([conversation.id]);
    } else if (canResolve) {
      resolve.execute([conversation.id]);
    }
  };

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
          design={canUnresolve ? 'secondary' : 'primary'}
          size='sm'
          text={canUnresolve ? t('builder_inbox_unresolve') : t('builder_inbox_resolve')}
          disabled={isPending}
          onClick={handleAction}
          data-testid={canUnresolve ? 'conversation-detail-unresolve' : 'conversation-detail-resolve'}
        />
      </div>
    </header>
  );
}
